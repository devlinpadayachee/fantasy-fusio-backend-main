const { ethers } = require("ethers");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Game = require("../models/Game");
const Portfolio = require("../models/Portfolio");
const blockchainService = require("./blockchain.service");
const FusioFantasyGameV2 = require("../config/FusioFantasyGameV2.json");

class TransactionService {
  constructor() {
    // ENTRY_FEE is now dynamic - retrieved from game
    this.GAS_FEE = ethers.utils.parseUnits("0.1", 18).toString(); // 0.1 USDC in wei
    this.ADMIN_FEE_PERCENTAGE = 10; // 10%
  }

  // Process entry fee payment
  async processEntryFee(userId, gameId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Get the game to retrieve correct entry fee
      const game = await Game.findOne({ gameId });
      if (!game) {
        throw new Error(`Game ${gameId} not found`);
      }

      // Calculate entry fee from game's actual price
      const entryFeeWei = ethers.utils.parseUnits(game.entryPrice.toString(), 18).toString();
      const adminFeeWei = ((BigInt(entryFeeWei) * BigInt(this.ADMIN_FEE_PERCENTAGE)) / BigInt(100)).toString();

      // Check USDC allowance
      const { needsApproval, requiredAmount } = await blockchainService.checkUSDCAllowance(user.address, gameId);
      if (needsApproval) {
        throw new Error(`Insufficient USDC allowance. Required: ${requiredAmount}`);
      }

      // Lock balance on blockchain
      const tx = await blockchainService.liveGameFunds(userId, user.address, gameId);

      // Transaction record is already created in liveGameFunds with correct amounts
      const transaction = await Transaction.findOne({ transactionHash: tx.transactionHash });

      return transaction;
    } catch (error) {
      console.error("Error processing entry fee:", error);
      throw error;
    }
  }

  // Process reward distribution
  async processRewardDistribution(gameId) {
    try {
      const game = await Game.findOne({ gameId });
      if (!game || game.status !== "ACTIVE") {
        throw new Error("Game not found or not active");
      }

      // Distribute rewards on blockchain
      const result = await blockchainService.distributeRewardsAndEndGame(gameId);

      // Create transaction records for each winner
      const transactions = await Promise.all(
        result.rewards.map(async (reward) => {
          const user = await User.findByAddress(reward.user);
          if (!user) return null;

          return Transaction.create({
            transactionHash: result.transactionHash,
            userId: user._id,
            type: "REWARD",
            amount: reward.amount,
            gameId,
            status: "COMPLETED",
            blockNumber: result.blockNumber,
            blockTimestamp: new Date(),
            fromAddress: process.env.CONTRACT_ADDRESS,
            toAddress: user.address,
            gasUsed: result.gasUsed,
            gasPrice: result.effectiveGasPrice,
            networkFee: result.gasUsed * result.effectiveGasPrice,
          });
        })
      );

      return transactions.filter((t) => t !== null);
    } catch (error) {
      console.error("Error processing reward distribution:", error);
      throw error;
    }
  }

  // Process withdrawal
  async processWithdrawal(userId, transactionHash) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Create pending transaction record with required fields
      let transaction = await Transaction.create({
        transactionHash,
        userId,
        type: "WITHDRAWAL",
        status: "PENDING",
        fromAddress: process.env.CONTRACT_ADDRESS,
        toAddress: user.address,
        amount: 0, // Will be updated when transaction is confirmed
        blockNumber: 0, // Will be updated when transaction is confirmed
        blockTimestamp: new Date(), // Current timestamp for pending tx
        gasUsed: 0, // Will be updated when transaction is confirmed
        gasPrice: 0, // Will be updated when transaction is confirmed
        networkFee: 0, // Will be updated when transaction is confirmed
      });

      // Get transaction receipt
      const receipt = await blockchainService.provider.getTransactionReceipt(transactionHash);

      if (!receipt) {
        return transaction;
      }

      // Check if transaction was successful
      if (receipt.status === 1) {
        // Find BalanceWithdrawn event
        const contract = new ethers.Contract(
          process.env.CONTRACT_ADDRESS,
          FusioFantasyGameV2.abi,
          blockchainService.provider
        );

        const withdrawEvent = receipt.logs
          .map((log) => {
            try {
              return contract.interface.parseLog(log);
            } catch (e) {
              return null;
            }
          })
          .find((event) => event && event.name === "BalanceWithdrawn");

        if (!withdrawEvent) {
          throw new Error("Withdrawal event not found in transaction");
        }

        // Update transaction with complete information
        transaction = await Transaction.findOneAndUpdate(
          { transactionHash },
          {
            status: "COMPLETED",
            amount: withdrawEvent.args.amount.toString(),
            blockNumber: receipt.blockNumber,
            blockTimestamp: new Date(),
            gasUsed: receipt.gasUsed.toString(),
            gasPrice: receipt.effectiveGasPrice.toString(),
            networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
          },
          { new: true }
        );
      } else {
        // Mark transaction as failed if status is 0
        transaction = await Transaction.findOneAndUpdate({ transactionHash }, { status: "FAILED" }, { new: true });
      }

      return transaction;
    } catch (error) {
      console.error("Error processing withdrawal:", error);
      throw error;
    }
  }

  // Get transaction history for user
  async getUserTransactions(userId, options = {}) {
    try {
      const { limit = 50, offset = 0, type, status, startDate, endDate } = options;

      const query = { userId };

      if (type) query.type = type;
      if (status) query.status = status;
      if (startDate || endDate) {
        query.blockTimestamp = {};
        if (startDate) query.blockTimestamp.$gte = new Date(startDate);
        if (endDate) query.blockTimestamp.$lte = new Date(endDate);
      }

      const transactions = await Transaction.find(query).sort({ blockTimestamp: -1 }).skip(offset).limit(limit);

      const total = await Transaction.countDocuments(query);

      return {
        transactions,
        total,
        hasMore: total > offset + limit,
      };
    } catch (error) {
      console.error("Error getting user transactions:", error);
      throw error;
    }
  }

  // Get transaction details
  async getTransactionDetails(transactionHash) {
    try {
      const transaction = await Transaction.findOne({ transactionHash }).populate("userId", "username address");

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Get additional blockchain details if needed
      const receipt = await blockchainService.web3.eth.getTransactionReceipt(transactionHash);
      const tx = await blockchainService.web3.eth.getTransaction(transactionHash);

      return {
        ...transaction.toObject(),
        receipt,
        transaction: tx,
      };
    } catch (error) {
      console.error("Error getting transaction details:", error);
      throw error;
    }
  }

  // Get pending transactions
  async getPendingTransactions() {
    try {
      return await Transaction.find({ status: "PENDING" }).sort({ blockTimestamp: 1 });
    } catch (error) {
      console.error("Error getting pending transactions:", error);
      throw error;
    }
  }

  // Retry failed transaction
  async retryTransaction(transactionHash) {
    try {
      const transaction = await Transaction.findOne({ transactionHash });
      if (!transaction || transaction.status !== "FAILED") {
        throw new Error("Transaction not found or not failed");
      }

      // Retry based on transaction type
      let result;
      switch (transaction.type) {
        case "ENTRY_FEE":
          result = await this.processEntryFee(transaction.userId);
          break;
        case "WITHDRAWAL":
          result = await this.processWithdrawal(transaction.userId, transaction.amount);
          break;
        default:
          throw new Error("Cannot retry this type of transaction");
      }

      // Update original transaction
      transaction.status = "COMPLETED";
      transaction.retryTransactionHash = result.transactionHash;
      await transaction.save();

      return result;
    } catch (error) {
      console.error("Error retrying transaction:", error);
      throw error;
    }
  }

  // Get withdrawal information for user
  async getWithdrawInfo(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Get withdrawable balance from smart contract
      const withdrawableBalance = await blockchainService.getUserBalances(user.address);

      // Get locked portfolios with their game info to calculate actual locked amounts
      const lockedPortfolios = await Portfolio.find({
        userId,
        status: "LOCKED",
      }).lean();

      // Calculate total locked balance using each game's actual entry fee
      let totalLockedWei = BigInt(0);
      for (const portfolio of lockedPortfolios) {
        const game = await Game.findOne({ gameId: portfolio.gameId });
        if (game && game.entryPrice) {
          const entryFeeWei = ethers.utils.parseUnits(game.entryPrice.toString(), 18);
          totalLockedWei += BigInt(entryFeeWei.toString());
        }
      }

      // Get lost portfolios with their game info
      const lostPortfolios = await Portfolio.find({
        userId,
        status: "LOST",
      }).lean();

      // Calculate total loss balance using each game's actual entry fee
      let totalLossWei = BigInt(0);
      for (const portfolio of lostPortfolios) {
        const game = await Game.findOne({ gameId: portfolio.gameId });
        if (game && game.entryPrice) {
          const entryFeeWei = ethers.utils.parseUnits(game.entryPrice.toString(), 18);
          totalLossWei += BigInt(entryFeeWei.toString());
        }
      }

      // Get wallet balance in wei
      const walletBalanceWei = await blockchainService.getUSDCBalance(user.address);

      // Helper function to convert wei to USDC dollars
      const weiToUSDC = (weiValue) => {
        if (!weiValue) return 0;
        const weiStr = String(weiValue);
        return parseFloat(ethers.utils.formatUnits(weiStr, 18));
      };

      return {
        totalWinnings: weiToUSDC(user.totalEarnings),
        withdrawableBalance: weiToUSDC(withdrawableBalance),
        lockedBalance: weiToUSDC(totalLockedWei.toString()),
        lossBalance: weiToUSDC(totalLossWei.toString()),
        walletBalance: weiToUSDC(walletBalanceWei),
      };
    } catch (error) {
      console.error("Error getting withdrawal info:", error);
      throw error;
    }
  }
}

module.exports = new TransactionService();
