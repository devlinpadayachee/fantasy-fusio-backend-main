const Game = require("../models/Game");
const Portfolio = require("../models/Portfolio");
const User = require("../models/User");
const Asset = require("../models/Asset");
const Notification = require("../models/Notification");
const blockchainService = require("./blockchain.service");
const priceService = require("./price.service");
const winConditions = require("./win-conditions");
const { ethers } = require("ethers");

class GameService {
  constructor() {}

  // Get games by status (supports array of statuses)
  async getGamesByStatus(status) {
    try {
      const query = Array.isArray(status) ? { status: { $in: status } } : { status: status };
      const games = await Game.find(query).sort({ startTime: 1 });
      return games;
    } catch (error) {
      console.error(`Error fetching games with status ${status}:`, error);
      throw error;
    }
  }

  // Create a game from a GameCron object
  async createGameFromCron(gameCron) {
    try {
      // Defensive validation for winCondition.config presence except for MARLOW_BANES type
      if (!gameCron.winCondition || (gameCron.winCondition.type !== "MARLOW_BANES" && !gameCron.winCondition.config)) {
        throw new Error("Invalid gameCron: winCondition.config is required");
      }

      // Calculate startTime and endTime based on gameCron
      const startTime = new Date();
      startTime.setTime(startTime.getTime() + gameCron.startTime * 60 * 60 * 1000);
      const endTime = new Date(startTime.getTime() + gameCron.gameDuration * 60 * 60 * 1000);

      // Get max gameId from DB for both DEFI and TRADFI
      const maxGame = await Game.findOne({}).sort({ gameId: -1 }).select("gameId").lean();

      const nextGameId = maxGame ? maxGame.gameId + 1 : 1 + 1;

      // Create the game document
      const game = new Game({
        gameId: nextGameId,
        gameType: gameCron.gameType,
        name: gameCron.customGameName || `Game ${nextGameId}`, // Use customGameName if provided
        status: "TRX-PENDING",
        startTime,
        endTime,
        totalPrizePool: 0,
        participantCount: 0,
        winCondition: gameCron.winCondition,
        entryPrice: gameCron.entryPrice,
        entryCap: gameCron.entryCap,
        gameCronId: gameCron._id,
      });
      await game.save();
      // Create game on blockchain
      const blockchainResult = await blockchainService.createGame(
        game.gameId,
        startTime,
        endTime,
        gameCron.entryPrice,
        gameCron.entryCap
      );

      game.transactionHash = blockchainResult.transactionHash;
      game.status = "UPCOMING";
      await game.save();

      console.log(`Game ${game.gameId} created from cron successfully`);
      return game;
    } catch (error) {
      console.error("Error creating game from cron:", error);
      throw error;
    }
  }

