const { asyncHandler } = require("../middleware/error");
const Game = require("../models/Game");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const gameService = require("../services/game.service");
const portfolioService = require("../services/portfolio.service");
const priceService = require("../services/price.service");
const transactionService = require("../services/transaction.service");
const blockchainService = require("../services/blockchain.service");

const gameController = {
  // Get current game status with type filter
  getGameStatus: asyncHandler(async (req, res) => {
    const { type } = req.query;
    const query = { status: "ACTIVE" };
    if (type) {
      query.gameType = type.toUpperCase();
    }

    const game = await Game.findOne(query);
    if (!game) {
      return res.json({ status: "NO_ACTIVE_GAME", gameType: type });
    }

    // Get additional game statistics
    const stats = await gameService.getGameStatistics(game.gameId);

    res.json({
      ...game.toObject(),
      statistics: stats,
    });
  }),

  // New method to check game status and startTime
  checkGameStatus: asyncHandler(async (req, res) => {
    const { gameId, portfolioType } = req.params;
    const game = await Game.findOne({
      gameId: Number(gameId),
      gameType: portfolioType,
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    if (game.status !== "UPCOMING") {
      return res.status(400).json({ error: "Game not found" });
    }

    const nowPlusOneMinute = new Date(Date.now() + 5 * 60 * 1000);
    if (!(game.startTime > nowPlusOneMinute)) {
      return res.status(400).json({ error: "Game already started." });
    }

    res.json({
      gameId: game.gameId,
      gameType: game.gameType,
      game,
    });
  }),

  // New controller method to get upcoming games
  getUpcomingGames: asyncHandler(async (req, res) => {
    try {
      // Return both UPCOMING and ACTIVE games (live games)
      const games = await gameService.getGamesByStatus(["UPCOMING", "ACTIVE"]);
      res.json({ games });
    } catch (error) {
      console.error("Error fetching upcoming games:", error);
      res.status(500).json({ error: "Failed to fetch upcoming games" });
    }
  }),

  // Diagnostic endpoint to check game status distribution
  getGameDiagnostics: asyncHandler(async (req, res) => {
    try {
      const now = new Date();

      // Get count by status
      const statusCounts = await Game.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);

      // Find stuck games (ACTIVE but endTime has passed)
      const stuckActiveGames = await Game.find({
        status: "ACTIVE",
        endTime: { $lte: now },
      })
        .select("gameId name status startTime endTime updatedAt error winCondition apePortfolio")
        .lean();

      // Enrich with portfolio counts
      const activeGamesEnriched = await Promise.all(
        stuckActiveGames.map(async (game) => {
          const portfolioCounts = await Portfolio.aggregate([
            { $match: { gameId: game.gameId } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]);
          const portfoliosByStatus = portfolioCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {});

          const possibleReasons = [];
          if (game.error) possibleReasons.push(`Game error: ${game.error}`);
          if (!portfoliosByStatus.LOCKED && !portfoliosByStatus.WON && !portfoliosByStatus.LOST) {
            possibleReasons.push("No locked portfolios to process");
          }
          if (possibleReasons.length === 0) {
            possibleReasons.push("Cron job may not be running or processing this game");
          }

          return {
            ...game,
            endedAgo: Math.round((now - new Date(game.endTime)) / 1000 / 60) + " minutes",
            portfoliosByStatus,
            totalPortfolios: Object.values(portfoliosByStatus).reduce((a, b) => a + b, 0),
            possibleReasons,
          };
        })
      );

      // Find games stuck in processing states
      const stuckProcessingGames = await Game.find({
        status: { $in: ["UPDATE_VALUES", "CALCULATING_WINNERS"] },
        updatedAt: { $lte: new Date(now.getTime() - 5 * 60 * 1000) },
      })
        .select(
          "gameId name status startTime endTime updatedAt hasCalculatedWinners isFullyDistributed error lastProcessedWinnerIndex winCondition"
        )
        .lean();

      const processingGamesEnriched = await Promise.all(
        stuckProcessingGames.map(async (game) => {
          const portfolioCounts = await Portfolio.aggregate([
            { $match: { gameId: game.gameId } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]);
          const portfoliosByStatus = portfolioCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {});

          const possibleReasons = [];
          if (game.error) possibleReasons.push(`Game error: ${game.error}`);

          if (game.status === "UPDATE_VALUES") {
            if (!portfoliosByStatus.LOCKED) {
              possibleReasons.push("No LOCKED portfolios to update values for");
            } else {
              possibleReasons.push(`Waiting to update ${portfoliosByStatus.LOCKED} locked portfolios`);
            }
          }

          if (game.status === "CALCULATING_WINNERS") {
            if (!game.hasCalculatedWinners) {
              possibleReasons.push("Winner calculation has not completed");
              if (portfoliosByStatus["AWAITING DECISION"]) {
                possibleReasons.push(`${portfoliosByStatus["AWAITING DECISION"]} portfolios awaiting decision`);
              }
            } else if (!game.isFullyDistributed) {
              possibleReasons.push("Winners calculated but rewards not fully distributed");
              possibleReasons.push(`Last processed winner index: ${game.lastProcessedWinnerIndex || 0}`);
            }
          }

          if (possibleReasons.length === 0) {
            possibleReasons.push("Unknown - check server logs for errors");
          }

          return {
            ...game,
            stuckFor: Math.round((now - new Date(game.updatedAt)) / 1000 / 60) + " minutes",
            portfoliosByStatus,
            totalPortfolios: Object.values(portfoliosByStatus).reduce((a, b) => a + b, 0),
            possibleReasons,
          };
        })
      );

      // Find UPCOMING games that should have started
      const stuckUpcomingGames = await Game.find({
        status: "UPCOMING",
        startTime: { $lte: now },
      })
        .select("gameId name status startTime endTime updatedAt winCondition apePortfolio error")
        .lean();

      const upcomingGamesEnriched = await Promise.all(
        stuckUpcomingGames.map(async (game) => {
          const portfolioCounts = await Portfolio.aggregate([
            { $match: { gameId: game.gameId } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]);
          const portfoliosByStatus = portfolioCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {});

          // Check for APE portfolio
          const hasApePortfolio = await Portfolio.exists({ gameId: game.gameId, isApe: true });

          const possibleReasons = [];
          if (game.error) possibleReasons.push(`Game error: ${game.error}`);

          // Check if game requires APE portfolio but doesn't have one
          if (game.winCondition?.type === "MARLOW_BANES") {
            if (!hasApePortfolio && !game.apePortfolio?.portfolioId) {
              possibleReasons.push("MARLOW_BANES game requires APE portfolio but none exists");
              possibleReasons.push("APE portfolio generation may have failed");
            }
          }

          if (!portfoliosByStatus.PENDING && !portfoliosByStatus.LOCKED) {
            possibleReasons.push("No player portfolios created for this game");
          }

          const isExpired = new Date(game.endTime) <= now;
          if (isExpired) {
            possibleReasons.push("Game has already expired (endTime passed)");
          }

          if (possibleReasons.length === 0) {
            possibleReasons.push("Cron job may not be running or failed to process this game");
          }

          return {
            ...game,
            startedAgo: Math.round((now - new Date(game.startTime)) / 1000 / 60) + " minutes",
            isExpired,
            hasApePortfolio: !!hasApePortfolio,
            requiresApePortfolio: game.winCondition?.type === "MARLOW_BANES",
            portfoliosByStatus,
            totalPortfolios: Object.values(portfoliosByStatus).reduce((a, b) => a + b, 0),
            possibleReasons,
          };
        })
      );

      res.json({
        currentTime: now,
        statusCounts: statusCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        stuckGames: {
          activeButEnded: activeGamesEnriched,
          stuckInProcessing: processingGamesEnriched,
          upcomingButStarted: upcomingGamesEnriched,
        },
      });
    } catch (error) {
      console.error("Error fetching game diagnostics:", error);
      res.status(500).json({ error: "Failed to fetch diagnostics" });
    }
  }),

  // Fix stuck games manually
  fixStuckGames: asyncHandler(async (req, res) => {
    try {
      const now = new Date();
      const results = {
        activeToUpdateValues: [],
        upcomingToActive: [],
        apePortfoliosGenerated: [],
        skipped: [],
        errors: [],
      };

      // 1. Fix ACTIVE games that have ended - transition to UPDATE_VALUES
      const stuckActiveGames = await Game.find({
        status: "ACTIVE",
        endTime: { $lte: now },
      });

      for (const game of stuckActiveGames) {
        try {
          game.status = "UPDATE_VALUES";
          game.updatedAt = now;
          await game.save();
          results.activeToUpdateValues.push({
            gameId: game.gameId,
            name: game.name,
            newStatus: "UPDATE_VALUES",
          });
          console.log(`[FIX] Game ${game.gameId} forced from ACTIVE to UPDATE_VALUES`);
        } catch (error) {
          results.errors.push({
            gameId: game.gameId,
            error: error.message,
          });
        }
      }

      // 2. Try to generate APE portfolios for MARLOW_BANES games that are missing them
      const gamesNeedingApe = await Game.find({
        status: "UPCOMING",
        "winCondition.type": "MARLOW_BANES",
        $or: [
          { apePortfolio: { $exists: false } },
          { "apePortfolio.portfolioId": { $exists: false } },
          { "apePortfolio.portfolioId": null },
        ],
      });

      for (const game of gamesNeedingApe) {
        try {
          // Check if APE portfolio already exists in Portfolio collection
          const existingApe = await Portfolio.findOne({ gameId: game.gameId, isApe: true });

          if (existingApe) {
            // Link existing APE portfolio to game
            game.apePortfolio = { portfolioId: existingApe.portfolioId };
            await game.save();
            results.apePortfoliosGenerated.push({
              gameId: game.gameId,
              name: game.name,
              portfolioId: existingApe.portfolioId,
              action: "linked_existing",
            });
            console.log(`[FIX] Linked existing APE portfolio ${existingApe.portfolioId} to game ${game.gameId}`);
          } else {
            // Generate new APE portfolio
            console.log(`[FIX] Generating APE portfolio for game ${game.gameId} (${game.gameType})`);
            const apePortfolioId = await gameService.generateApePortfolio(game.gameId, game.gameType);
            game.apePortfolio = { portfolioId: apePortfolioId };
            await game.save();
            results.apePortfoliosGenerated.push({
              gameId: game.gameId,
              name: game.name,
              portfolioId: apePortfolioId,
              action: "generated_new",
            });
            console.log(`[FIX] Generated APE portfolio ${apePortfolioId} for game ${game.gameId}`);
          }
        } catch (error) {
          console.error(`[FIX] Failed to generate APE portfolio for game ${game.gameId}:`, error.message);
          results.errors.push({
            gameId: game.gameId,
            error: `APE portfolio generation failed: ${error.message}`,
            details: error.message.includes("Not enough")
              ? "Need 8+ active APE assets"
              : error.message.includes("APE user not found")
              ? "APE_USER_ID env var not set"
              : "Check server logs for details",
          });
        }
      }

      // 3. Fix UPCOMING games that should have started - transition to ACTIVE
      const stuckUpcomingGames = await Game.find({
        status: "UPCOMING",
        startTime: { $lte: now },
        endTime: { $gt: now }, // Only if game hasn't ended yet
      });

      for (const game of stuckUpcomingGames) {
        try {
          // Check for APE portfolio requirement
          if (game.winCondition?.type === "MARLOW_BANES") {
            if (!game.apePortfolio?.portfolioId) {
              // Skip - APE portfolio still missing (will be in errors from step 2)
              console.log(`[FIX] Skipping game ${game.gameId} - still missing APE portfolio`);
              continue;
            }
          }

          // Lock portfolios and activate
          await gameService.lockPortfolios(game);
          game.status = "ACTIVE";
          game.updatedAt = now;
          await game.save();

          results.upcomingToActive.push({
            gameId: game.gameId,
            name: game.name,
            newStatus: "ACTIVE",
          });
          console.log(`[FIX] Game ${game.gameId} forced from UPCOMING to ACTIVE`);
        } catch (error) {
          results.errors.push({
            gameId: game.gameId,
            error: error.message,
          });
        }
      }

      // 4. Skip UPCOMING games that have already ended (mark as COMPLETED directly)
      const expiredUpcomingGames = await Game.find({
        status: "UPCOMING",
        endTime: { $lte: now },
      });

      for (const game of expiredUpcomingGames) {
        try {
          game.status = "COMPLETED";
          game.error = "Game expired without starting - auto-completed";
          game.updatedAt = now;
          await game.save();
          results.skipped.push({
            gameId: game.gameId,
            name: game.name,
            reason: "Expired without starting",
            newStatus: "COMPLETED",
          });
          console.log(`[FIX] Game ${game.gameId} expired without starting - marked COMPLETED`);
        } catch (error) {
          results.errors.push({
            gameId: game.gameId,
            error: error.message,
          });
        }
      }

      // 5. Fix CALCULATING_WINNERS games that have winners calculated but rewards not distributed
      results.rewardsDistributed = [];
      const stuckCalculatingGames = await Game.find({
        status: "CALCULATING_WINNERS",
        hasCalculatedWinners: true,
      });

      for (const game of stuckCalculatingGames) {
        try {
          const undistributedWinners = game.winners.filter((w) => !w.isRewardDistributed);

          if (undistributedWinners.length === 0) {
            // No winners to distribute - mark as complete
            game.isFullyDistributed = true;
            game.status = "COMPLETED";
            game.updatedAt = now;
            await game.save();
            results.rewardsDistributed.push({
              gameId: game.gameId,
              name: game.name,
              action: "marked_complete",
              reason: "No undistributed winners",
            });
            console.log(`[FIX] Game ${game.gameId} had no undistributed winners - marked COMPLETED`);
          } else {
            // Try to distribute rewards
            console.log(
              `[FIX] Attempting reward distribution for game ${game.gameId} (${undistributedWinners.length} winners)`
            );
            try {
              await gameService.distributeGameRewards(game);
              results.rewardsDistributed.push({
                gameId: game.gameId,
                name: game.name,
                action: "distributed",
                winnersProcessed: undistributedWinners.length,
              });
              console.log(`[FIX] Successfully distributed rewards for game ${game.gameId}`);
            } catch (distError) {
              // If distribution fails, check if all winners are APE (which don't need blockchain)
              const allWinnersAreApe = await Promise.all(
                undistributedWinners.map(async (w) => {
                  const portfolio = await Portfolio.findOne({ portfolioId: w.portfolioId });
                  return portfolio?.isApe === true;
                })
              ).then((results) => results.every(Boolean));

              if (allWinnersAreApe || undistributedWinners.length === 0) {
                // All winners are APE or none exist - mark as complete
                game.isFullyDistributed = true;
                game.status = "COMPLETED";
                game.updatedAt = now;
                await game.save();
                results.rewardsDistributed.push({
                  gameId: game.gameId,
                  name: game.name,
                  action: "marked_complete",
                  reason: "All winners are APE (no blockchain distribution needed)",
                });
                console.log(`[FIX] Game ${game.gameId} - all winners are APE, marked COMPLETED`);
              } else {
                throw distError;
              }
            }
          }
        } catch (error) {
          console.error(`[FIX] Failed to process CALCULATING_WINNERS game ${game.gameId}:`, error.message);

          // Provide helpful error messages based on error type
          let details = "Check server logs for details";
          if (error.message.includes("INSUFFICIENT_FUNDS") || error.message.includes("insufficient funds")) {
            details = "⚠️ Admin wallet needs more BNB for gas fees! Send at least 0.01 BNB to cover transaction costs.";
          } else if (error.message.includes("nonce")) {
            details = "Transaction nonce issue - try again in a few minutes";
          } else if (error.message.includes("timeout") || error.message.includes("TIMEOUT")) {
            details = "Blockchain RPC timeout - network may be congested";
          }

          results.errors.push({
            gameId: game.gameId,
            error: `Reward distribution failed: ${error.message.substring(0, 200)}...`,
            details,
          });
        }
      }

      res.json({
        success: true,
        message: "Stuck games processed",
        results,
        summary: {
          activeToUpdateValues: results.activeToUpdateValues.length,
          apePortfoliosGenerated: results.apePortfoliosGenerated.length,
          upcomingToActive: results.upcomingToActive.length,
          rewardsDistributed: results.rewardsDistributed.length,
          skipped: results.skipped.length,
          errors: results.errors.length,
        },
      });
    } catch (error) {
      console.error("Error fixing stuck games:", error);
      res.status(500).json({ error: "Failed to fix stuck games" });
    }
  }),

  // Get community stats (lightweight endpoint)
  getCommunityStats: asyncHandler(async (req, res) => {
    const ethers = require("ethers");

    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    try {
      const cacheKey = "communityStats";
      const cacheTTL = 5 * 60 * 1000; // 5 minutes cache

      let communityStats;
      if (global.communityStatsCache && Date.now() - global.communityStatsCache.timestamp < cacheTTL) {
        communityStats = global.communityStatsCache.data;
      } else {
        const completedGames = await Game.find({
          status: "COMPLETED",
          totalPrizePool: { $exists: true, $ne: null, $ne: "" },
        })
          .select("totalPrizePool")
          .lean();

        let totalPrizePoolWei = BigInt(0);
        for (const game of completedGames) {
          if (game.totalPrizePool) {
            totalPrizePoolWei += BigInt(game.totalPrizePool);
          }
        }
        const totalPrizePoolUSDC = weiToUSDC(totalPrizePoolWei.toString());

        const portfolioStats = await Portfolio.aggregate([
          { $match: { status: { $ne: "PENDING" } } },
          {
            $group: {
              _id: null,
              avgPerformance: { $avg: "$performancePercentage" },
              totalPortfolios: { $sum: 1 },
            },
          },
        ]);

        const userStats = await User.find({ totalGamesPlayed: { $gt: 0 } })
          .select("totalEarnings")
          .lean();

        const userCount = userStats.length;
        let totalEarningsWei = BigInt(0);
        for (const user of userStats) {
          if (user.totalEarnings) {
            totalEarningsWei += BigInt(user.totalEarnings);
          }
        }
        const totalEarningsUSDC = weiToUSDC(totalEarningsWei.toString());
        const avgEarnings = userCount > 0 ? totalEarningsUSDC / userCount : 0;

        const portfolioAvg = portfolioStats[0]?.avgPerformance || 0;

        const totalCompletedGamesCount = await Game.countDocuments({ status: "COMPLETED" });

        communityStats = {
          totalPrizePoolDistributed: totalPrizePoolUSDC,
          avgPerformance: Number(portfolioAvg.toFixed(2)),
          avgEarnings: Number(avgEarnings.toFixed(2)),
          totalUsers: userCount,
          totalCompletedGamesCount,
        };

        global.communityStatsCache = {
          data: communityStats,
          timestamp: Date.now(),
        };
      }

      res.json(communityStats);
    } catch (error) {
      console.error("Error getting community stats:", error);
      throw error;
    }
  }),

  // Get leaderboard only (paginated)
  getGlobalLeaderboard: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const { page = 1, limit = 20 } = req.query;

    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    try {
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const topUsers = await User.aggregate([
        { $match: { totalGamesPlayed: { $gt: 0 } } },
        {
          $lookup: {
            from: "portfolios",
            let: { userId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$userId", "$$userId"] },
                  status: { $ne: "PENDING" },
                  createdAt: {
                    $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
                  },
                },
              },
            ],
            as: "portfolios",
          },
        },
        {
          $addFields: {
            totalPortfolios: { $size: "$portfolios" },
            avgPerformance: { $avg: "$portfolios.performancePercentage" },
          },
        },
        {
          $addFields: {
            points: {
              $sum: {
                $map: {
                  input: "$portfolios",
                  as: "portfolio",
                  in: { $ifNull: ["$$portfolio.performancePercentage", 0] },
                },
              },
            },
          },
        },
        {
          $project: {
            username: {
              $ifNull: ["$username", { $concat: [{ $substr: ["$address", 0, 8] }, "..."] }],
            },
            profileImage: 1,
            totalPortfolios: 1,
            wins: "$gamesWon",
            totalEarnings: "$totalEarnings",
            avgPerformance: { $round: ["$avgPerformance", 2] },
            points: { $round: ["$points", 2] },
          },
        },
        { $sort: { points: -1, totalEarnings: -1 } },
        { $skip: skip },
        { $limit: parseInt(limit) },
      ]);

      const totalUsers = await User.countDocuments({ totalGamesPlayed: { $gt: 0 } });

      const leaderboard = topUsers.map((user, index) => ({
        ...user,
        totalEarnings: weiToUSDC(user.totalEarnings),
        position: `${skip + index + 1}${
          skip + index + 1 === 1 ? "st" : skip + index + 1 === 2 ? "nd" : skip + index + 1 === 3 ? "rd" : "th"
        }`,
      }));

      res.json({
        leaderboard,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalUsers,
          pages: Math.ceil(totalUsers / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error getting leaderboard:", error);
      throw error;
    }
  }),

  // Get Ape (Marlow Baines) stats
  getApeStats: asyncHandler(async (req, res) => {
    try {
      const apeStats = await Portfolio.aggregate([
        {
          $match: {
            isApe: true,
            status: { $ne: "PENDING" },
          },
        },
        {
          $group: {
            _id: "$gameType",
            totalGames: { $sum: 1 },
            wonGames: {
              $sum: {
                $cond: [{ $eq: ["$status", "WON"] }, 1, 0],
              },
            },
            avgPerformance: { $avg: "$performancePercentage" },
          },
        },
        {
          $project: {
            gameType: "$_id",
            totalGames: 1,
            wonGames: 1,
            winPercentage: {
              $cond: [
                { $gt: ["$totalGames", 0] },
                {
                  $round: [
                    {
                      $multiply: [{ $divide: ["$wonGames", "$totalGames"] }, 100],
                    },
                    2,
                  ],
                },
                0,
              ],
            },
            avgPerformance: { $round: ["$avgPerformance", 2] },
          },
        },
      ]);

      const apePortfolioStats = {
        name: "Marlow Baines",
        defi: apeStats.find((s) => s.gameType === "DEFI") || {
          totalGames: 0,
          wonGames: 0,
          winPercentage: 0,
          avgPerformance: 0,
        },
        tradfi: apeStats.find((s) => s.gameType === "TRADFI") || {
          totalGames: 0,
          wonGames: 0,
          winPercentage: 0,
          avgPerformance: 0,
        },
      };

      res.json(apePortfolioStats);
    } catch (error) {
      console.error("Error getting ape stats:", error);
      throw error;
    }
  }),

  // Get week highlights
  getWeekHighlights: asyncHandler(async (req, res) => {
    const ethers = require("ethers");

    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    try {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const thisWeekPortfolios = await Portfolio.find({
        status: "WON",
        "gameOutcome.settledAt": { $gte: startOfWeek },
      })
        .select("portfolioId portfolioName gameId gameType performancePercentage userId gameOutcome.reward")
        .lean()
        .limit(1000);

      let formattedWeekHighlights = {
        biggestWin: null,
        topPerformer: null,
        mostWins: null,
      };

      if (thisWeekPortfolios.length > 0) {
        const userIds = [...new Set(thisWeekPortfolios.map((p) => p.userId?.toString()).filter(Boolean))];
        const gameIds = [...new Set(thisWeekPortfolios.map((p) => p.gameId).filter(Boolean))];

        const [users, games] = await Promise.all([
          User.find({ _id: { $in: userIds } })
            .select("username address profileImage")
            .lean(),
          Game.find({ gameId: { $in: gameIds } })
            .select("gameId name endTime")
            .lean(),
        ]);

        const usersMap = {};
        users.forEach((u) => {
          usersMap[u._id.toString()] = u;
        });

        const gamesMap = {};
        games.forEach((g) => {
          gamesMap[g.gameId] = g;
        });

        const enrichedPortfolios = thisWeekPortfolios
          .map((p) => {
            const user = usersMap[p.userId?.toString()];
            const game = gamesMap[p.gameId];
            if (!user || !game) return null;

            return {
              portfolioId: p.portfolioId,
              portfolioName: p.portfolioName,
              gameId: p.gameId,
              gameType: p.gameType,
              performancePercentage: p.performancePercentage,
              userId: p.userId?.toString(),
              reward: p.gameOutcome?.reward || "0",
              username: user.username || user.address.slice(0, 8) + "...",
              profileImage: user.profileImage,
              gameName: game.name,
              endTime: game.endTime,
            };
          })
          .filter(Boolean);

        if (enrichedPortfolios.length > 0) {
          const biggestWin = enrichedPortfolios.reduce((max, p) => {
            const reward = weiToUSDC(p.reward || "0");
            const maxReward = weiToUSDC(max.reward || "0");
            return reward > maxReward ? p : max;
          }, enrichedPortfolios[0]);

          const topPerformer = enrichedPortfolios.reduce((max, p) =>
            p.performancePercentage > max.performancePercentage ? p : max
          );

          const winsByUser = {};
          enrichedPortfolios.forEach((p) => {
            if (!winsByUser[p.userId]) {
              winsByUser[p.userId] = {
                username: p.username,
                profileImage: p.profileImage,
                wins: 0,
                totalReward: 0,
              };
            }
            winsByUser[p.userId].wins += 1;
            winsByUser[p.userId].totalReward += weiToUSDC(p.reward || "0");
          });

          const mostWinsUser = Object.values(winsByUser).reduce((max, u) => (u.wins > max.wins ? u : max));

          formattedWeekHighlights = {
            biggestWin: {
              username: biggestWin.username,
              profileImage: biggestWin.profileImage,
              portfolioId: biggestWin.portfolioId,
              portfolioName: biggestWin.portfolioName,
              gameType: biggestWin.gameType,
              gameId: biggestWin.gameId,
              gameName: biggestWin.gameName,
              reward: weiToUSDC(biggestWin.reward || "0"),
              performance: biggestWin.performancePercentage?.toFixed(2) + "%",
            },
            topPerformer: {
              username: topPerformer.username,
              profileImage: topPerformer.profileImage,
              portfolioId: topPerformer.portfolioId,
              portfolioName: topPerformer.portfolioName,
              gameType: topPerformer.gameType,
              gameId: topPerformer.gameId,
              gameName: topPerformer.gameName,
              reward: weiToUSDC(topPerformer.reward || "0"),
              performance: topPerformer.performancePercentage?.toFixed(2) + "%",
            },
            mostWins: {
              username: mostWinsUser.username,
              profileImage: mostWinsUser.profileImage,
              wins: mostWinsUser.wins,
              totalReward: mostWinsUser.totalReward,
            },
          };
        }
      }

      res.json(formattedWeekHighlights);
    } catch (error) {
      console.error("Error getting week highlights:", error);
      throw error;
    }
  }),

  // Get game leaderboard with pagination and filters
  getGameLeaderboard: asyncHandler(async (req, res) => {
    const { gameId } = req.params;
    const { page = 1, limit = 50, sortBy = "performance" } = req.query;

    const game = await Game.findOne({ gameId });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const portfolios = await Portfolio.find({
      gameId,
      status: "ACTIVE",
    })
      .populate("userId", "username profileImage")
      .skip((page - 1) * limit)
      .limit(limit);

    // Get current prices and update portfolio values
    const assets = await Asset.find({ type: game.gameType });
    const prices = await priceService.getCurrentPrices(assets);
    await Promise.all(portfolios.map((p) => p.calculateValue(prices)));

    // Sort portfolios based on criteria
    const sortedPortfolios = portfolios.sort((a, b) => {
      switch (sortBy) {
        case "value":
          return b.currentValue - a.currentValue;
        case "change":
          return b.performancePercentage - a.performancePercentage;
        default:
          return b.performancePercentage - a.performancePercentage;
      }
    });

    const leaderboard = sortedPortfolios.map((p, index) => ({
      rank: (page - 1) * limit + index + 1,
      username: p.userId.username,
      profileImage: p.userId.profileImage,
      currentValue: p.currentValue,
      initialValue: p.initialValue,
      performancePercentage: p.performancePercentage,
      assets: p.assets.map((asset) => ({
        symbol: asset.symbol,
        allocation: asset.allocation,
        currentValue: asset.tokenQty * prices[asset.symbol].price,
      })),
    }));

    // Get total count for pagination
    const total = await Portfolio.countDocuments({ gameId, status: "ACTIVE" });

    res.json({
      game: {
        id: game.gameId,
        type: game.gameType,
        status: game.status,
        startTime: game.startTime,
        endTime: game.endTime,
        totalPrizePool: game.totalPrizePool,
        participantCount: game.participantCount,
        apePerformance: game.apePortfolio.performancePercentage,
      },
      leaderboard,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }),

  // Get game history with filters
  getGameHistory: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const { type, limit = 10, page = 1 } = req.query;
    const userId = req.user._id;

    // Find portfolios created by the user
    const userPortfolios = await Portfolio.find({ userId }).select("gameId gameOutcome");
    const gameIds = Array.from(new Set(userPortfolios.map((p) => p.gameId)));

    const query = {
      status: { $nin: ["TRX-PENDING", "UPCOMING", "PENDING", "FAILED"] },
      gameId: { $in: gameIds },
    };

    if (type) {
      query.gameType = type.toUpperCase();
    }

    const games = await Game.find(query)
      .sort({ endTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Game.countDocuments(query);

    // Helper function to convert wei to USDC dollars
    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    res.json({
      games: games.map((game) => {
        const gameObj = game.toObject();
        return {
          ...gameObj,
          totalPrizePool: weiToUSDC(gameObj.totalPrizePool),
        };
      }),
      userPortfolios: userPortfolios.map((p) => {
        const portfolioObj = p.toObject ? p.toObject() : p;
        return {
          ...portfolioObj,
          gameOutcome: portfolioObj.gameOutcome
            ? {
                ...portfolioObj.gameOutcome,
                reward: weiToUSDC(portfolioObj.gameOutcome.reward),
              }
            : null,
        };
      }),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }),

  // Get detailed game statistics
  getGameDetails: asyncHandler(async (req, res) => {
    const { gameId } = req.params;
    const game = await Game.findOne({ gameId }).populate("winners.userId", "username profileImage");

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const stats = await gameService.getGameStatistics(gameId);
    const apePortfolio = await portfolioService.getPortfolioDetails(game.apePortfolio.portfolioId);

    res.json({
      game: game.toObject(),
      statistics: stats,
      apePortfolio,
    });
  }),

  // Submit a new portfolio
  submitPortfolio: asyncHandler(async (req, res) => {
    const { assets } = req.body;
    const userId = req.user._id;

    // Process entry fee first
    const transaction = await transactionService.processEntryFee(userId);

    // Create portfolio
    const portfolio = await portfolioService.createPortfolio(userId, assets);

    res.json({
      portfolio,
      transaction,
    });
  }),

  // Get user's current portfolio with performance metrics
  getCurrentPortfolio: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const portfolio = await portfolioService.getCurrentPortfolio(userId);

    if (!portfolio) {
      return res.json({ status: "NO_ACTIVE_PORTFOLIO" });
    }

    const comparison = await portfolioService.getPortfolioComparison(portfolio.portfolioId);
    const history = await portfolioService.getPortfolioHistory(portfolio.portfolioId);

    res.json({
      portfolio,
      comparison,
      history,
    });
  }),

  // Get portfolio details with asset performance
  getPortfolioDetails: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const details = await portfolioService.getPortfolioDetails(portfolioId);
    const comparison = await portfolioService.getPortfolioComparison(portfolioId);
    const history = await portfolioService.getPortfolioHistory(portfolioId);

    res.json({
      ...details,
      comparison,
      history,
    });
  }),

  // Get portfolio performance history
  getPortfolioHistory: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const { period = "7d" } = req.query;

    const history = await portfolioService.getPortfolioHistory(portfolioId, period);
    res.json(history);
  }),

  // Compare portfolio against the Ape
  getPortfolioComparison: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const comparison = await portfolioService.getPortfolioComparison(portfolioId);
    res.json(comparison);
  }),

  // Get available assets for portfolio creation
  getAvailableAssets: asyncHandler(async (req, res) => {
    const { type = "DEFI" } = req.query;
    const assets = await Asset.find({
      type: type.toUpperCase(),
      isActive: true,
    }).select("assetId symbol name currentPrice change24h");

    const prices = await priceService.getCurrentPrices(assets);

    res.json(
      assets.map((asset) => ({
        ...asset.toObject(),
        currentPrice: prices[asset.symbol].price,
        change24h: prices[asset.symbol].change24h,
      }))
    );
  }),

  // Get USDC balance for the user (returns wei for blockchain interactions)
  getBalanceApproval: asyncHandler(async (req, res) => {
    const { gameId } = req.params;
    const userAddress = req.user.address;
    try {
      const balance = await blockchainService.getUSDCBalance(userAddress);
      const approvalData = await blockchainService.checkUSDCAllowance(userAddress, gameId);

      // Return wei strings for frontend blockchain interactions
      res.json({
        balance: balance, // wei string
        requiredApproval: approvalData.requiredAmount, // wei string
        needsApproval: approvalData.needsApproval,
        currentAllowance: approvalData.currentAllowance, // wei string
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }),

  // Get USDC balance for the user
  getUSDCBalance: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const address = req.user.wallet;
    try {
      const balance = await blockchainService.getUSDCBalance(address);

      // Helper function to convert wei to USDC dollars
      const weiToUSDC = (weiValue) => {
        if (!weiValue) return 0;
        const weiStr = String(weiValue);
        return parseFloat(ethers.utils.formatUnits(weiStr, 18));
      };

      res.json({ balance: weiToUSDC(balance) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }),

  // Get required USDC approval for the user
  getRequiredApproval: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const { gameId } = req.params;
    const address = req.user.address;
    try {
      const approvalData = await blockchainService.checkUSDCAllowance(address, gameId);

      // Helper function to convert wei to USDC dollars
      const weiToUSDC = (weiValue) => {
        if (!weiValue) return 0;
        const weiStr = String(weiValue);
        return parseFloat(ethers.utils.formatUnits(weiStr, 18));
      };

      res.json({
        needsApproval: approvalData.needsApproval,
        requiredAmount: weiToUSDC(approvalData.requiredAmount),
        currentAllowance: weiToUSDC(approvalData.currentAllowance),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }),

  // Get admin wallet info and transactions from BSCScan
  getAdminWalletInfo: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const config = require("../config");

    try {
      // Derive admin wallet address from private key (same as blockchain service)
      const adminWallet = new ethers.Wallet(config.blockchain.privateKey);
      const adminWalletAddress = adminWallet.address;

      if (!adminWalletAddress) {
        return res.status(400).json({ error: "Admin wallet address not configured" });
      }

      // Get current BNB balance
      const provider = new ethers.providers.JsonRpcProvider(config.blockchain.rpcUrl);
      const balanceWei = await provider.getBalance(adminWalletAddress);
      const balanceBNB = parseFloat(ethers.utils.formatEther(balanceWei));

      // Fetch transactions from Etherscan API V2 (unified multichain endpoint)
      // Reference: https://docs.etherscan.io/v2-migration
      const bscscanApiKey = process.env.BSCSCAN_API_KEY || "";

      // V2 API uses unified endpoint with chainid parameter
      // BSC Mainnet: chainid=56, BSC Testnet: chainid=97
      const isMainnet = process.env.NODE_ENV === "production";
      const chainId = isMainnet ? "56" : "97";
      const apiBaseUrl = "https://api.etherscan.io/v2/api";

      console.log(`[ADMIN_WALLET] Fetching transactions for ${adminWalletAddress}`);
      console.log(`[ADMIN_WALLET] Network: ${isMainnet ? "BSC Mainnet" : "BSC Testnet"} (chainId: ${chainId})`);
      console.log(`[ADMIN_WALLET] Using Etherscan API V2: ${apiBaseUrl}`);
      console.log(
        `[ADMIN_WALLET] API Key present: ${bscscanApiKey ? "Yes (" + bscscanApiKey.slice(0, 4) + "...)" : "No"}`
      );

      // Fetch normal transactions using V2 unified endpoint
      const txUrl = `${apiBaseUrl}?chainid=${chainId}&module=account&action=txlist&address=${adminWalletAddress}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${bscscanApiKey}`;
      console.log(`[ADMIN_WALLET] Request URL: ${txUrl.replace(bscscanApiKey, "API_KEY_HIDDEN")}`);

      const txResponse = await fetch(txUrl);
      const responseText = await txResponse.text();

      // Check if response is HTML (error page) instead of JSON
      let txData;
      try {
        txData = JSON.parse(responseText);
      } catch (parseError) {
        console.error(
          `[ADMIN_WALLET] Failed to parse response as JSON. Response starts with: ${responseText.substring(0, 100)}`
        );
        txData = { status: "0", message: "Invalid response from BSCScan", result: responseText.substring(0, 200) };
      }

      console.log(`[ADMIN_WALLET] BSCScan response status: ${txData.status}, message: ${txData.message}`);
      if (txData.result) {
        console.log(
          `[ADMIN_WALLET] Results: ${
            Array.isArray(txData.result) ? txData.result.length + " transactions" : txData.result
          }`
        );
      }

      // Process transactions into accounting format
      const transactions = [];
      let apiWarning = null;

      // Check for API errors
      if (txData.status === "0") {
        if (txData.message === "No transactions found") {
          console.log(`[ADMIN_WALLET] No transactions found for this address`);
        } else {
          apiWarning = txData.message || txData.result || "BSCScan API returned an error";
          console.error(`[ADMIN_WALLET] BSCScan API warning: ${apiWarning}`);
        }
      }

      if (txData.status === "1" && Array.isArray(txData.result)) {
        for (const tx of txData.result) {
          const valueBNB = parseFloat(ethers.utils.formatEther(tx.value || "0"));
          const gasCostBNB = parseFloat(
            ethers.utils.formatEther(
              ethers.BigNumber.from(tx.gasUsed || "0")
                .mul(ethers.BigNumber.from(tx.gasPrice || "0"))
                .toString()
            )
          );

          const isIncoming = tx.to?.toLowerCase() === adminWalletAddress.toLowerCase();
          const isOutgoing = tx.from?.toLowerCase() === adminWalletAddress.toLowerCase();

          transactions.push({
            hash: tx.hash,
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
            type: isIncoming ? "IN" : "OUT",
            from: tx.from,
            to: tx.to,
            valueBNB: valueBNB,
            gasCostBNB: isOutgoing ? gasCostBNB : 0,
            status: tx.isError === "0" ? "SUCCESS" : "FAILED",
            method: tx.functionName ? tx.functionName.split("(")[0] : valueBNB > 0 ? "transfer" : "contract_call",
            blockNumber: parseInt(tx.blockNumber),
          });
        }
      }

      // Calculate totals
      const totals = transactions.reduce(
        (acc, tx) => {
          if (tx.type === "IN") {
            acc.totalIn += tx.valueBNB;
          } else {
            acc.totalOut += tx.valueBNB;
            acc.totalGas += tx.gasCostBNB;
          }
          return acc;
        },
        { totalIn: 0, totalOut: 0, totalGas: 0 }
      );

      res.json({
        wallet: {
          address: adminWalletAddress,
          balanceBNB: balanceBNB,
          balanceUSD: null, // Could add price lookup
        },
        totals: {
          totalInBNB: totals.totalIn,
          totalOutBNB: totals.totalOut,
          totalGasBNB: totals.totalGas,
          netFlowBNB: totals.totalIn - totals.totalOut - totals.totalGas,
        },
        transactions: transactions.slice(0, 100), // Limit to 100 most recent
        transactionCount: transactions.length,
        apiWarning: apiWarning,
        debug: {
          bscscanStatus: txData.status,
          bscscanMessage: txData.message,
          bscscanResult: txData.status === "0" ? txData.result : `${transactions.length} transactions`,
          hasApiKey: !!bscscanApiKey,
          apiKeyPreview: bscscanApiKey ? bscscanApiKey.slice(0, 6) + "..." : "NOT SET",
          network: isMainnet ? "BSC Mainnet" : "BSC Testnet",
          chainId: chainId,
          apiVersion: "V2",
          apiEndpoint: apiBaseUrl,
        },
      });
    } catch (error) {
      console.error("Error fetching admin wallet info:", error);
      res.status(500).json({ error: error.message });
    }
  }),

  // Get Marlow earnings - games where Marlow won and prize pool is unclaimed
  getMarlowEarnings: asyncHandler(async (req, res) => {
    const ethers = require("ethers");

    try {
      // Find all MARLOW_BANES games that are completed
      const marlowGames = await Game.find({
        "winCondition.type": "MARLOW_BANES",
        status: "COMPLETED",
      }).sort({ endTime: -1 });

      const earnings = [];
      let totalUnclaimed = 0;

      for (const game of marlowGames) {
        try {
          // Get prize pool info from blockchain
          const gameDetails = await blockchainService.getGameDetails(game.gameId);
          const totalPrizePool = parseFloat(ethers.utils.formatUnits(gameDetails.totalPrizePool, 18));
          const totalDistributed = parseFloat(ethers.utils.formatUnits(gameDetails.totalRewardDistributed, 18));
          const availableToWithdraw = totalPrizePool - totalDistributed;

          // Check if Marlow won (available > 0 means undistributed funds)
          const marlowWon = availableToWithdraw > 0.001; // Small threshold for rounding

          // Get APE user info
          const apeUser = await User.findById(process.env.APE_USER_ID);
          const isApeInWinners = game.winners.some((w) => w.portfolioId === game.apePortfolio?.portfolioId);

          // Determine win status
          let winStatus = "PLAYERS_WON";
          if (marlowWon || isApeInWinners) {
            winStatus = "MARLOW_WON";
          } else if (totalDistributed > 0) {
            winStatus = "PLAYERS_WON";
          }

          if (availableToWithdraw > 0.001) {
            totalUnclaimed += availableToWithdraw;
          }

          earnings.push({
            gameId: game.gameId,
            name: game.name,
            endTime: game.endTime,
            participantCount: game.participantCount,
            totalPrizePool: totalPrizePool,
            totalDistributed: totalDistributed,
            availableToWithdraw: availableToWithdraw,
            winStatus: winStatus,
            winnersCount: game.winners.length,
            canWithdraw: availableToWithdraw > 0.001,
            apePortfolioId: game.apePortfolio?.portfolioId,
          });
        } catch (error) {
          console.error(`Error processing game ${game.gameId}:`, error.message);
          earnings.push({
            gameId: game.gameId,
            name: game.name,
            endTime: game.endTime,
            error: error.message,
            canWithdraw: false,
          });
        }
      }

      // Sort by available to withdraw (highest first)
      earnings.sort((a, b) => (b.availableToWithdraw || 0) - (a.availableToWithdraw || 0));

      res.json({
        totalUnclaimed: totalUnclaimed,
        gamesCount: marlowGames.length,
        gamesWithUnclaimed: earnings.filter((e) => e.canWithdraw).length,
        earnings: earnings,
      });
    } catch (error) {
      console.error("Error fetching Marlow earnings:", error);
      res.status(500).json({ error: error.message });
    }
  }),

  // Withdraw Marlow earnings from a specific game
  withdrawMarlowEarnings: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const { gameId } = req.params;

    try {
      // Verify game exists and is MARLOW_BANES type
      const game = await Game.findOne({
        gameId: parseInt(gameId),
        "winCondition.type": "MARLOW_BANES",
      });

      if (!game) {
        return res.status(404).json({ error: "Game not found or not a MARLOW_BANES game" });
      }

      // Get current prize pool info from blockchain
      const gameDetails = await blockchainService.getGameDetails(parseInt(gameId));
      const totalPrizePool = BigInt(gameDetails.totalPrizePool);
      const totalDistributed = BigInt(gameDetails.totalRewardDistributed);
      const availableToWithdraw = totalPrizePool - totalDistributed;

      if (availableToWithdraw <= 0n) {
        return res.status(400).json({
          error: "No funds available to withdraw",
          totalPrizePool: ethers.utils.formatUnits(totalPrizePool.toString(), 18),
          totalDistributed: ethers.utils.formatUnits(totalDistributed.toString(), 18),
        });
      }

      // Call the contract to withdraw
      console.log(
        `[MARLOW] Withdrawing ${ethers.utils.formatUnits(availableToWithdraw.toString(), 18)} USDC from game ${gameId}`
      );

      const receipt = await blockchainService.withdrawFromPrizePool(parseInt(gameId), availableToWithdraw.toString());

      res.json({
        success: true,
        gameId: parseInt(gameId),
        amountWithdrawn: parseFloat(ethers.utils.formatUnits(availableToWithdraw.toString(), 18)),
        transactionHash: receipt.transactionHash,
        message: `Successfully withdrew ${ethers.utils.formatUnits(
          availableToWithdraw.toString(),
          18
        )} USDC from game ${gameId}`,
      });
    } catch (error) {
      console.error(`Error withdrawing from game ${gameId}:`, error);
      res.status(500).json({
        error: error.message,
        details: error.message.includes("INSUFFICIENT_FUNDS")
          ? "Admin wallet needs more BNB for gas fees"
          : "Check server logs for details",
      });
    }
  }),

  // Get comprehensive game details for admin verification
  getAdminGameDetails: asyncHandler(async (req, res) => {
    const ethers = require("ethers");
    const { gameId } = req.params;

    try {
      // Get game from database
      const game = await Game.findOne({ gameId: parseInt(gameId) });
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      // Get all portfolios for this game
      const portfolios = await Portfolio.find({ gameId: parseInt(gameId) })
        .populate("userId", "username profileImage address")
        .sort({ performancePercentage: -1 });

      // Helper to convert wei to USDC
      const weiToUSDC = (weiValue) => {
        if (!weiValue) return 0;
        try {
          return parseFloat(ethers.utils.formatUnits(String(weiValue), 18));
        } catch {
          return 0;
        }
      };

      // Get blockchain data if game has started
      let blockchainData = null;
      try {
        const gameDetails = await blockchainService.getGameDetails(parseInt(gameId));
        blockchainData = {
          totalPrizePool: weiToUSDC(gameDetails.totalPrizePool),
          totalRewardDistributed: weiToUSDC(gameDetails.totalRewardDistributed),
          entryCount: gameDetails.entryCount,
          undistributed: weiToUSDC(gameDetails.totalPrizePool) - weiToUSDC(gameDetails.totalRewardDistributed),
        };
      } catch (error) {
        blockchainData = { error: error.message };
      }

      // Calculate totals from database
      const totalRewardsFromDB = portfolios.reduce((sum, p) => {
        const reward = weiToUSDC(p.gameOutcome?.reward);
        return sum + reward;
      }, 0);

      const winners = portfolios.filter((p) => p.gameOutcome?.isWinner === true);
      const losers = portfolios.filter((p) => p.gameOutcome?.isWinner === false);
      const pending = portfolios.filter((p) => !p.gameOutcome);

      // Identify APE portfolio
      const apePortfolio = portfolios.find((p) => p.isApe === true);

      // Format portfolio data
      const formattedPortfolios = portfolios.map((p, index) => {
        const reward = weiToUSDC(p.gameOutcome?.reward);
        return {
          rank: p.gameOutcome?.rank || index + 1,
          portfolioId: p.portfolioId,
          portfolioName: p.portfolioName,
          username: p.userId?.username || "Unknown",
          userAddress: p.userId?.address || null,
          isApe: p.isApe === true,
          status: p.status,
          gameType: p.gameType,
          initialValue: p.initialValue,
          currentValue: p.currentValue,
          performancePercentage: p.performancePercentage,
          isWinner: p.gameOutcome?.isWinner || false,
          reward: reward,
          rewardRaw: p.gameOutcome?.reward || "0",
          isRewardDistributed: game.winners?.find((w) => w.portfolioId === p.portfolioId)?.isRewardDistributed || false,
          assets: p.assets?.map((a) => ({
            symbol: a.symbol,
            type: a.type,
            allocation: a.allocation,
            initialPrice: a.initialPrice,
            currentPrice: a.currentPrice,
          })),
          createdAt: p.createdAt,
        };
      });

      // Check for data inconsistencies
      const issues = [];

      // Check if total rewards exceed prize pool
      if (blockchainData?.totalPrizePool && totalRewardsFromDB > blockchainData.totalPrizePool + 0.01) {
        issues.push({
          type: "REWARD_EXCEEDS_POOL",
          message: `Total rewards ($${totalRewardsFromDB.toFixed(
            2
          )}) exceed prize pool ($${blockchainData.totalPrizePool.toFixed(2)})`,
          severity: "ERROR",
        });
      }

      // Check if APE has non-zero reward
      if (apePortfolio && weiToUSDC(apePortfolio.gameOutcome?.reward) > 0) {
        issues.push({
          type: "APE_HAS_REWARD",
          message: `APE portfolio (Marlow) has reward of $${weiToUSDC(apePortfolio.gameOutcome?.reward).toFixed(
            2
          )} - should be $0`,
          severity: "ERROR",
          portfolioId: apePortfolio.portfolioId,
        });
      }

      // Check if APE is winner when there are other winners
      if (apePortfolio?.gameOutcome?.isWinner && winners.length > 1) {
        issues.push({
          type: "APE_WINNER_WITH_OTHERS",
          message:
            "APE is marked as winner but other players also won - Marlow should only win when NO players beat him",
          severity: "ERROR",
        });
      }

      // Check for missing reward distributions
      const winnersNotDistributed = game.winners?.filter(
        (w) => !w.isRewardDistributed && !portfolios.find((p) => p.portfolioId === w.portfolioId && p.isApe)
      );
      if (winnersNotDistributed?.length > 0) {
        issues.push({
          type: "UNDISTRIBUTED_REWARDS",
          message: `${winnersNotDistributed.length} winner(s) have not received their rewards yet`,
          severity: "WARNING",
          portfolioIds: winnersNotDistributed.map((w) => w.portfolioId),
        });
      }

      res.json({
        game: {
          gameId: game.gameId,
          name: game.name,
          status: game.status,
          gameType: game.gameType,
          startTime: game.startTime,
          endTime: game.endTime,
          winCondition: game.winCondition,
          participantCount: game.participantCount,
          totalPrizePoolDB: weiToUSDC(game.totalPrizePool),
          apePortfolioId: game.apePortfolio?.portfolioId,
          error: game.error,
          createdAt: game.createdAt,
          updatedAt: game.updatedAt,
        },
        blockchain: blockchainData,
        summary: {
          totalPortfolios: portfolios.length,
          winnersCount: winners.length,
          losersCount: losers.length,
          pendingCount: pending.length,
          totalRewardsShown: totalRewardsFromDB,
          hasApePortfolio: !!apePortfolio,
          apeIsWinner: apePortfolio?.gameOutcome?.isWinner || false,
        },
        portfolios: formattedPortfolios,
        winners: formattedPortfolios.filter((p) => p.isWinner),
        issues: issues,
      });
    } catch (error) {
      console.error(`Error fetching admin game details for ${gameId}:`, error);
      res.status(500).json({ error: error.message });
    }
  }),
};

module.exports = gameController;
