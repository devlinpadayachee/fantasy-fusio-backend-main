const { ethers } = require("ethers");
const config = require("../config");
const transactionQueue = require("./transaction-queue.service");
const FusioFantasyGameV2 = require("../config/FusioFantasyGameV2.json");
const USDC = require("../config/MockUSDC.json");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

// Fallback RPC endpoints for BSC mainnet
const BSC_RPC_ENDPOINTS = [
  process.env.BLOCKCHAIN_RPC_URL || config.blockchain.rpcUrl,
  "https://bsc-dataseed1.binance.org",
  "https://bsc-dataseed2.binance.org",
  "https://bsc-dataseed3.binance.org",
  "https://bsc-dataseed4.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed2.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc-dataseed2.ninicoin.io",
].filter(Boolean);

class BlockchainService {
  constructor() {
    this.chainId = config.blockchain.chainId || 56;
    this.currentRpcIndex = 0;
    this.maxRetries = 3;
    this.retryDelay = 1000; // Start with 1 second
    this.lastProviderRefresh = 0;
    this.providerRefreshInterval = 5 * 60 * 1000; // 5 minutes

    // Initialize provider with retry logic
    this._initializeProvider();

    // Setup admin wallet (for game management: rewards, portfolio creation, etc.)
    this.adminWallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);

    // Setup withdrawal wallet (contract owner with DEFAULT_ADMIN_ROLE for withdrawals)
    const withdrawalKey = process.env.WITHDRAWAL_WALLET_PRIVATE_KEY;
    if (withdrawalKey) {
      this.withdrawalWallet = new ethers.Wallet(withdrawalKey, this.provider);
      console.log(`[BLOCKCHAIN] Withdrawal wallet configured: ${this.withdrawalWallet.address}`);
    } else {
      // Fallback to admin wallet if no separate withdrawal wallet
      this.withdrawalWallet = this.adminWallet;
      console.log(`[BLOCKCHAIN] No separate withdrawal wallet - using admin wallet`);
    }

    // Initialize transaction queue
    transactionQueue.initialize(this.provider, this.adminWallet);

    // Setup contract instances
    this.contract = new ethers.Contract(config.blockchain.contractAddress, FusioFantasyGameV2.abi, this.adminWallet);

    // Contract instance connected to withdrawal wallet (for admin withdrawals)
    this.withdrawalContract = new ethers.Contract(
      config.blockchain.contractAddress,
      FusioFantasyGameV2.abi,
      this.withdrawalWallet
    );

    this.usdcContract = new ethers.Contract(config.blockchain.usdcAddress, USDC.abi, this.adminWallet);

    // Constants
    // ENTRY_FEE is now dynamic - retrieved from game
    this.GAS_FEE = ethers.utils.parseUnits("0.1", 18); // 0.1 USDC (can be made dynamic later)