  // Generate Ape's portfolio using AI-powered market analysis
  // The APE is a system opponent that doesn't pay entry fees or compete for prize pool
  // Returns { portfolioId, aiResult } for Discord notification
  async generateApePortfolio(gameId, gameType) {
    const marlowAI = require("./marlow-ai.service");

    try {
      // Get the APE user (Marlow Banes system account)
      const apeUser = await User.findById(process.env.APE_USER_ID);
      if (!apeUser) {
        throw new Error("APE user not found. Please set APE_USER_ID in environment variables.");
      }

      // Check if APE portfolio already exists for this game
      const existingApePortfolio = await Portfolio.findOne({
        gameId: gameId,
        isApe: true,
      });
      if (existingApePortfolio) {
        console.log(
          `🦍 Marlow Banes portfolio already exists for game ${gameId}: portfolioId=${existingApePortfolio.portfolioId}`
        );
        // Return existing portfolio with stored AI metadata
        return {
          portfolioId: existingApePortfolio.portfolioId,
          aiResult: existingApePortfolio.metadata || null,
          isExisting: true,
        };
      }

      // 🧠 USE MARLOW AI TO GENERATE SMART PORTFOLIO
      console.log(`🦍🧠 Marlow AI generating portfolio for game ${gameId} (${gameType})...`);
      const aiPicks = await marlowAI.generateSmartPortfolio(gameType, 8);

      const INITIAL_VALUE = 100000; // $100,000 initial portfolio value

      // Map AI picks to portfolio assets
      const portfolioAssets = aiPicks.assets.map((asset, index) => ({
        assetId: asset.assetId,
        symbol: asset.symbol,
        allocation: aiPicks.allocations[index],
        tokenQty: 0, // Will be calculated in lockPortfolios based on price at lock time
      }));

      // Verify uniqueness
      const uniqueSymbols = new Set(portfolioAssets.map((a) => a.symbol));
      if (uniqueSymbols.size !== portfolioAssets.length) {
        throw new Error("Marlow AI selected duplicate assets");
      }

      // Verify allocations sum to initial value
      const totalAllocation = aiPicks.allocations.reduce((sum, a) => sum + a, 0);
      if (Math.abs(totalAllocation - INITIAL_VALUE) > 100) {
        console.warn(`⚠️ Marlow AI allocations sum to ${totalAllocation}, adjusting...`);
        // Normalize allocations
        const ratio = INITIAL_VALUE / totalAllocation;
        portfolioAssets.forEach((asset, i) => {
          asset.allocation = Math.round(aiPicks.allocations[i] * ratio);
        });
      }

      // Generate a unique portfolio ID for APE (prefix with 9 to distinguish from regular portfolios)
      const portfolioId = parseInt(`9${String(gameId).padStart(4, "0")}${Date.now().toString().slice(-8)}`);

      console.log(`🦍 Creating Marlow Banes AI portfolio: portfolioId=${portfolioId}`);
      console.log(`🦍 Strategy: ${aiPicks.strategy?.type || "Adaptive"}`);

      // Create portfolio in database only - no blockchain registration needed
      const portfolio = new Portfolio({
        userId: apeUser._id,
        portfolioName: "MARLOW BANES",
        gameId: gameId,
        gameType: gameType,
        portfolioId: portfolioId,
        assets: portfolioAssets,
        status: "PENDING",
        isLocked: false,
        isApe: true,
        initialValue: INITIAL_VALUE,
        currentValue: INITIAL_VALUE,
        // Store AI reasoning for transparency/debugging
        metadata: {
          aiStrategy: aiPicks.strategy,
          assetReasons: aiPicks.assets.map((a) => ({ symbol: a.symbol, score: a.score, reasoning: a.reasoning })),
          generatedAt: new Date(),
        },
      });
      await portfolio.save();

      console.log(`🦍✅ Marlow Banes AI portfolio created for game ${gameId}`);

      // Return both portfolioId and AI result for Discord notification
      return {
        portfolioId,
        aiResult: aiPicks,
        isExisting: false,
      };
    } catch (error) {
      console.error("Error generating Marlow AI portfolio:", error);
      throw error;
    }
  }

  // Lock portfolios at game start
  async lockPortfolios(game) {
    try {
      const portfolios = await Portfolio.find({
        status: "PENDING",
        gameId: game.gameId,
        isLocked: false,
      })
        .populate("userId")
        .sort({ createdAt: 1 });

      const assetData = await Asset.find({ type: game.gameType }).select("currentPrice assetId");

      const currentPrices = assetData.reduce((acc, asset) => {
        acc[asset.assetId] = asset.currentPrice;
        return acc;
      }, {});

      for (const portfolio of portfolios) {
        try {
          const tokenQtys = portfolio.assets.map((asset) => {
            const price = currentPrices[asset.assetId] || 0;
            if (price <= 0) return 0;
            return Number((asset.allocation / price).toFixed(6));
          });

          portfolio.assets.forEach((asset, index) => {
            asset.tokenQty = tokenQtys[index];
          });

          portfolio.isLocked = true;
          portfolio.gameId = game.gameId;
          portfolio.status = "LOCKED";
          portfolio.lockedAt = new Date();
          await portfolio.save();
        } catch (error) {
          portfolio.error = error.message;
          await portfolio.save();
          console.error(`Error locking portfolio ${portfolio._id}:`, error);
        }
      }

      const remainingPendingPortfolios = await Portfolio.countDocuments({
        status: "PENDING",
        gameId: game.gameId,
        isLocked: false,
      });

      if (remainingPendingPortfolios > 0) {
        console.log(`Game ${game.gameId} has ${remainingPendingPortfolios} pending portfolios, not activating yet`);
        return;
      }

      console.log(`Game ${game.gameId} started with ${game.participantCount} participants`);
    } catch (error) {
      console.error("Error locking portfolios:", error);
      throw error;
    }
  }

