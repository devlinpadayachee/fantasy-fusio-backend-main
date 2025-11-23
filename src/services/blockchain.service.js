const { ethers } = require("ethers");
const config = require("../config");
const transactionQueue = require("./transaction-queue.service");
const FusioFantasyGameV2 = require("../config/FusioFantasyGameV2.json");
const USDC = require("../config/MockUSDC.json");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

class BlockchainService {
  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(config.blockchain.rpcUrl, 56);

    // Setup admin wallet
    this.adminWallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);

    // Initialize transaction queue
    transactionQueue.initialize(this.provider, this.adminWallet);

    // Setup contract instances
    this.contract = new ethers.Contract(config.blockchain.contractAddress, FusioFantasyGameV2.abi, this.adminWallet);

    this.usdcContract = new ethers.Contract(config.blockchain.usdcAddress, USDC.abi, this.adminWallet);

    // Constants
    // ENTRY_FEE is now dynamic - retrieved from game
    this.GAS_FEE = ethers.utils.parseUnits("0.1", 18); // 0.1 USDC (can be made dynamic later)
  }

  async checkUSDCAllowance(userAddress, gameId) {
    try {
      const requiredAmount = await this.contract.getRequiredUSDCApproval(userAddress, gameId);
      const currentAllowance = await this.usdcContract.allowance(userAddress, config.blockchain.contractAddress);

      return {
        needsApproval: currentAllowance.lt(requiredAmount),
        requiredAmount: requiredAmount.toString(), // wei string
        currentAllowance: currentAllowance.toString(), // wei string
      };
    } catch (error) {
      throw new Error(`Failed to check USDC allowance: ${error.message}`);
    }
  }

  async getUSDCBalance(address) {
    try {
      const balance = await this.usdcContract.balanceOf(address);
      // Return raw wei value as string for consistent DB storage
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get USDC balance: ${error.message}`);
    }
  }

  // Helper function to sign messages
  async signMessage(data) {
    try {
      const messageHash = ethers.utils.solidityKeccak256(["address", "uint256"], [this.adminWallet.address, data]);
      const signature = await this.adminWallet.signMessage(ethers.utils.arrayify(messageHash));
      return signature;
    } catch (error) {
      throw new Error(`Failed to sign message: ${error.message}`);
    }
  }

  async liveGameFunds(userId, userAddress, gameId) {
    try {
      // Get the actual game to retrieve correct entry fee
      const Game = require("../models/Game");
      const game = await Game.findOne({ gameId });
      if (!game) {
        throw new Error(`Game ${gameId} not found`);
      }

      // Calculate entry fee from game's actual price
      const entryFeeWei = ethers.utils.parseUnits(game.entryPrice.toString(), 18);

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.liveGameFunds(userAddress, {
          gasLimit: 500000,
          nonce,
        });
      }, `LiveGameFunds for user ${userAddress}`);

      // Create transaction record with actual amounts
      // Calculate total amount using BigNumber (entry fee + gas)
      const totalAmount = entryFeeWei.add(this.GAS_FEE);

      await Transaction.create({
        transactionHash: receipt.transactionHash,
        userId,
        type: "ENTRY_FEE",
        amount: totalAmount.toString(),
        gameId: gameId,
        status: "COMPLETED",
        blockNumber: receipt.blockNumber,
        blockTimestamp: new Date(),
        fromAddress: userAddress,
        toAddress: config.blockchain.contractAddress,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.effectiveGasPrice.toString(),
        networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
        metadata: {
          entryFee: entryFeeWei.toString(),
          gasFee: this.GAS_FEE.toString(),
          adminFee: entryFeeWei.mul(10).div(100).toString(), // 10% admin fee
        },
      });

      return receipt;
    } catch (error) {
      throw new Error(`Failed to lock user balance: ${error.message}`);
    }
  }

  // Portfolio Management
  async createAndLockPortfolio(userId, userAddress, symbols, allocations, tokenQtys, gameType, isApe) {
    try {
      // Convert symbols to bytes32
      const bytes32Symbols = symbols.map((symbol) => ethers.utils.formatBytes32String(symbol));

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        // Get current owner nonce
        const ownerNonce = await this.contract.ownerNonce();

        // Create message hash for signing
        const messageHash = ethers.utils.solidityKeccak256(
          ["address", "bytes32[]", "uint256[]", "uint8", "bool", "uint256"],
          [userAddress, bytes32Symbols, tokenQtys, gameType === "DEFI" ? 0 : 1, isApe, ownerNonce]
        );

        // Sign the message
        const signature = await this.adminWallet.signMessage(ethers.utils.arrayify(messageHash));

        return await this.contract.createAndLockPortfolio(
          userAddress,
          bytes32Symbols,
          tokenQtys,
          gameType === "DEFI" ? 0 : 1,
          isApe,
          signature,
          {
            gasLimit: 1000000,
            nonce,
          }
        );
      }, `CreateAndLockPortfolio for user ${userAddress}`);

      // Get portfolio ID and entry fee from events
      const portfolioCreatedEvent = receipt.events.find((e) => e.event === "PortfolioCreated");
      const portfolioEntryFeePaidEvent = receipt.events.find((e) => e.event === "PortfolioEntryFeePaid");

      console.log("event.args -", portfolioCreatedEvent.args);
      const portfolioId = portfolioCreatedEvent.args.portfolioId.toNumber();
      const gameId = portfolioCreatedEvent.args.gameId.toNumber();

      // Get actual entry fee from blockchain event (this is the REAL amount charged)
      const actualEntryFee = portfolioEntryFeePaidEvent ? portfolioEntryFeePaidEvent.args.entryFee.toString() : "0";
      const actualAdminFee = portfolioEntryFeePaidEvent ? portfolioEntryFeePaidEvent.args.adminFee.toString() : "0";

      // Create transaction record with ACTUAL amounts from blockchain
      await Transaction.create({
        transactionHash: receipt.transactionHash,
        userId,
        type: "CREATE_PORTFOLIO",
        amount: isApe ? "0" : actualEntryFee,
        adminFee: isApe ? "0" : actualAdminFee,
        gameId: gameId,
        portfolioId,
        status: "COMPLETED",
        blockNumber: receipt.blockNumber,
        blockTimestamp: new Date(),
        fromAddress: userAddress,
        toAddress: config.blockchain.contractAddress,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.effectiveGasPrice.toString(),
        networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
      });

      return { portfolioId, receipt };
    } catch (error) {
      throw new Error(`Failed to create portfolio: ${error.message}`);
    }
  }

  // Game Management
  async createGame(gameId, startTime, endTime, entryFee, entryCap) {
    try {
      const entryFeeInWei = ethers.utils.parseUnits(entryFee.toString(), 18);

      console.log(
        gameId,
        Math.floor(startTime.getTime() / 1000),
        Math.floor(endTime.getTime() / 1000),
        entryFeeInWei.toString()
      );

      // Check transaction before broadcasting
      const gasEstimate = await this.contract.estimateGas.createGame(
        gameId,
        Math.floor(startTime.getTime() / 1000),
        Math.floor(endTime.getTime() / 1000),
        entryFeeInWei,
        entryCap.toString()
      );

      if (gasEstimate.gt(600000)) {
        throw new Error("Gas estimate too high, transaction likely to fail");
      }

      const txResponse = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.createGame(
          gameId,
          Math.floor(startTime.getTime() / 1000),
          Math.floor(endTime.getTime() / 1000),
          entryFeeInWei,
          entryCap.toString(),
          {
            gasLimit: 600000,
            nonce,
          }
        );
      }, `CreateGame for gameId ${gameId}`);

      // Get game ID from event
      const event = txResponse.events.find((e) => e.event === "GameCreated");

      return {
        gameId: event.args.gameId.toNumber(),
        transactionHash: txResponse.transactionHash,
      };
    } catch (error) {
      throw new Error(`Failed to create game: ${error.message}`);
    }
  }

  // View Functions
  async getPortfolio(userAddress, portfolioId) {
    try {
      const portfolio = await this.contract.getPortfolio(userAddress, portfolioId);
      return {
        symbols: portfolio[0].map((symbol) => ethers.utils.parseBytes32String(symbol)),
        allocations: portfolio[1].map((n) => n.toString()),
        tokenQtys: portfolio[2].map((n) => n.toString()),
        isDeFi: portfolio[3],
        isLocked: portfolio[4],
        entryTimestamp: portfolio[5].toNumber(),
        lockedBalance: portfolio[6].toString(),
        gameId: portfolio[7].toNumber(),
      };
    } catch (error) {
      throw new Error(`Failed to get portfolio: ${error.message}`);
    }
  }

  async getUserPortfolioIds(userAddress) {
    try {
      const ids = await this.contract.getUserPortfolioIds(userAddress);
      return ids.map((id) => id.toNumber());
    } catch (error) {
      throw new Error(`Failed to get user portfolio IDs: ${error.message}`);
    }
  }

  async getCurrentGameId() {
    try {
      const id = await this.contract.currentGameId();
      return id.toNumber();
    } catch (error) {
      throw new Error(`Failed to get current game ID: ${error.message}`);
    }
  }

  async getUserBalances(userAddress) {
    try {
      const balance = await this.contract.userBalance(userAddress);
      // Return raw wei value as string (blockchain always returns wei)
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get user balance: ${error.message}`);
    }
  }

  async getUserLockedBalance(userAddress) {
    try {
      const balance = await this.contract.getUserLockedBalance(userAddress);
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get user locked balance: ${error.message}`);
    }
  }

  // Get winners array for a game from the gameWinners mapping
  async getGameWinners(gameId) {
    try {
      // Call the public gameWinners mapping getter
      const winners = await this.contract.getGameWinners(gameId);
      // Convert BigNumber array to number array
      return Array.from(winners).map((id) => id.toNumber());
    } catch (error) {
      throw new Error(`Failed to get game winners: ${error.message}`);
    }
  }

  async isWinnersCalculationComplete(gameId) {
    try {
      return await this.contract.isWinnersCalculationComplete(gameId);
    } catch (error) {
      throw new Error(`Failed to check winners calculation status: ${error.message}`);
    }
  }

  async calculateWinners(gameId, batchSize = 50) {
    try {
      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.calculateWinners(gameId, batchSize, {
          gasLimit: 1000000,
          nonce,
        });
      }, `CalculateWinners for game ${gameId}`);

      // Get progress from events
      const progressEvent = receipt.events.find((e) => e.event === "WinnersCalculationProgress");
      const completeEvent = receipt.events.find((e) => e.event === "WinnersCalculationComplete");

      if (completeEvent) {
        return {
          transactionHash: receipt.transactionHash,
          isComplete: true,
          winnerCount: completeEvent.args.winnerCount.toNumber(),
        };
      } else if (progressEvent) {
        return {
          transactionHash: receipt.transactionHash,
          isComplete: false,
          processedCount: progressEvent.args.processedCount.toNumber(),
          totalCount: progressEvent.args.totalCount.toNumber(),
        };
      }
      return {
        transactionHash: receipt.transactionHash,
        isComplete: false,
      };
    } catch (error) {
      throw new Error(`Failed to calculate winners: ${error.message}`);
    }
  }

  async distributeRewards(gameId, start, end) {
    try {
      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.distributeRewards(gameId, start, end, {
          gasLimit: 1000000,
          nonce,
        });
      }, `DistributeRewards for game ${gameId} (${start}-${end})`);

      // Get reward distribution details from events
      const distributionEvents = receipt.events
        .filter((e) => e.event === "RewardDistributed")
        .map((e) => ({
          portfolioId: e.args.portfolioId.toNumber(),
          amount: e.args.amount.toString(),
        }));

      return {
        transactionHash: receipt.transactionHash,
        distributions: distributionEvents,
      };
    } catch (error) {
      throw new Error(`Failed to distribute rewards: ${error.message}`);
    }
  }

  async endGame(gameId) {
    try {
      const tx = await this.contract.endGame(gameId, {
        gasLimit: 500000,
      });

      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      throw new Error(`Failed to end game: ${error.message}`);
    }
  }

  async updatePortfolioValue(portfolioId, currentValue, gameId) {
    try {
      const parsedValue = ethers.utils.parseUnits(currentValue.toString(), 6);

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        // Get current owner nonce
        const ownerNonce = await this.contract.ownerNonce();

        // Create message hash for signing
        const messageHash = ethers.utils.solidityKeccak256(
          ["uint256", "uint256", "uint256", "uint256"],
          [portfolioId, parsedValue, gameId, ownerNonce]
        );

        // Sign the message
        const signature = await this.adminWallet.signMessage(ethers.utils.arrayify(messageHash));

        return await this.contract.updatePortfolioValue(portfolioId, parsedValue, gameId, signature, {
          gasLimit: 500000,
          nonce,
        });
      }, `UpdatePortfolioValue for portfolio ${portfolioId} in game ${gameId}`);
      return receipt;
    } catch (error) {
      throw new Error(`Failed to update portfolio value: ${error.message}`);
    }
  }
  async getGameDetails(gameId) {
    try {
      const gameDetails = await this.contract.getGameDetails(gameId);
      return {
        startTime: gameDetails[0].toNumber(),
        endTime: gameDetails[1].toNumber(),
        totalPrizePool: gameDetails[2].toString(),
        totalRewardDistributed: gameDetails[3].toString(),
        entryCount: gameDetails[4].toNumber(),
      };
    } catch (error) {
      throw new Error(`Failed to get game details: ${error.message}`);
    }
  }

  async getPortfolioOwner(portfolioId) {
    try {
      const owner = await this.contract.getPortfolioOwner(portfolioId);
      return owner;
    } catch (error) {
      throw new Error(`Failed to get portfolio owner: ${error.message}`);
    }
  }

  async mintUSDC(toAddress, amount) {
    try {
      const amountInWei = ethers.utils.parseUnits(amount.toString(), 18);

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.usdcContract.mint(toAddress, amountInWei, {
          gasLimit: 500000,
          nonce,
        });
      }, `Mint USDC to ${toAddress} amount ${amount}`);

      return {
        transactionHash: receipt.transactionHash,
        toAddress,
        amount: amountInWei.toString(),
      };
    } catch (error) {
      throw new Error(`Failed to mint USDC: ${error.message}`);
    }
  }
  async batchAssignRewards(gameId, portfolioIds, amounts) {
    try {
      const currentNonce = await this.contract.nonce();

      const domain = {
        name: "FusioFantasyGameV2",
        version: "1",
        chainId: (await this.provider.getNetwork()).chainId,
        verifyingContract: this.contract.address,
      };

      const types = {
        BatchAssignRewards: [
          { name: "portfolioIds", type: "uint256[]" },
          { name: "amounts", type: "uint256[]" },
          { name: "nonce", type: "uint256" },
        ],
      };

      const value = {
        portfolioIds,
        amounts,
        nonce: currentNonce.toNumber(),
      };

      // Generate signature using _signTypedData
      const signature = await this.adminWallet._signTypedData(domain, types, value);

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.batchAssignRewards(portfolioIds, amounts, signature, {
          gasLimit: 1500000,
          nonce,
        });
      }, `BatchAssignRewards for game ${gameId}`);

      return {
        transactionHash: receipt.transactionHash,
      };
    } catch (error) {
      throw new Error(`Failed to batch assign rewards: ${error.message}`);
    }
  }
}

module.exports = new BlockchainService();
