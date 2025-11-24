const Game = require("../models/Game");
const Portfolio = require("../models/Portfolio");
const User = require("../models/User");
const Asset = require("../models/Asset");
const Notification = require("../models/Notification");
const blockchainService = require("./blockchain.service");
const priceService = require("./price.service");
const { ethers } = require("ethers");

class GameService {
  constructor() {}

  // Initialize a new game
  async initializeGame(gameType = "DEFI") {
    try {
      // Check if there's already an active game
      const activeGame = await Game.getNotCompletedGame(gameType);
      if (activeGame) {
        console.error("A game is already active or Pending");
        return;
      }

      let startTime, endTime;
      startTime = new Date(Date.now() + 1 * 60 * 1000);
      if (gameType === "DEFI") {
        endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
      } else {
        endTime = new Date(startTime.getTime() + 48 * 60 * 60 * 1000);
      }

      const game = await Game.create({
        gameId: Date.now(),
        gameType,
        status: "PENDING",
        startTime,
        endTime,
        totalPrizePool: 0,
        participantCount: 0,
      });

      let gameId;
      // Create game on blockchain
      try {
        const blockchainResult = await blockchainService.createGame(
          game.gameId,
          startTime,
          endTime,
          game.entryPrice || 0
        );

        // Update game with blockchain details
        gameId = blockchainResult.gameId;
        game.gameId = gameId;
        game.transactionHash = blockchainResult.transactionHash;
        game.status = "PENDING";
        await game.save();

        // Check if Ape portfolio already exists for this game
        const existingApePortfolio = await Portfolio.findOne({
          gameId: gameId,
          isApe: true,
        });

        if (!existingApePortfolio) {
          // Generate Ape's portfolio and update game
          const apePortfolioId = await this.generateApePortfolio(gameId, gameType);
          game.apePortfolio = { portfolioId: apePortfolioId };
          await game.save();
        } else {
          console.log(`Ape portfolio already exists for game ${gameId}, skipping generation`);
          game.apePortfolio = { portfolioId: existingApePortfolio.portfolioId };
          await game.save();
        }
      } catch (error) {
        // Update game status to FAILED and store error
        game.status = "FAILED";
        game.error = error.message;
        if (error.transactionHash) {
          game.transactionHash = error.transactionHash;
        }
        await game.save();
        throw error;
      }

      console.log(`Game ${game.gameId} initialized successfully`);
      return game;
    } catch (error) {
      console.error("Error initializing game:", error);
      throw error;
    }
  }

