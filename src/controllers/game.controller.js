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
      const upcomingGames = await gameService.getGamesByStatus("UPCOMING");
      res.json({ games: upcomingGames });
    } catch (error) {
      console.error("Error fetching upcoming games:", error);
      res.status(500).json({ error: "Failed to fetch upcoming games" });
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
};

module.exports = gameController;