  async updateGameState(gameId) {
    try {
      const game = await Game.findOne({ gameId });
      if (!game || game.status !== "ACTIVE") {
        return;
      }

      const portfolios = await Portfolio.find({
        gameId,
        status: "ACTIVE",
      }).populate("userId");

      // Get current prices for all assets
      const assets = await Asset.find({ type: game.gameType });
      const prices = await priceService.getCurrentPrices(assets);

      // Update portfolio values
      for (const portfolio of portfolios) {
        try {
          await portfolio.calculateValue(prices);
        } catch (error) {
          console.error(`Error updating portfolio ${portfolio._id}:`, error);
        }
      }

      // Update Ape's portfolio value
      const apePortfolio = await Portfolio.findOne({
        portfolioId: game.apePortfolio.portfolioId,
      });
      if (apePortfolio) {
        await apePortfolio.calculateValue(prices);
        game.apePortfolio.currentValue = apePortfolio.currentValue;
        game.apePortfolio.performancePercentage = apePortfolio.performancePercentage;
        await game.save();
      }

      console.log(`Game ${gameId} state updated successfully`);
    } catch (error) {
      console.error("Error updating game state:", error);
      throw error;
    }
  }

  // Calculate winners for a game
  // Delegates to the appropriate win condition calculator based on game type
  async calculateGameWinners(game) {
    try {
      // ========================================
      // PRE-CALCULATION VALIDATION
      // ========================================
      console.log(`\n========== WINNER CALCULATION START: Game ${game.gameId} ==========`);

      // 1. Validate all portfolios have valid values
      const allPortfolios = await Portfolio.find({
        gameId: game.gameId,
        status: "LOCKED",
      });

      const invalidPortfolios = allPortfolios.filter(
        (p) => !p.currentValue || p.currentValue === 0 || !isFinite(p.performancePercentage)
      );

      if (invalidPortfolios.length > 0) {
        game.status = "FAILED";
        game.error = `Cannot calculate winners: ${invalidPortfolios.length} portfolios have invalid values`;
        await game.save();
        console.error(`❌ Game ${game.gameId} FAILED: ${invalidPortfolios.length} portfolios with invalid values`);
        console.error(
          "Invalid portfolio IDs:",
          invalidPortfolios.map((p) => p.portfolioId)
        );
        return;
      }

      // 2. Check asset prices are recent (< 15 minutes old)
      const assets = await Asset.find({ type: game.gameType });
      const staleAssets = assets.filter((a) => Date.now() - new Date(a.lastUpdated).getTime() > 15 * 60 * 1000);

      if (staleAssets.length > 0) {
        console.warn(`⚠️  Warning: ${staleAssets.length} assets have stale prices (>15 min old)`);
        console.warn(
          "Stale assets:",
          staleAssets.map((a) => `${a.symbol} (${a.lastUpdated})`)
        );
      }

      console.log(`✅ Validation passed: ${allPortfolios.length} portfolios, ${assets.length} assets`);
      console.log(`Win Condition: ${game.winCondition.type}`);

      // ========================================
      // DELEGATE TO APPROPRIATE WIN CONDITION CALCULATOR
      // ========================================
      const calculator = winConditions.getCalculator(game.winCondition.type);
      await calculator.calculateWinners(game);
    } catch (error) {
      console.error("Error calculating game winners:", error);
      throw error;
    }
  }