  // New method to get games by status
  async getGamesByStatus(status) {
    try {
      const games = await Game.find({ status: status }).sort({ startTime: 1 });
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

  // Generate Ape's portfolio
  async generateApePortfolio(gameId, gameType) {
    try {
      const assets = await Asset.find({
        type: gameType,
        isActive: true,
        ape: true,
      });

      if (assets.length < 8) {
        throw new Error(`Not enough active ${gameType} assets available`);
      }

      // Randomly select 8 unique assets
      const selectedAssets = this.getRandomAssets(assets, 8);
      const formattedAssets = selectedAssets.map((asset) => asset.symbol);

      // Verify uniqueness
      const uniqueAssets = new Set(formattedAssets);
      if (uniqueAssets.size !== formattedAssets.length) {
        throw new Error("Selected assets must be unique");
      }

      // Predefined allocation values
      const allocations = [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000];

      // Map assets to allocations
      const portfolioAssets = formattedAssets.map((symbol, index) => {
        const dbAsset = selectedAssets.find((a) => a.symbol === symbol);
        return {
          assetId: dbAsset.assetId,
          symbol: symbol,
          allocation: allocations[index],
          tokenQty: 0,
        };
      });

      const maxPortfolio = await Portfolio.findOne().sort({ portfolioId: -1 }).select("portfolioId");
      const nextPortfolioId = maxPortfolio ? maxPortfolio.portfolioId + 1 : 1;

      // Create portfolio in database first
      const portfolio = new Portfolio({
        userId: process.env.APE_USER_ID,
        portfolioName: "MARLOW BANE",
        gameId: gameId,
        gameType: gameType,
        portfolioId: nextPortfolioId,
        assets: portfolioAssets,
        status: "PENDING",
        isLocked: false,
        lockedAt: Date.now(),
        isApe: true,
      });
      await portfolio.save();

      try {
        return portfolio.portfolioId;
      } catch (error) {
        // Update portfolio status to FAILED and store error
        portfolio.status = "FAILED";
        portfolio.error = error.message;
        await portfolio.save();
        throw error;
      }
    } catch (error) {
      console.error("Error generating Ape portfolio:", error);
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
      const Asset = require("../models/Asset");
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
      // MARLOW_BANES LOGIC
      // ========================================
      if (game.winCondition.type === "MARLOW_BANES") {
        console.log(`\n--- MARLOW_BANES: Beat the Ape ---`);

        // Get totalPrizePool from blockchain
        const gameDetails = await blockchainService.getGameDetails(game.gameId);
        const totalPrizePool = BigInt(gameDetails.totalPrizePool);
        game.totalPrizePool = totalPrizePool.toString();
        console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

        const apePortfolio = await Portfolio.findOne({
          portfolioId: game.apePortfolio.portfolioId,
        });

        if (!apePortfolio) {
          game.status = "FAILED";
          game.error = `Ape portfolio not found for game ${game.gameId}`;
          await game.save();
          console.error(`Ape portfolio not found for game ${game.gameId}`);
          return;
        }

        const apeCurrentValue = apePortfolio.currentValue;
        console.log(
          `Ape Portfolio: $${apeCurrentValue.toLocaleString()} (${apePortfolio.performancePercentage.toFixed(2)}%)`
        );

        const lockedPortfolios = await Portfolio.find({
          gameId: game.gameId,
          status: "LOCKED",
          portfolioId: { $ne: game.apePortfolio.portfolioId },
        })
          .populate("userId")
          .sort({ performancePercentage: -1, createdAt: 1 }); // Tie-breaker: earlier entry wins

        let winningPortfolios = lockedPortfolios.filter((portfolio) => portfolio.currentValue > apeCurrentValue);

        // Log top 10 standings
        console.log("\n📊 Top 10 Standings:");
        lockedPortfolios.slice(0, 10).forEach((p, i) => {
          const isWinner = p.currentValue > apeCurrentValue ? "✅" : "❌";
          console.log(
            `${i + 1}. ${isWinner} Portfolio ${
              p.portfolioId
            }: $${p.currentValue.toLocaleString()} (${p.performancePercentage.toFixed(2)}%)`
          );
        });

        if (winningPortfolios.length === 0) {
          winningPortfolios = [apePortfolio];
          console.log(`\n🎯 Result: No portfolios beat the ape! Ape wins.`);
        } else {
          console.log(`\n🎯 Result: ${winningPortfolios.length} portfolios beat the ape!`);
        }

        const reward = totalPrizePool / BigInt(winningPortfolios.length);
        console.log(`Reward per winner: $${(Number(reward) / 1e18).toFixed(2)}`);

        for (let i = 0; i < winningPortfolios.length; i++) {
          const portfolio = winningPortfolios[i];
          const rank = i + 1;

          game.winners.push({
            userId: portfolio.userId,
            portfolioId: portfolio.portfolioId,
            performancePercentage: portfolio.performancePercentage,
            isRewardDistributed: false,
          });

          await portfolio.markAsWinner(reward.toString(), rank);

          const previousWins = await Portfolio.countDocuments({
            userId: portfolio.userId._id,
            "gameOutcome.isWinner": true,
            gameId: game.gameId,
          });

          // Update user statistics
          const user = await User.findById(portfolio.userId);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolio.portfolioId,
              portfolio.performancePercentage,
              parseFloat(reward.toString()),
              rank
            );
          }

          // Create win notification
          await new Notification({
            userId: portfolio.userId._id,
            type: "PORTFOLIO_WON",
            message: `Congratulations! Your portfolio "${portfolio.portfolioName}" won!`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        // Mark losing portfolios
        const losingPortfolios = lockedPortfolios.filter((portfolio) => portfolio.currentValue <= apeCurrentValue);

        // Update Ape portfolio status
        if (game.apePortfolio && game.apePortfolio.portfolioId) {
          if (winningPortfolios.length > 0) {
            // Marlow lost - users beat him
            await Portfolio.updateOne(
              { portfolioId: game.apePortfolio.portfolioId },
              {
                $set: {
                  status: "LOST",
                  "gameOutcome.isWinner": false,
                  "gameOutcome.reward": "0",
                  "gameOutcome.settledAt": new Date(),
                },
              }
            );
          } else {
            // Marlow won - no users beat him
            await Portfolio.updateOne(
              { portfolioId: game.apePortfolio.portfolioId },
              {
                $set: {
                  status: "WON",
                  "gameOutcome.isWinner": true,
                  "gameOutcome.reward": "0", // Marlow doesn't get rewards
                  "gameOutcome.settledAt": new Date(),
                  "gameOutcome.rank": 1, // Marlow is the winner
                },
              }
            );
          }
        }

        for (const portfolio of losingPortfolios) {
          await Portfolio.updateOne(
            { portfolioId: portfolio.portfolioId },
            {
              $set: {
                status: "LOST",
                "gameOutcome.isWinner": false,
                "gameOutcome.reward": "0",
                "gameOutcome.settledAt": new Date(),
                "gameOutcome.rank": winningPortfolios.length + 1,
              },
            }
          );

          // Update user statistics for loser
          const user = await User.findById(portfolio.userId._id);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolio.portfolioId,
              portfolio.performancePercentage,
              0,
              winningPortfolios.length + 1
            );
          }

          const previousWins = await Portfolio.countDocuments({
            userId: portfolio.userId._id,
            "gameOutcome.isWinner": true,
            gameId: { $ne: game.gameId },
          });

          await new Notification({
            userId: portfolio.userId._id,
            type: "PORTFOLIO_LOST",
            message: `Your portfolio "${portfolio.portfolioName}" did not win this round.`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        console.log(`\n✅ MARLOW_BANES Complete:`);
        console.log(`   Winners: ${winningPortfolios.length}`);
        console.log(`   Losers: ${losingPortfolios.length}`);
        console.log(`========== WINNER CALCULATION END: Game ${game.gameId} ==========\n`);

        game.hasCalculatedWinners = true;
        await game.markWinnerCalculated();

        return;
      }

      // ========================================
      // EQUAL_DISTRIBUTE LOGIC
      // ========================================
      if (game.winCondition.type === "EQUAL_DISTRIBUTE") {
        console.log(`\n--- EQUAL_DISTRIBUTE: Top ${game.winCondition.config.topWinnersPercentage}% Win ---`);

        // Get totalPrizePool from blockchain
        const gameDetails = await blockchainService.getGameDetails(game.gameId);
        const totalPrizePool = BigInt(gameDetails.totalPrizePool);
        game.totalPrizePool = totalPrizePool.toString();
        console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

        // Optimization: Use lean() for better performance
        const lockedPortfolios = await Portfolio.find({
          gameId: game.gameId,
          status: "LOCKED",
        })
          .populate("userId")
          .lean() // 50% faster for large datasets
          .sort({ performancePercentage: -1, createdAt: 1 }); // Tie-breaker: earlier entry wins

        const topWinnersPercentage = game.winCondition.config.topWinnersPercentage;
        const rewardPercentage = game.winCondition.config.rewardPercentage;

        const topWinnersCount = Math.ceil((topWinnersPercentage / 100) * lockedPortfolios.length);

        console.log(`Total Portfolios: ${lockedPortfolios.length}`);
        console.log(`Top ${topWinnersPercentage}% = ${topWinnersCount} winners`);
        console.log(
          `Reward Pool: ${rewardPercentage}% of prize = $${(
            (Number(totalPrizePool) * rewardPercentage) /
            100 /
            1e18
          ).toFixed(2)}`
        );

        const winners = lockedPortfolios.slice(0, topWinnersCount);

        let rewardTotal = 0n;
        let rewardPerWinner = 0n;

        if (topWinnersCount > 0 && rewardPercentage > 0 && totalPrizePool > 0n) {
          rewardTotal = (totalPrizePool * BigInt(rewardPercentage)) / 100n;
          rewardPerWinner = rewardTotal / BigInt(topWinnersCount);
        }

        console.log(`Reward per winner: $${(Number(rewardPerWinner) / 1e18).toFixed(2)}`);

        // Log top 10 standings
        console.log("\n📊 Top 10 Standings:");
        lockedPortfolios.slice(0, 10).forEach((p, i) => {
          const isWinner = i < topWinnersCount ? "✅" : "❌";
          console.log(
            `${i + 1}. ${isWinner} Portfolio ${
              p.portfolioId
            }: $${p.currentValue.toLocaleString()} (${p.performancePercentage.toFixed(2)}%)`
          );
        });

        for (let i = 0; i < winners.length; i++) {
          const portfolioData = winners[i];
          const rank = i + 1;

          game.winners.push({
            userId: portfolioData.userId,
            portfolioId: portfolioData.portfolioId,
            performancePercentage: portfolioData.performancePercentage,
            isRewardDistributed: false,
          });

          // Since we used lean(), need to get full document for methods
          const portfolio = await Portfolio.findOne({ portfolioId: portfolioData.portfolioId });
          await portfolio.markAsWinner(rewardPerWinner.toString(), rank);

          const previousWins = await Portfolio.countDocuments({
            userId: portfolioData.userId._id,
            "gameOutcome.isWinner": true,
            gameId: game.gameId,
          });

          // Update user statistics
          const user = await User.findById(portfolioData.userId);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolioData.portfolioId,
              portfolioData.performancePercentage,
              parseFloat(rewardPerWinner.toString()),
              rank
            );
          }

          // Create win notification
          await new Notification({
            userId: portfolioData.userId._id,
            type: "PORTFOLIO_WON",
            message: `Congratulations! Your portfolio "${portfolio.portfolioName}" won!`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        // Mark losing portfolios
        const losingPortfolios = lockedPortfolios.slice(topWinnersCount);

        for (const portfolio of losingPortfolios) {
          await Portfolio.updateOne(
            { portfolioId: portfolio.portfolioId },
            {
              $set: {
                status: "LOST",
                "gameOutcome.isWinner": false,
                "gameOutcome.reward": "0",
                "gameOutcome.settledAt": new Date(),
                "gameOutcome.rank": topWinnersCount + 1,
              },
            }
          );

          // Update user statistics for loser
          const user = await User.findById(portfolio.userId._id);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolio.portfolioId,
              portfolio.performancePercentage,
              0,
              topWinnersCount + 1
            );
          }

          const previousWins = await Portfolio.countDocuments({
            userId: portfolio.userId._id,
            "gameOutcome.isWinner": true,
            gameId: { $ne: game.gameId },
          });

          await new Notification({
            userId: portfolio.userId._id,
            type: "PORTFOLIO_LOST",
            message: `Your portfolio "${portfolio.portfolioName}" did not win this round.`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        console.log(`\n✅ EQUAL_DISTRIBUTE Complete:`);
        console.log(`   Winners: ${winners.length}`);
        console.log(`   Losers: ${losingPortfolios.length}`);
        console.log(`========== WINNER CALCULATION END: Game ${game.gameId} ==========\n`);

        game.hasCalculatedWinners = true;
        await game.markWinnerCalculated();

        return;
      }

      // ========================================
      // TIERED LOGIC
      // ========================================
      if (game.winCondition.type === "TIERED") {
        console.log(`\n--- TIERED: Specific Positions Win ---`);

        // Get totalPrizePool from blockchain
        const gameDetails = await blockchainService.getGameDetails(game.gameId);
        const totalPrizePool = BigInt(gameDetails.totalPrizePool);
        game.totalPrizePool = totalPrizePool.toString();
        console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

        const tiers = game.winCondition.config.tiers;
        console.log(`Tiers: ${tiers.map((t) => `#${t.position}=${t.rewardPercentage}%`).join(", ")}`);

        // Optimization: Only fetch what we need for TIERED
        const maxPosition = Math.max(...tiers.map((t) => t.position));
        const lockedPortfolios = await Portfolio.find({
          gameId: game.gameId,
          status: "LOCKED",
        })
          .populate("userId")
          .lean() // Performance optimization
          .sort({ performancePercentage: -1, createdAt: 1 }) // Tie-breaker: earlier entry wins
          .limit(maxPosition + 100); // Fetch a bit more than needed for full standings log

        console.log(`Total Portfolios: ${lockedPortfolios.length} (fetched top ${maxPosition + 100})`);

        // Validate sum of rewardPercentage <= 100
        const totalRewardPercentage = tiers.reduce((sum, tier) => sum + tier.rewardPercentage, 0);

        if (totalRewardPercentage > 100) {
          game.status = "FAILED";
          game.error = `Total rewardPercentage of tiers must be ≤100, got ${totalRewardPercentage}%`;
          await game.save();
          console.error(
            `❌ Game ${game.gameId} FAILED: Total reward percentage ${totalRewardPercentage}% exceeds 100%`
          );
          throw new Error(`Total rewardPercentage of tiers must be ≤100, got ${totalRewardPercentage}%`);
        }

        console.log(`Total Reward Allocation: ${totalRewardPercentage}% (${100 - totalRewardPercentage}% to platform)`);

        // Log top standings (up to max position + 10)
        console.log("\n📊 Top Standings:");
        const displayCount = Math.min(lockedPortfolios.length, Math.max(...tiers.map((t) => t.position)) + 10);
        for (let i = 0; i < displayCount; i++) {
          const p = lockedPortfolios[i];
          const tier = tiers.find((t) => t.position === i + 1);
          const status = tier ? `✅ Wins ${tier.rewardPercentage}%` : "❌";
          console.log(
            `${i + 1}. ${status} Portfolio ${
              p.portfolioId
            }: $${p.currentValue.toLocaleString()} (${p.performancePercentage.toFixed(2)}%)`
          );
        }

        // Prepare winners array
        const winners = [];

        for (let i = 0; i < tiers.length; i++) {
          const tier = tiers[i];
          const positionIndex = tier.position - 1;
          if (positionIndex >= lockedPortfolios.length) {
            console.warn(`⚠️  Tier position ${tier.position} exceeds total portfolios (${lockedPortfolios.length})`);
            continue;
          }
          const portfolioData = lockedPortfolios[positionIndex];
          const rewardAmount = (totalPrizePool * BigInt(tier.rewardPercentage)) / 100n;

          winners.push({ portfolioData, rewardAmount, rank: tier.position });
          console.log(
            `Position ${tier.position}: Portfolio ${portfolioData.portfolioId} wins $${(
              Number(rewardAmount) / 1e18
            ).toFixed(2)}`
          );
        }

        for (const { portfolioData, rewardAmount, rank } of winners) {
          game.winners.push({
            userId: portfolioData.userId,
            portfolioId: portfolioData.portfolioId,
            performancePercentage: portfolioData.performancePercentage,
            isRewardDistributed: false,
          });

          // Since we used lean(), need to get full document for methods
          const portfolio = await Portfolio.findOne({ portfolioId: portfolioData.portfolioId });
          await portfolio.markAsWinner(rewardAmount.toString(), rank);

          const previousWins = await Portfolio.countDocuments({
            userId: portfolio.userId._id,
            "gameOutcome.isWinner": true,
            gameId: game.gameId,
          });

          const user = await User.findById(portfolio.userId);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolio.portfolioId,
              portfolio.performancePercentage,
              parseFloat(rewardAmount.toString()),
              rank
            );
          }

          await new Notification({
            userId: portfolio.userId._id,
            type: "PORTFOLIO_WON",
            message: `Congratulations! Your portfolio "${portfolio.portfolioName}" won!`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        const winnerPortfolioIds = winners.map((w) => w.portfolioData.portfolioId);

        // Need to get ALL portfolios for losers (not just limited set)
        const allLockedPortfolios = await Portfolio.find({
          gameId: game.gameId,
          status: "LOCKED",
        }).lean();

        const losingPortfolios = allLockedPortfolios.filter(
          (portfolio) => !winnerPortfolioIds.includes(portfolio.portfolioId)
        );

        for (const portfolio of losingPortfolios) {
          await Portfolio.updateOne(
            { portfolioId: portfolio.portfolioId },
            {
              $set: {
                status: "LOST",
                "gameOutcome.isWinner": false,
                "gameOutcome.reward": "0",
                "gameOutcome.settledAt": new Date(),
                "gameOutcome.rank": tiers.length + 1,
              },
            }
          );

          // Update user statistics for loser
          const user = await User.findById(portfolio.userId._id);
          if (user) {
            await user.updateGameStats(
              game.gameId,
              portfolio.portfolioId,
              portfolio.performancePercentage,
              0,
              tiers.length + 1
            );
          }

          const previousWins = await Portfolio.countDocuments({
            userId: portfolio.userId._id,
            "gameOutcome.isWinner": true,
            gameId: { $ne: game.gameId },
          });

          await new Notification({
            userId: portfolio.userId._id,
            type: "PORTFOLIO_LOST",
            message: `Your portfolio "${portfolio.portfolioName}" did not win this round.`,
            metadata: {
              previousWins,
              portfolioId: portfolio._id,
              gameId: game.gameId,
            },
          }).save();
        }

        console.log(`\n✅ TIERED Complete:`);
        console.log(`   Winners: ${winners.length}`);
        console.log(`   Losers: ${losingPortfolios.length}`);
        console.log(`========== WINNER CALCULATION END: Game ${game.gameId} ==========\n`);

        game.hasCalculatedWinners = true;
        await game.markWinnerCalculated();

        return;
      }
    } catch (error) {
      console.error("Error calculating game winners:", error);
      throw error;
    }
  }

  // Distribute rewards in batches
  async distributeGameRewards(game, batchSize = 50, retryCount = 0, maxRetries = 20) {
    try {
      let excludeId = null;
      if (game.winCondition.type === "MARLOW_BANES" && game.apePortfolio && game.apePortfolio.portfolioId) {
        excludeId = game.apePortfolio.portfolioId;
      }
      const undistributedWinners = game.winners.filter((w) => !w.isRewardDistributed && w.portfolioId !== excludeId);

      if (undistributedWinners.length === 0) {
        await game.markFullyDistributed();
        game.status = "COMPLETED";
        await game.save();
        return;
      }

      // Process in batches
      const batch = undistributedWinners.slice(0, batchSize);

      // Prepare arrays for batchAssignRewards
      const portfolioIds = [];
      const amounts = [];

      for (const winner of batch) {
        const portfolio = await Portfolio.findOne({
          portfolioId: winner.portfolioId,
          isApe: false,
        });
        if (!portfolio) {
          console.warn(`Portfolio not found for winner portfolioId: ${winner.portfolioId}`);
          continue;
        }
        portfolioIds.push(winner.portfolioId);
        // Use portfolio.gameOutcome.reward as amount
        amounts.push(portfolio.gameOutcome.reward.toString() || "0");
      }

      if (portfolioIds.length === 0) {
        console.warn("No valid portfolios found in batch for reward distribution.");
        await game.markFullyDistributed();
        game.status = "COMPLETED";
        await game.save();
        return;
      }

      // Call blockchain batchAssignRewards
      const result = await blockchainService.batchAssignRewards(game.gameId, portfolioIds, amounts);

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

      for (const winner of batch) {
        await game.markWinnerRewardDistributed(winner._id, result.transactionHash);
      }

      // If more winners remain, recursively process next batch
      if (undistributedWinners.length > batchSize) {
        // Wait 1 second before next batch
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.distributeGameRewards(game, batchSize, retryCount, maxRetries);
      }

      // All rewards distributed, mark game as COMPLETED
      game.status = "COMPLETED";
      await game.save();

      console.log(`Distributed rewards for game ${game.gameId} in batches. Processed ${portfolioIds.length} rewards.`);
    } catch (error) {
      console.error("Error distributing game rewards:", error);
      throw error;
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

      const portfolios = await Portfolio.find({
        status: "LOCKED",
        isLocked: true,
        gameId: gameId,
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
