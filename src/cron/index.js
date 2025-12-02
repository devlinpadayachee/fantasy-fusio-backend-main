const cron = require("node-cron");
const gameService = require("../services/game.service");
const priceService = require("../services/price.service");
const blockchainService = require("../services/blockchain.service");
const transactionService = require("../services/transaction.service");
const discordService = require("../services/discord.service");
const Game = require("../models/Game");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const Portfolio = require("../models/Portfolio");
const config = require("../config");
const GameCron = require("../models/GameCron");

// Helper function to validate cron expressions
const validateCronExpression = (expression) => {
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
};

// Helper function to log cron job execution
const logCronExecution = (jobName) => {
  console.log(`[${new Date().toISOString()}] Executing cron job: ${jobName}`);
};

// Mutex locks to prevent overlapping cron runs
// This is critical for blockchain operations that must be sequential
const cronLocks = {
  rewardDistribution: false,
  winnerCalculation: false,
};

// Initialize all cron jobs
exports.initializeCronJobs = () => {
  try {
    // Update prices every 5 minutes
    validateCronExpression("*/5 * * * *");
    cron.schedule("*/5 * * * *", async () => {
      try {
        logCronExecution("Price Update");
        await priceService.updateAllPrices();
      } catch (error) {
        console.error("Price update cron job error:", error);
      }
    });

    // Initialize new games every 5 minutes
    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Process Due GameCrons");
        const dueCrons = await GameCron.getDueCronJobs();
        console.log(`Found ${dueCrons.length} due cron jobs to process.`);
        for (const cronJob of dueCrons) {
          try {
            // Create game from cron
            const game = await gameService.createGameFromCron(cronJob);
            if (!game) {
              console.log(`Failed to create game.`);
              continue;
            }

            if (cronJob.cronType === "ONCE") {
              cronJob.isActive = false;
            } else if (cronJob.cronType === "RECURRING") {
              const nextExec = new Date(cronJob.nextExecution);
              nextExec.setHours(nextExec.getHours() + cronJob.recurringSchedule);
              cronJob.nextExecution = nextExec;
            }

            cronJob.lastExecuted = new Date();
            await cronJob.save();

            console.log(`Processed cron job ${cronJob._id} successfully.`);
          } catch (error) {
            console.error(`Error processing cron job ${cronJob._id}:`, error);
          }
        }
      } catch (error) {
        console.error("Error in Process Due GameCrons cron job:", error);
      }
    });

    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Final Portfolio Value Update");
        const games = await Game.find({
          status: "UPDATE_VALUES",
        })
          .sort({ updatedAt: 1 })
          .limit(5);
        for (const game of games) {
          await gameService.updateLockedPortfolioValues(game);
          game.status = "CALCULATING_WINNERS";
          await game.save();
        }
      } catch (error) {
        console.error("Final portfolio value update cron job error:", error);
      }
    });

    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Regular Portfolio Value Update");

        const now = new Date();
        const progressGames = await Game.find({
          status: "ACTIVE",
          startTime: { $lte: now },
          endTime: { $gte: now },
        })
          .sort({ updatedAt: 1 })
          .limit(5);

        for (const game of progressGames) {
          try {
            await gameService.updateLockedPortfolioValues(game);
            logCronExecution(`Updated game ${game.gameId} Portfolio Values`);
          } catch (error) {
            console.error("Portfolio value update error:", error);
          }
        }
      } catch (error) {
        console.error("Portfolio value update cron job error:", error);
      }
    });

    // Calculate winners for ended games in batches
    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Game Winners Calculation");
        const games = await Game.find({
          status: "CALCULATING_WINNERS",
          hasCalculatedWinners: false,
        }).limit(3);
        for (const game of games) {
          try {
            logCronExecution(`Processing winners for game ${game.gameId}`);
            await gameService.calculateGameWinners(game);
          } catch (error) {
            console.error(`Error calculating winners for game ${game.gameId}:`, error);
          }
        }
      } catch (error) {
        console.error("Game winners calculation cron job error:", error);
      }
    });

    // Distribute rewards in batches every minute
    // IMPORTANT: Process ONE game at a time to prevent contract nonce collisions
    // Uses mutex lock to prevent overlapping runs
    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      // Skip if previous run is still in progress
      if (cronLocks.rewardDistribution) {
        console.log("[CRON] Reward distribution already in progress, skipping this run");
        return;
      }

      cronLocks.rewardDistribution = true;

      try {
        logCronExecution("Reward Distribution");
        // Process only 1 game at a time to ensure sequential blockchain transactions
        const game = await Game.findOne({
          status: "CALCULATING_WINNERS",
          hasCalculatedWinners: true,
          isFullyDistributed: false,
        }).sort({ endTime: 1 }); // Process oldest first

        if (game) {
          try {
            logCronExecution(`Distributing rewards for game ${game.gameId}`);
            await gameService.distributeGameRewards(game);
          } catch (error) {
            console.error(`Error distributing rewards for game ${game.gameId}:`, error);
          }
        }
      } catch (error) {
        console.error("Reward distribution cron job error:", error);
      } finally {
        cronLocks.rewardDistribution = false;
      }
    });

    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Game Completion Check");
        const now = new Date();
        const upcomingGames = await Game.find({
          status: "UPCOMING",
          startTime: { $lte: now },
        });

        if (upcomingGames.length > 0) {
          console.log(`[CRON] Found ${upcomingGames.length} UPCOMING games that should start`);
        }

        for (const game of upcomingGames) {
          try {
            console.log(`[CRON] Processing game ${game.gameId} (${game.name}) for UPCOMING → ACTIVE`);

            // Check if Ape portfolio already exists for this game
            const existingApePortfolio = await Portfolio.findOne({
              gameId: game.gameId,
              isApe: true,
            });

            let marlowAiResult = null;
            let marlowPortfolio = null;

            if (!existingApePortfolio && game.winCondition?.type === "MARLOW_BANES") {
              console.log(`[CRON] Generating APE portfolio for game ${game.gameId}`);
              const result = await gameService.generateApePortfolio(game.gameId, game.gameType);
              game.apePortfolio = { portfolioId: result.portfolioId };
              await game.save();
              marlowAiResult = result.aiResult;
              marlowPortfolio = await Portfolio.findOne({ portfolioId: result.portfolioId });
              console.log(`[CRON] ✓ APE portfolio ${result.portfolioId} created for game ${game.gameId}`);
            } else if (existingApePortfolio) {
              console.log(`[CRON] Ape portfolio already exists for game ${game.gameId}, skipping generation`);
              marlowPortfolio = existingApePortfolio;
              // Reconstruct AI result from stored metadata for Discord
              if (existingApePortfolio.metadata?.aiStrategy) {
                marlowAiResult = {
                  assets: existingApePortfolio.metadata.assetReasons || [],
                  allocations: existingApePortfolio.assets.map((a) => a.allocation),
                  strategy: existingApePortfolio.metadata.aiStrategy,
                };
              }
            }

            if (game.winCondition?.type === "MARLOW_BANES" && (!game.apePortfolio || !game.apePortfolio.portfolioId)) {
              console.warn(`[CRON] ⚠ Game ${game.gameId} requires APE portfolio but none exists - skipping activation`);
              continue;
            }

            await gameService.lockPortfolios(game);
            game.status = "ACTIVE";
            await game.save();
            console.log(`[CRON] ✓ Game ${game.gameId} transitioned to ACTIVE`);

            // 🎮 Post Marlow's picks to Discord after portfolios are locked
            if (marlowAiResult && marlowPortfolio) {
              try {
                await discordService.postMarlowPicks(game, marlowPortfolio, marlowAiResult);
                console.log(`[CRON] 🎮 Marlow picks posted to Discord for game ${game.gameId}`);
              } catch (discordError) {
                console.warn(`[CRON] Discord notification failed (non-blocking):`, discordError.message);
              }
            }

            // Also post game started notification
            const participantCount = await Portfolio.countDocuments({ gameId: game.gameId, isApe: false });
            await discordService.postGameStarted(game, participantCount);
          } catch (error) {
            console.error(`[CRON] ✗ Error activating game ${game.gameId}:`, error.message);
          }
        }

        const activeGames = await Game.find({
          status: "ACTIVE",
          endTime: { $lte: now },
        });

        if (activeGames.length > 0) {
          console.log(`[CRON] Found ${activeGames.length} ACTIVE games that have ended and need processing`);
        }

        for (const game of activeGames) {
          try {
            logCronExecution(`Transitioning game ${game.gameId} from ACTIVE to UPDATE_VALUES`);
            await gameService.completeGame(game.gameId);
            console.log(`[CRON] ✓ Game ${game.gameId} transitioned to UPDATE_VALUES`);
          } catch (error) {
            console.error(`[CRON] ✗ Error transitioning game ${game.gameId}:`, error.message);
          }
        }

        // Recovery: Check for games stuck in processing states for too long
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const stuckGames = await Game.find({
          status: { $in: ["UPDATE_VALUES", "CALCULATING_WINNERS"] },
          updatedAt: { $lte: fiveMinutesAgo },
        });

        if (stuckGames.length > 0) {
          console.warn(`[CRON] ⚠ Found ${stuckGames.length} games stuck in processing states`);
          for (const game of stuckGames) {
            console.warn(
              `[CRON] Stuck game: ${game.gameId} (${game.status}) - last updated ${Math.round(
                (now - game.updatedAt) / 1000 / 60
              )} min ago`
            );
          }
        }
      } catch (error) {
        console.error("Game completion cron job error:", error);
      }
    });

    validateCronExpression("* * * * *");
    cron.schedule("* * * * *", async () => {
      try {
        logCronExecution("Check Pending Lock Balance Transactions");

        const pendingPortfolios = await Portfolio.find({
          status: "PENDING_LOCK_BALANCE",
          transactionHash: { $exists: true, $ne: null },
        }).populate("userId");

        for (const portfolio of pendingPortfolios) {
          try {
            const receipt = await blockchainService.provider.getTransactionReceipt(portfolio.transactionHash);

            if (!receipt || !receipt.logs) {
              console.error(`No receipt or logs found for transaction ${portfolio.transactionHash}`);
              continue;
            }

            // Decode logs into events
            const decodedEvents = receipt.logs
              .map((log) => {
                try {
                  return blockchainService.contract.interface.parseLog(log);
                } catch (err) {
                  return null;
                }
              })
              .filter((event) => event !== null);

            const portfolioCreatedEvent = decodedEvents.find((e) => e.name === "PortfolioCreated");
            const portfolioEntryFeePaidEvent = decodedEvents.find((e) => e.name === "PortfolioEntryFeePaid");

            if (!portfolioCreatedEvent) {
              console.error(`PortfolioCreated event not found in transaction ${portfolio.transactionHash}`);
              portfolio.status = "FAILED";
              portfolio.error = "PortfolioCreated event not found in transaction";
              await portfolio.save();
              continue;
            }

            if (receipt.status) {
              // Validate event data matches portfolio data
              if (
                portfolioCreatedEvent.args.portfolioId.toNumber() !== portfolio.portfolioId ||
                portfolioCreatedEvent.args.gameId.toNumber() !== portfolio.gameId ||
                portfolio.userId.address.toLowerCase() !== portfolioCreatedEvent.args.owner.toLowerCase()
              ) {
                console.error(`PortfolioCreated event data does not match portfolio ${portfolio._id}`);
                portfolio.status = "FAILED";
                portfolio.error = "PortfolioCreated event data does not match portfolio";
                await portfolio.save();
                continue;
              }

              await Transaction.create({
                transactionHash: portfolio.transactionHash,
                userId: portfolio.userId,
                type: "ENTRY_FEE",
                amount: portfolioEntryFeePaidEvent ? portfolioEntryFeePaidEvent.args.entryFee.toString() : "0",
                adminFee: portfolioEntryFeePaidEvent ? portfolioEntryFeePaidEvent.args.adminFee.toString() : "0",
                gameId: portfolioCreatedEvent.args.gameId.toNumber(),
                portfolioId: portfolioEntryFeePaidEvent
                  ? portfolioEntryFeePaidEvent.args.portfolioId.toNumber()
                  : portfolio.portfolioId,
                status: "COMPLETED",
                blockNumber: receipt.blockNumber,
                blockTimestamp: new Date(),
                fromAddress: portfolioEntryFeePaidEvent ? portfolioEntryFeePaidEvent.args.payer : null,
                toAddress: config.blockchain.contractAddress,
                gasUsed: receipt.gasUsed.toString(),
                gasPrice: receipt.effectiveGasPrice.toString(),
                networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
              });

              const gameId = portfolioCreatedEvent.args.gameId.toNumber();
              const gameEntryCount = portfolioCreatedEvent.args.entryCount
                ? parseInt(portfolioCreatedEvent.args.entryCount.toString())
                : 0;

              const prizePool = portfolioCreatedEvent.args.prizePool
                ? parseInt(portfolioCreatedEvent.args.prizePool.toString())
                : 0;

              const game = await Game.findOne({ gameId: gameId });
              if (game) {
                game.participantCount = Math.max(game.participantCount || 0, gameEntryCount);
                game.totalPrizePool = Math.max(game.totalPrizePool || 0, prizePool);
                await game.save();
              }
              portfolio.status = "PENDING";
              await portfolio.save();

              await new Notification({
                userId: portfolio.userId,
                type: "PORTFOLIO_CREATED",
                message: `Portfolio ${portfolio.portfolioName} created successfully`,
              }).save();
            } else {
              portfolio.status = "FAILED";
              portfolio.error = "Transaction failed on blockchain";
              await portfolio.save();

              await new Notification({
                userId: portfolio.userId,
                type: "TRANSACTION_FAILED",
                message: `Transaction failed for portfolio ${portfolio.portfolioName}`,
              }).save();
            }
          } catch (error) {
            console.error(`Error processing portfolio:`, error);
          }
        }
      } catch (error) {
        console.error("Pending lock balance check cron job error:", error);
      }
    });

    validateCronExpression("*/2 * * * *");
    cron.schedule("*/2 * * * *", async () => {
      try {
        logCronExecution("Check Pending Lock Balance Without Transaction Hash");

        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const pendingPortfolios = await Portfolio.find({
          status: "PENDING_LOCK_BALANCE",
          transactionHash: { $exists: false },
          $or: [{ retryCount: 0 }, { retryCount: { $lt: 5 }, lastRetryAt: { $lt: twoMinutesAgo } }],
        }).populate("userId");

        for (const portfolio of pendingPortfolios) {
          try {
            // Call getPortfolioOwner from smart contract
            const portfolioOwner = await blockchainService.getPortfolioOwner(portfolio.portfolioId);

            const zeroAddress = "0x0000000000000000000000000000000000000000";
            const userAddress = portfolio.userId.address.toLowerCase();

            if (portfolioOwner.toLowerCase() === userAddress) {
              // Portfolio owner matches user address - mark as successful
              console.log(`Portfolio ${portfolio.portfolioId} owner matches user ${portfolio.userId.address}`);

              // Get game details
              const gameDetails = await blockchainService.getGameDetails(portfolio.gameId);

              // Update game with participant count and prize pool
              const game = await Game.findOne({ gameId: portfolio.gameId });
              if (game) {
                game.participantCount = Math.max(game.participantCount || 0, gameDetails.entryCount);
                game.totalPrizePool = Math.max(game.totalPrizePool || 0, parseInt(gameDetails.totalPrizePool));
                await game.save();
              }

              portfolio.status = "PENDING";
              portfolio.retryCount = 0;
              portfolio.lastRetryAt = null;
              portfolio.retryError = null;
              await portfolio.save();

              // Calculate entry fee and admin fee properly in wei
              const { ethers } = require("ethers");
              const entryFeeWei = ethers.utils.parseUnits(game.entryPrice.toString(), 18);
              const adminFeeWei = entryFeeWei.mul(10).div(100); // 10% admin fee

              await Transaction.create({
                transactionHash: "MANUAL_ENTRY_NO_TX_HASH",
                userId: portfolio.userId,
                type: "ENTRY_FEE",
                amount: entryFeeWei.toString(),
                adminFee: adminFeeWei.toString(),
                gameId: portfolio.gameId,
                portfolioId: portfolio.portfolioId,
                status: "COMPLETED",
                blockNumber: 0, // Manual entry, no blockchain block
                blockTimestamp: new Date(),
                fromAddress: userAddress,
                toAddress: config.blockchain.contractAddress,
                gasUsed: "0",
                gasPrice: "0",
                networkFee: "0",
              });

              await new Notification({
                userId: portfolio.userId,
                type: "PORTFOLIO_CREATED",
                message: `Portfolio ${portfolio.portfolioName} created successfully`,
              }).save();
            } else if (portfolioOwner.toLowerCase() === zeroAddress) {
              // Portfolio owner is zero address - mark as failed
              console.log(`Portfolio ${portfolio.portfolioId} owner is zero address - marking as failed`);

              if (portfolio.retryCount < 5) {
                portfolio.retryCount += 1;
                portfolio.lastRetryAt = new Date();
                portfolio.retryError = `Portfolio ${portfolio.portfolioId} owner is zero address - marking as failed`;
                await portfolio.save();
              } else {
                portfolio.status = "FAILED";
                portfolio.error = "Max retries exceeded";
                portfolio.retryError = `Portfolio ${portfolio.portfolioId} owner is zero address - marking as failed`;
                await portfolio.save();
                await new Notification({
                  userId: portfolio.userId,
                  type: "TRANSACTION_FAILED",
                  message: `Portfolio creation failed for ${portfolio.portfolioName}`,
                }).save();
              }
            }
          } catch (error) {
            console.error(`Error processing portfolio ${portfolio.portfolioId}:`, error);
            if (portfolio.retryCount < 5) {
              portfolio.retryCount += 1;
              portfolio.lastRetryAt = new Date();
              portfolio.retryError = error.message || String(error);
              await portfolio.save();
            } else {
              portfolio.status = "FAILED";
              portfolio.error = "Max retries exceeded";
              portfolio.retryError = error.message || String(error);
              await portfolio.save();
            }
          }
        }
      } catch (error) {
        console.error("Pending lock balance check cron job error:", error);
      }
    });

    // console.log('All cron jobs initialized successfully');
  } catch (error) {
    console.error("Error initializing cron jobs:", error);
    throw error;
  }
};

// Graceful shutdown of cron jobs
exports.stopCronJobs = () => {
  try {
    const jobs = cron.getTasks();
    jobs.forEach((job) => job.stop());
    console.log("All cron jobs stopped successfully");
  } catch (error) {
    console.error("Error stopping cron jobs:", error);
    throw error;
  }
};

// Helper function to get cron job status
exports.getCronJobStatus = () => {
  try {
    const jobs = cron.getTasks();
    return jobs.map((job) => ({
      expression: job.options.name,
      lastRun: job.options.lastRun,
      nextRun: job.options.nextRun,
      isRunning: job.options.isRunning,
    }));
  } catch (error) {
    console.error("Error getting cron job status:", error);
    throw error;
  }
};
