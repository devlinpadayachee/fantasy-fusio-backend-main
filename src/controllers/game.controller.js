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

  // Get global leaderboard with all-time stats and last game winners
  getGlobalLeaderboard: asyncHandler(async (req, res) => {
    const ethers = require('ethers');

    // Helper function to convert wei to USDC dollars
    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    try {
      // Get last completed games for both DEFI and TRADFI
      const lastGames = await Game.find({
        status: "COMPLETED",
        gameType: { $in: ["DEFI", "TRADFI"] },
      })
        .sort({ endTime: -1 })
        .limit(1) // Get latest game of each type
        .populate({
          path: "winners",
          populate: {
            path: "userId",
            select: "username address",
          },
        });

      const totalCompletedGamesCount = await Game.countDocuments({
        status: "COMPLETED",
      });
      const upcomingGames = await Game.find({ status: "UPCOMING" }).limit(2);

      // Calculate true community-wide statistics (optimized)
      // Use cached stats if available, otherwise calculate
      let communityStats;
      const cacheKey = "communityStats";
      const cacheTTL = 5 * 60 * 1000; // 5 minutes cache

      // Try to get from simple in-memory cache (could be upgraded to Redis)
      if (global.communityStatsCache &&
          Date.now() - global.communityStatsCache.timestamp < cacheTTL) {
        communityStats = global.communityStatsCache.data;
      } else {
        // 1. Total prize pool distributed - optimized: only fetch prize pool field
        // Since totalPrizePool is stored as string (wei), we fetch and sum in JS
        // This is cached so it only runs every 5 minutes
        const completedGames = await Game.find({
          status: "COMPLETED",
          totalPrizePool: { $exists: true, $ne: null, $ne: "" }
        })
        .select("totalPrizePool")
        .lean(); // Use lean() for better performance

        let totalPrizePoolWei = BigInt(0);
        for (const game of completedGames) {
          if (game.totalPrizePool) {
            totalPrizePoolWei += BigInt(game.totalPrizePool);
          }
        }
        const totalPrizePoolUSDC = weiToUSDC(totalPrizePoolWei.toString());

        // 2. User stats - optimized aggregation without expensive $lookup
        // Calculate average performance directly from portfolios collection
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

        // User count and total earnings from User collection (much faster)
        // Since totalEarnings is stored as string (wei), we fetch and sum in JS
        const userStats = await User.find({ totalGamesPlayed: { $gt: 0 } })
          .select("totalEarnings")
          .lean(); // Use lean() for better performance

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

        communityStats = {
          totalPrizePoolDistributed: totalPrizePoolUSDC,
          avgPerformance: Number(portfolioAvg.toFixed(2)),
          avgEarnings: Number(avgEarnings.toFixed(2)),
          totalUsers: userCount,
        };

        // Cache the result
        global.communityStatsCache = {
          data: communityStats,
          timestamp: Date.now(),
        };
      }

      const totalPrizePoolUSDC = communityStats.totalPrizePoolDistributed;
      const communityAvgPerformance = communityStats.avgPerformance;
      const communityAvgEarnings = communityStats.avgEarnings;
      const totalUsers = communityStats.totalUsers;

      // Combine and sort all winners from both games
      const allWinners = lastGames.reduce((acc, game) => {
        return acc.concat(
          game.winners.map((w) => ({
            ...w.toObject(),
            gameType: game.gameType,
          }))
        );
      }, []);

      // Get top 3 winners overall
      const lastGameWinners =
        allWinners.length > 0
          ? await Promise.all(
              allWinners
                .sort(
                  (a, b) => b.performancePercentage - a.performancePercentage
                )
                .slice(0, 3)
                .map(async (winner, index) => {
                  // Get portfolio details for reward
                  const portfolio = await Portfolio.findOne({
                    portfolioId: winner.portfolioId,
                  });

                  // Get user details including profile image
                  const user = await User.findById(
                    winner.userId,
                    "username address profileImage"
                  );

                  const rewardWei = portfolio?.gameOutcome?.reward || 0;
                  const rewardUSDC = weiToUSDC(rewardWei);

                  return {
                    username: user.username || user.address.slice(0, 8) + "...",
                    profileImage: user.profileImage,
                    portfolioId: portfolio?.portfolioId,
                    portfolioName: portfolio?.portfolioName,
                    gameType: winner.gameType,
                    reward: rewardUSDC, // Convert to USDC
                    rewardFormatted: `${rewardUSDC.toFixed(2)} USDC`,
                    performance: winner.performancePercentage.toFixed(2) + "%",
                    position: ["1st", "2nd", "3rd"][index],
                  };
                })
            )
          : [];

      // Get all-time top users with non-pending portfolios
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
                    $gte: new Date(
                      new Date().getFullYear(),
                      new Date().getMonth(),
                      1
                    ),
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
            avgPerformance: {
              $avg: "$portfolios.performancePercentage",
            },
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
              $ifNull: [
                "$username",
                { $concat: [{ $substr: ["$address", 0, 8] }, "..."] },
              ],
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
        { $limit: 100 },
      ]);

      // Add position (1st, 2nd, 3rd, etc.) to each user and convert totalEarnings
      const leaderboard = topUsers.map((user, index) => ({
        ...user,
        totalEarnings: weiToUSDC(user.totalEarnings), // Convert to USDC
        position: `${index + 1}${
          index + 1 === 1
            ? "st"
            : index + 1 === 2
            ? "nd"
            : index + 1 === 3
            ? "rd"
            : "th"
        }`,
      }));

      // Get Ape's portfolio stats
      const apeStats = await Portfolio.aggregate([
        {
          $match: {
            portfolioName: "MARLOW BANES",
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
                      $multiply: [
                        { $divide: ["$wonGames", "$totalGames"] },
                        100,
                      ],
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

      // Transform ape stats into object by game type
      const apePortfolioStats = {
        name: "Ape Portfolio",
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

      res.json({
        lastGameWinners,
        leaderboard,
        apeStats: apePortfolioStats,
        lastGameIds: lastGames.map((game) => game.gameId),
        lastGameEndTimes: lastGames.map((game) => ({
          gameType: game.gameType,
          endTime: game.endTime,
        })),
        totalCompletedGamesCount,
        upcomingGames,
        communityStats: {
          totalPrizePoolDistributed: totalPrizePoolUSDC,
          avgPerformance: Number(communityAvgPerformance.toFixed(2)),
          avgEarnings: Number(communityAvgEarnings.toFixed(2)),
          totalUsers: totalUsers,
        },
      });
    } catch (error) {
      console.error("Error getting global leaderboard:", error);
      throw error;
    }
  }),

  // Get game leaderboard with pagination and filters
  getLeaderboard: asyncHandler(async (req, res) => {
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
    const ethers = require('ethers');
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
          gameOutcome: portfolioObj.gameOutcome ? {
            ...portfolioObj.gameOutcome,
            reward: weiToUSDC(portfolioObj.gameOutcome.reward),
          } : null,
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
    const game = await Game.findOne({ gameId }).populate(
      "winners.userId",
      "username profileImage"
    );

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const stats = await gameService.getGameStatistics(gameId);
    const apePortfolio = await portfolioService.getPortfolioDetails(
      game.apePortfolio.portfolioId
    );

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

    const comparison = await portfolioService.getPortfolioComparison(
      portfolio.portfolioId
    );
    const history = await portfolioService.getPortfolioHistory(
      portfolio.portfolioId
    );

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
    const comparison = await portfolioService.getPortfolioComparison(
      portfolioId
    );
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

    const history = await portfolioService.getPortfolioHistory(
      portfolioId,
      period
    );
    res.json(history);
  }),

  // Compare portfolio against the Ape
  getPortfolioComparison: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const comparison = await portfolioService.getPortfolioComparison(
      portfolioId
    );
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
    const ethers = require('ethers');
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
    const ethers = require('ethers');
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