    console.log(`[BLOCKCHAIN] Service initialized with chainId ${this.chainId}, RPC: ${BSC_RPC_ENDPOINTS[0]}`);
  }

  /**
   * Initialize provider with the current RPC endpoint
   */
  _initializeProvider() {
    const rpcUrl = BSC_RPC_ENDPOINTS[this.currentRpcIndex];
    console.log(`[BLOCKCHAIN] Initializing provider with RPC: ${rpcUrl}`);

    this.provider = new ethers.providers.JsonRpcProvider(
      {
        url: rpcUrl,
        timeout: 30000, // 30 second timeout
      },
      this.chainId
    );

    // Add error listener
    this.provider.on("error", (error) => {
      console.error(`[BLOCKCHAIN] Provider error:`, error.message);
    });

    this.lastProviderRefresh = Date.now();
  }

  /**
   * Switch to the next available RPC endpoint
   */
  _switchRpcEndpoint() {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % BSC_RPC_ENDPOINTS.length;
    const newRpc = BSC_RPC_ENDPOINTS[this.currentRpcIndex];
    console.log(`[BLOCKCHAIN] Switching to RPC endpoint: ${newRpc}`);

    this._initializeProvider();
    this._reconnectWallets();
  }

  /**
   * Reconnect wallets and contracts to new provider
   */
  _reconnectWallets() {
    this.adminWallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);

    const withdrawalKey = process.env.WITHDRAWAL_WALLET_PRIVATE_KEY;
    if (withdrawalKey) {
      this.withdrawalWallet = new ethers.Wallet(withdrawalKey, this.provider);
    } else {
      this.withdrawalWallet = this.adminWallet;
    }

    // Reconnect contracts
    this.contract = new ethers.Contract(config.blockchain.contractAddress, FusioFantasyGameV2.abi, this.adminWallet);
    this.withdrawalContract = new ethers.Contract(
      config.blockchain.contractAddress,
      FusioFantasyGameV2.abi,
      this.withdrawalWallet
    );
    this.usdcContract = new ethers.Contract(config.blockchain.usdcAddress, USDC.abi, this.adminWallet);

    // Reinitialize transaction queue with new provider
    transactionQueue.initialize(this.provider, this.adminWallet);
  }

  /**
   * Execute a blockchain call with retry logic and RPC fallback
   * @param {Function} operation - Async function to execute
   * @param {string} operationName - Name for logging
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<any>} - Result of the operation
   */
  async _executeWithRetry(operation, operationName, maxRetries = this.maxRetries) {
    let lastError;
    let totalAttempts = 0;
    const maxTotalAttempts = maxRetries * BSC_RPC_ENDPOINTS.length;

    // Check if provider needs refresh (periodic refresh to avoid stale connections)
    if (Date.now() - this.lastProviderRefresh > this.providerRefreshInterval) {
      console.log(`[BLOCKCHAIN] Refreshing provider (periodic)`);
      this._initializeProvider();
      this._reconnectWallets();
    }

    while (totalAttempts < maxTotalAttempts) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        totalAttempts++;
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          const isNetworkError = this._isNetworkError(error);

          console.warn(
            `[BLOCKCHAIN] ${operationName} failed (attempt ${attempt}/${maxRetries}, RPC ${this.currentRpcIndex + 1}/${
              BSC_RPC_ENDPOINTS.length
            }): ${error.message}`
          );

          if (isNetworkError) {
            // For network errors, wait and retry
            if (attempt < maxRetries) {
              const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
              console.log(`[BLOCKCHAIN] Retrying in ${delay}ms...`);
              await this._sleep(delay);
            }
          } else {
            // Non-network errors should not be retried
            throw error;
          }
        }
      }

      // All retries failed for current RPC, try next one
      if (totalAttempts < maxTotalAttempts) {
        console.log(`[BLOCKCHAIN] All retries failed for current RPC, switching endpoint...`);
        this._switchRpcEndpoint();
      }
    }

    // All RPC endpoints and retries exhausted
    throw lastError;
  }

  /**
   * Check if an error is a network-related error that should trigger retry
   */
  _isNetworkError(error) {
    const networkErrorPatterns = [
      "NETWORK_ERROR",
      "noNetwork",
      "could not detect network",
      "TIMEOUT",
      "timeout",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "SERVER_ERROR",
      "missing response",
      "bad response",
      "connection refused",
      "socket hang up",
      "network request failed",
      "failed to fetch",
      "rate limit",
      "Too Many Requests",
      "429",
    ];

    const errorMessage = error.message || error.toString();
    const errorCode = error.code || "";

    return networkErrorPatterns.some(
      (pattern) =>
        errorMessage.toLowerCase().includes(pattern.toLowerCase()) ||
        errorCode.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Sleep utility
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async checkUSDCAllowance(userAddress, gameId) {
    try {
      const [requiredAmount, currentAllowance] = await this._executeWithRetry(async () => {
        const required = await this.contract.getRequiredUSDCApproval(userAddress, gameId);
        const allowance = await this.usdcContract.allowance(userAddress, config.blockchain.contractAddress);
        return [required, allowance];
      }, `checkUSDCAllowance(${userAddress}, ${gameId})`);

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
      const balance = await this._executeWithRetry(
        () => this.usdcContract.balanceOf(address),
        `getUSDCBalance(${address})`
      );
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
        // Get current nonce from contract
        const ownerNonce = await this.contract.nonce();

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
      const portfolio = await this._executeWithRetry(
        () => this.contract.getPortfolio(userAddress, portfolioId),
        `getPortfolio(${userAddress}, ${portfolioId})`
      );
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
      const ids = await this._executeWithRetry(
        () => this.contract.getUserPortfolioIds(userAddress),
        `getUserPortfolioIds(${userAddress})`
      );
      return ids.map((id) => id.toNumber());
    } catch (error) {
      throw new Error(`Failed to get user portfolio IDs: ${error.message}`);
    }
  }

  async getCurrentGameId() {
    try {
      const id = await this._executeWithRetry(() => this.contract.currentGameId(), "getCurrentGameId");
      return id.toNumber();
    } catch (error) {
      throw new Error(`Failed to get current game ID: ${error.message}`);
    }
  }

  async getUserBalances(userAddress) {
    try {
      const balance = await this._executeWithRetry(
        () => this.contract.userBalance(userAddress),
        `getUserBalances(${userAddress})`
      );
      // Return raw wei value as string (blockchain always returns wei)
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get user balance: ${error.message}`);
    }
  }

  async getUserLockedBalance(userAddress) {
    try {
      const balance = await this._executeWithRetry(
        () => this.contract.getUserLockedBalance(userAddress),
        `getUserLockedBalance(${userAddress})`
      );
      return balance.toString();
    } catch (error) {
      throw new Error(`Failed to get user locked balance: ${error.message}`);
    }
  }

  // Get winners array for a game from the gameWinners mapping
  async getGameWinners(gameId) {
    try {
      // Call the public gameWinners mapping getter
      const winners = await this._executeWithRetry(
        () => this.contract.getGameWinners(gameId),
        `getGameWinners(${gameId})`
      );
      // Convert BigNumber array to number array
      return Array.from(winners).map((id) => id.toNumber());
    } catch (error) {
      throw new Error(`Failed to get game winners: ${error.message}`);
    }
  }

  async isWinnersCalculationComplete(gameId) {
    try {
      return await this._executeWithRetry(
        () => this.contract.isWinnersCalculationComplete(gameId),
        `isWinnersCalculationComplete(${gameId})`
      );
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
        // Get current nonce from contract
        const ownerNonce = await this.contract.nonce();

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
      const gameDetails = await this._executeWithRetry(
        () => this.contract.getGameDetails(gameId),
        `getGameDetails(${gameId})`
      );
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

  // Withdraw undistributed prize pool from a game (uses withdrawal wallet with DEFAULT_ADMIN_ROLE)
  async withdrawFromPrizePool(gameId, amount) {
    try {
      console.log(`[BLOCKCHAIN] Withdrawing ${amount} from game ${gameId} prize pool`);
      console.log(`[BLOCKCHAIN] Using withdrawal wallet: ${this.withdrawalWallet.address}`);

      // Use withdrawal wallet directly (not transaction queue - different wallet)
      const nonce = await this.withdrawalWallet.getTransactionCount("pending");

      const tx = await this.withdrawalContract.adminWithdrawFromPrizePool(gameId, amount, {
        gasLimit: 300000,
        nonce,
      });

      console.log(`[BLOCKCHAIN] Withdrawal tx sent: ${tx.hash}`);
      const receipt = await tx.wait();

      console.log(`[BLOCKCHAIN] Withdrawal successful: ${receipt.transactionHash}`);

      return {
        transactionHash: receipt.transactionHash,
        gameId,
        amount,
        withdrawalWallet: this.withdrawalWallet.address,
      };
    } catch (error) {
      throw new Error(`Failed to withdraw from prize pool: ${error.message}`);
    }
  }

  // Update game status on blockchain (transitions based on time)
  // GameStatus enum: 0=NotStarted, 1=Active, 2=Ended
  async updateGameStatus(gameId) {
    try {
      console.log(`[BLOCKCHAIN] Updating game ${gameId} status on-chain`);

      const receipt = await transactionQueue.addTransaction(async (nonce) => {
        return await this.contract.updateGameStatus(gameId, {
          gasLimit: 150000,
          nonce,
        });
      }, `UpdateGameStatus game ${gameId}`);

      console.log(`[BLOCKCHAIN] Game ${gameId} status updated: ${receipt.transactionHash}`);

      return {
        transactionHash: receipt.transactionHash,
        gameId,
      };
    } catch (error) {
      // If already in correct state, don't throw
      if (error.message.includes("already") || error.message.includes("status")) {
        console.log(`[BLOCKCHAIN] Game ${gameId} status already correct or updated`);
        return { gameId, alreadyUpdated: true };
      }
      throw new Error(`Failed to update game status: ${error.message}`);
    }
  }

  async getPortfolioOwner(portfolioId) {
    try {
      const owner = await this._executeWithRetry(
        () => this.contract.getPortfolioOwner(portfolioId),
        `getPortfolioOwner(${portfolioId})`
      );
      return owner;
    } catch (error) {
      throw new Error(`Failed to get portfolio owner: ${error.message}`);
    }
  }

  // Check if the wallets have the required roles on the contract
  async checkAdminRole() {
    try {
      const adminAddress = this.adminWallet.address;
      const withdrawalAddress = this.withdrawalWallet.address;

      // Role hashes from the contract
      const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero; // 0x0000...
      const GAME_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GAME_MANAGER_ROLE"));

      const [adminHasDefaultAdminRole, adminHasGameManagerRole, withdrawalHasDefaultAdminRole] =
        await this._executeWithRetry(
          () =>
            Promise.all([
              this.contract.hasRole(DEFAULT_ADMIN_ROLE, adminAddress),
              this.contract.hasRole(GAME_MANAGER_ROLE, adminAddress),
              this.contract.hasRole(DEFAULT_ADMIN_ROLE, withdrawalAddress),
            ]),
          "checkAdminRole"
        );

      return {
        // Admin wallet (for game management)
        adminAddress,
        adminHasDefaultAdminRole,
        adminHasGameManagerRole, // Required for: batchAssignRewards, updateGameStatus
        // Withdrawal wallet (for prize pool withdrawals)
        withdrawalAddress,
        withdrawalHasDefaultAdminRole, // Required for: adminWithdrawFromPrizePool
        isSameWallet: adminAddress === withdrawalAddress,
      };
    } catch (error) {
      throw new Error(`Failed to check admin role: ${error.message}`);
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
      console.log(`[BLOCKCHAIN] batchAssignRewards called for game ${gameId}`);
      console.log(`[BLOCKCHAIN]   Portfolios: ${portfolioIds.length}, Amounts: ${amounts.length}`);

      if (portfolioIds.length === 0) {
        console.log(`[BLOCKCHAIN] No portfolios to process, skipping`);
        return { transactionHash: null, skipped: true };
      }

      if (portfolioIds.length !== amounts.length) {
        throw new Error(`Portfolio/amount mismatch: ${portfolioIds.length} portfolios, ${amounts.length} amounts`);
      }

      // CRITICAL: Signature must be generated INSIDE the queue callback
      // to ensure the contract nonce is fresh when the transaction executes.
      // The queue processes transactions sequentially, so by the time this
      // callback runs, the contract nonce will be correct for THIS transaction.
      const receipt = await transactionQueue.addTransaction(async (walletNonce) => {
        // Get fresh contract nonce right before signing
        const contractNonce = await this.contract.nonce();
        console.log(`[BLOCKCHAIN] Contract nonce: ${contractNonce}, Wallet nonce: ${walletNonce}`);

        const chainId = (await this.provider.getNetwork()).chainId;

        const domain = {
          name: "FusioFantasyGameV2",
          version: "1",
          chainId: chainId,
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
          nonce: contractNonce.toNumber(),
        };

        // Generate signature with fresh nonce
        const signature = await this.adminWallet._signTypedData(domain, types, value);

        // Dynamic gas limit based on batch size (more portfolios = more gas)
        const baseGas = 100000;
        const perPortfolioGas = 50000;
        const estimatedGas = baseGas + portfolioIds.length * perPortfolioGas;
        const gasLimit = Math.min(estimatedGas, 3000000); // Cap at 3M

        console.log(`[BLOCKCHAIN] Sending batchAssignRewards tx (gas: ${gasLimit})`);

        return await this.contract.batchAssignRewards(portfolioIds, amounts, signature, {
          gasLimit,
          nonce: walletNonce,
        });
      }, `BatchAssignRewards for game ${gameId} (${portfolioIds.length} winners)`);

      console.log(`[BLOCKCHAIN] ✅ batchAssignRewards success: ${receipt.transactionHash}`);

      return {
        transactionHash: receipt.transactionHash,
      };
    } catch (error) {
      console.error(`[BLOCKCHAIN] ❌ batchAssignRewards failed for game ${gameId}:`, error.message);
      throw new Error(`Failed to batch assign rewards: ${error.message}`);
    }
  }
}

module.exports = new BlockchainService();
