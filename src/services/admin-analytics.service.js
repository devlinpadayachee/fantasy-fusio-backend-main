const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Portfolio = require('../models/Portfolio');
const Game = require('../models/Game');
const mongoose = require('mongoose');

class AdminAnalyticsService {
    // Helper to get date range based on filter
    getDateRange(filter) {
        const now = new Date();
        let startDate;

        switch (filter) {
            case 'monthly':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'yearly':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            case 'weekly':
            default:
                // Last 7 days
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                break;
        }
        return { startDate, endDate: now };
    }

    async getAnalytics(filter = 'weekly') {
        const { startDate, endDate } = this.getDateRange(filter);

        const revenueResult = await Transaction.aggregate([
          {
            $match: {
              type: "ENTRY_FEE",
              status: "COMPLETED",
              blockTimestamp: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: "$amount" },
            },
          },
        ]);

        const revenueGenerated =
          revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        // Transaction fees collected: sum of adminFee in metadata of completed transactions
        const feesResult = await Transaction.aggregate([
          {
            $match: {
              type: "ENTRY_FEE",
              status: "COMPLETED",
              blockTimestamp: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              totalFees: { $sum: "$adminFee" },
            },
          },
        ]);

        const transactionFeesCollected =
          feesResult.length > 0 ? feesResult[0].totalFees : 0;

        // Average investment per user: average of (portfolio count * 5) per user
        const investmentResult = await Portfolio.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              portfolioName: { $ne: "MARLOWE BAINE" },
            },
          },
          {
            $group: {
              _id: "$userId",
              portfolioCount: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: null,
              avgInvestment: { $avg: { $multiply: ["$portfolioCount", 5] } },
            },
          },
        ]);

        const averageInvestmentPerUser =
          investmentResult.length > 0 ? investmentResult[0].avgInvestment : 0;

        // Player participation per game: calculate as (total portfolios / total games) / total users in the period
        const totalPortfoliosCount = await Portfolio.countDocuments({
          status: { $ne: "PENDING_LOCK_BALANCE" },
          createdAt: { $gte: startDate, $lte: endDate },
        });

        const totalGamesCount = await Game.countDocuments({
            startTime: { $gte: startDate, $lte: endDate }
        });

        const totalUsersCount = await User.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate }
        });

        const playerParticipationPerGame = totalGamesCount > 0 && totalUsersCount > 0
            ? (totalPortfoliosCount / totalGamesCount) / totalUsersCount
            : 0;

        // New Users: count of users created in the period
        const newUsersCount = await User.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate }
        });

        // Wallet connects: count of users with lastLogin in the period (approximation)
        const walletConnectsCount = await User.countDocuments({
            lastLogin: { $gte: startDate, $lte: endDate }
        });

        // Games played: count of games started or completed in the period
        const gamesPlayedCount = await Game.countDocuments({
          createdAt: { $gte: startDate, $lte: endDate },
        });

        // Portfolio creations: count of portfolios created in the period
        const portfolioCreationsCount = await Portfolio.countDocuments({
            createdAt: { $gte: startDate, $lte: endDate }
        });

        return {
            revenueGenerated,
            transactionFeesCollected,
            averageInvestmentPerUser,
            playerParticipationPerGame,
            newUsers: newUsersCount,
            walletConnects: walletConnectsCount,
            gamesPlayed: gamesPlayedCount,
            portfolioCreations: portfolioCreationsCount
        };
    }
}

module.exports = new AdminAnalyticsService();