  // Distribute rewards in batches (all winners treated the same)
  // IMPORTANT: This function is called by cron for ONE game at a time to prevent
  // blockchain transaction nonce collisions
  async distributeGameRewards(game, batchSize = 50, retryCount = 0, maxRetries = 5) {
    const gameId = game.gameId;

    try {
      // Refresh game data to get latest state
      await game.populate("winners");
      const undistributedWinners = game.winners.filter((w) => !w.isRewardDistributed);

      console.log(`[REWARDS] Game ${gameId}: ${undistributedWinners.length} undistributed winners remaining`);

      if (undistributedWinners.length === 0) {
        console.log(`[REWARDS] Game ${gameId}: All rewards distributed, marking complete`);
        await game.markFullyDistributed();
        game.status = "COMPLETED";
        await game.save();
        return;
      }

      // ====== OPTIMIZATION: Check if only APE winners exist ======
      // If all winners are APE portfolios (Marlow won), skip blockchain entirely
      // This saves gas fees since APE never receives actual blockchain rewards
      const winnerPortfolioIds = undistributedWinners.map((w) => w.portfolioId);
      const winnerPortfolios = await Portfolio.find({
        portfolioId: { $in: winnerPortfolioIds },
      }).select("portfolioId isApe");

      const allWinnersAreApe = winnerPortfolios.every((p) => p.isApe === true);
      const hasOnlyApeWinners = winnerPortfolios.length > 0 && allWinnersAreApe;

      if (hasOnlyApeWinners) {
        console.log(
          `[REWARDS] 🦍 Game ${gameId}: Only APE winner(s) detected - SKIPPING blockchain distribution to save gas!`
        );

        // Mark all APE winners as distributed without any blockchain calls
        for (const winner of undistributedWinners) {
          const portfolio = winnerPortfolios.find((p) => p.portfolioId === winner.portfolioId);
          if (portfolio) {
            await Portfolio.findOneAndUpdate(
              { portfolioId: portfolio.portfolioId },
              {
                $set: {
                  "gameOutcome.rewardTransactionHash": "APE_SYSTEM_WIN_NO_DISTRIBUTION",
                },
              }
            );
            await game.markWinnerRewardDistributed(winner._id, "APE_SYSTEM_WIN_NO_DISTRIBUTION");
            console.log(
              `[REWARDS] 🦍 APE portfolio ${portfolio.portfolioId} marked as distributed (no blockchain tx needed)`
            );
          }
        }

        // Mark game as fully distributed and completed - no blockchain calls made!
        console.log(
          `[REWARDS] ✅ Game ${gameId}: Marlow won - game completed without blockchain distribution (gas saved!)`
        );
        await game.markFullyDistributed();
        game.status = "COMPLETED";
        await game.save();
        return;
      }
      // ====== END OPTIMIZATION ======

      // Process in batches - smaller batches are safer for blockchain
      const batch = undistributedWinners.slice(0, batchSize);
      const portfolioIds = [];
      const amounts = [];
      const apeWinners = []; // Track APE winners separately (database-only, no blockchain)

      console.log(`[REWARDS] Game ${gameId}: Processing batch of ${batch.length} winners`);

      for (const winner of batch) {
        const portfolio = await Portfolio.findOne({ portfolioId: winner.portfolioId });
        if (!portfolio) {
          console.warn(`[REWARDS] Portfolio not found: ${winner.portfolioId}, marking as distributed`);
          // Mark as distributed to prevent infinite loop
          await game.markWinnerRewardDistributed(winner._id, "PORTFOLIO_NOT_FOUND");
          continue;
        }

        // APE portfolios are database-only, skip blockchain distribution
        if (portfolio.isApe) {
          console.log(`[REWARDS] 🦍 APE portfolio ${portfolio.portfolioId} - skipping blockchain`);
          apeWinners.push({ winner, portfolio });
          continue;
        }

        const reward = portfolio.gameOutcome?.reward?.toString() || "0";
        if (reward === "0") {
          console.warn(`[REWARDS] Portfolio ${portfolio.portfolioId} has zero reward, skipping`);
          await game.markWinnerRewardDistributed(winner._id, "ZERO_REWARD");
          continue;
        }

        portfolioIds.push(winner.portfolioId);
        amounts.push(reward);
      }

      // Mark APE winners as distributed (they don't actually receive blockchain rewards)
      for (const { winner, portfolio } of apeWinners) {
        await Portfolio.findOneAndUpdate(
          { portfolioId: portfolio.portfolioId },
          {
            $set: {
              "gameOutcome.rewardTransactionHash": "APE_SYSTEM_WIN",
            },
          }
        );
        await game.markWinnerRewardDistributed(winner._id, "APE_SYSTEM_WIN");
        console.log(`[REWARDS] 🦍 APE portfolio ${portfolio.portfolioId} marked as distributed`);
      }

      if (portfolioIds.length === 0) {
        console.log(`[REWARDS] Game ${gameId}: No real user portfolios in this batch`);
        // All winners were APE or invalid - check if we need to continue
        if (undistributedWinners.length > batch.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return this.distributeGameRewards(game, batchSize, 0, maxRetries);
        }
        console.log(`[REWARDS] Game ${gameId}: All done, marking complete`);
        await game.markFullyDistributed();
        game.status = "COMPLETED";
        await game.save();
        return;
      }

      console.log(`[REWARDS] Game ${gameId}: Sending ${portfolioIds.length} rewards to blockchain`);

      // Call blockchain batchAssignRewards (only for real user portfolios)
      const result = await blockchainService.batchAssignRewards(game.gameId, portfolioIds, amounts);

      if (result.skipped) {
        console.log(`[REWARDS] Game ${gameId}: Blockchain call skipped (empty batch)`);
      } else {
        console.log(`[REWARDS] Game ${gameId}: Blockchain tx: ${result.transactionHash}`);

        // Update portfolios and game winners as distributed
        for (const portfolioId of portfolioIds) {
          await Portfolio.findOneAndUpdate(
            { portfolioId },
            {
              $set: {
                "gameOutcome.rewardTransactionHash": result.transactionHash,
              },
            }
          );
        }

        for (const winner of batch.filter((w) => portfolioIds.includes(w.portfolioId))) {
          await game.markWinnerRewardDistributed(winner._id, result.transactionHash);
        }
      }

      // If more winners remain, recursively process next batch
      const remainingCount = undistributedWinners.length - batch.length;
      if (remainingCount > 0) {
        console.log(`[REWARDS] Game ${gameId}: ${remainingCount} winners remaining, processing next batch in 2s`);
        // Wait 2 seconds before next batch to avoid overwhelming the blockchain
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return this.distributeGameRewards(game, batchSize, 0, maxRetries);
      }

      // All rewards distributed, mark game as COMPLETED
      console.log(`[REWARDS] ✅ Game ${gameId}: All rewards distributed successfully`);
      await game.markFullyDistributed();
      game.status = "COMPLETED";
      await game.save();
    } catch (error) {
      console.error(`[REWARDS] ❌ Game ${gameId}: Error distributing rewards:`, error.message);

      // Retry logic for transient errors
      if (retryCount < maxRetries) {
        const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        console.log(
          `[REWARDS] Game ${gameId}: Retrying in ${waitTime / 1000}s (attempt ${retryCount + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.distributeGameRewards(game, batchSize, retryCount + 1, maxRetries);
      }

      console.error(`[REWARDS] Game ${gameId}: Max retries exceeded, giving up for now`);
      // Don't throw - let the cron try again on next run
      // The game stays in CALCULATING_WINNERS state so cron will pick it up again
    }
  }

  // Complete game after all rewards are distributed
  async completeGame(gameId) {
    try {
      const game = await Game.findOne({ gameId });
      if (!game) {
        throw new Error("Game not ready for completion");
      }
      // Update game status
      game.status = "UPDATE_VALUES";
      await game.save();

      console.log(`Game ${gameId} Status Updated!`);
    } catch (error) {
      console.error("Error completing game:", error);
      throw error;
    }
  }

  // Helper function to get random assets
  getRandomAssets(assets, count) {
    const shuffled = [...assets].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  async updateLockedPortfolioValues(game) {
    try {
      const portfolios = await Portfolio.find({
        gameId: game.gameId,
        status: "LOCKED",
        isLocked: true,
      });

      const assetData = await Asset.find({ type: game.gameType }).select("currentPrice assetId");

      const currentPrices = assetData.reduce((acc, asset) => {
        acc[asset.assetId] = asset.currentPrice;
        return acc;
      }, {});

      for (const portfolio of portfolios) {
        try {
          await portfolio.calculateValue(currentPrices);
        } catch (error) {
          console.error(`Error updating portfolio ${portfolio._id} value:`, error);
        }
      }
      console.log(`Updated values for ${portfolios.length} locked portfolios`);
    } catch (error) {
      console.error("Error updating locked portfolio values:", error);
      throw error;
    }
  }

  // Update portfolio values on blockchain
  async updateBlockchainPortfolioValues(gameId) {
    try {
      const game = await Game.findOne({ gameId });
      if (!game) {
        throw new Error("Game not found or in invalid state");
      }

      // Exclude APE portfolios - they're database-only, not on blockchain
      const portfolios = await Portfolio.find({
        status: "LOCKED",
        isLocked: true,
        gameId: gameId,
        isApe: { $ne: true },
      })
        .limit(50)
        .sort({ createdAt: 1 });

      const assets = await Asset.find({});
      const prices = {};
      assets.forEach((asset) => {
        prices[asset.symbol] = asset.currentPrice;
      });

      for (const portfolio of portfolios) {
        try {
          await portfolio.calculateValue(prices);

          const currentValue = portfolio.currentValue.toFixed(6);

          await blockchainService.updatePortfolioValue(portfolio.portfolioId, currentValue, portfolio.gameId);

          portfolio.status = "AWAITING DECISION";
          await portfolio.save();
        } catch (error) {
          console.error(`Error updating blockchain value for portfolio ${portfolio._id}:`, error);
        }
      }

      // Also update APE portfolio values in database (no blockchain call needed)
      const apePortfolios = await Portfolio.find({
        status: "LOCKED",
        isLocked: true,
        gameId: gameId,
        isApe: true,
      });

      for (const apePortfolio of apePortfolios) {
        try {
          await apePortfolio.calculateValue(prices);
          apePortfolio.status = "AWAITING DECISION";
          await apePortfolio.save();
          console.log(`🦍 Updated APE portfolio ${apePortfolio.portfolioId} value in database`);
        } catch (error) {
          console.error(`Error updating APE portfolio ${apePortfolio._id} value:`, error);
        }
      }

      console.log(`Updated blockchain values for ${portfolios.length} portfolios`);

      const remainingPendingPortfolios = await Portfolio.countDocuments({
        status: "LOCKED",
        gameId: gameId,
      });

      if (remainingPendingPortfolios > 0) {
        console.log(`Game ${gameId} has ${remainingPendingPortfolios} locked portfolios, not activating yet`);
        return;
      }

      game.status = "CALCULATING_WINNERS";
      await game.save();

      console.log(`Updated Game Status`);
    } catch (error) {
      console.error("Error updating blockchain portfolio values:", error);
      throw error;
    }
  }
}

module.exports = new GameService();
