const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Portfolio = require("../models/Portfolio");
const Game = require("../models/Game");
const mongoose = require("mongoose");

class AdminAnalyticsService {
  // Helper to get date range based on filter
  getDateRange(filter) {
    const now = new Date();
    let startDate;

    switch (filter) {
      case "monthly":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "weekly":
      default:
        // Last 7 days
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
    }
    return { startDate, endDate: now };
  }

  async getAnalytics(filter = "weekly") {
    const { startDate, endDate } = this.getDateRange(filter);

    // Revenue generated: sum of entry fees, converting from wei (18 decimals) to USDC
    // Amounts are stored as strings representing wei values (e.g., "5000000000000000000" = 5 USDC)
    const revenueTransactions = await Transaction.find({
      type: "ENTRY_FEE",
      status: "COMPLETED",
      blockTimestamp: { $gte: startDate, $lte: endDate },
    })
      .select("amount adminFee userId")
      .lean();

    let totalRevenueUSDC = 0;
    let totalFeesUSDC = 0;
    const userInvestments = new Map();

    for (const tx of revenueTransactions) {
      // Convert amount from wei string to USDC number
      // We divide by 1e18 using string math to avoid precision loss
      if (tx.amount) {
        const amountStr = String(tx.amount);
        // Divide the string by 1e18 to get USDC
        const amountUSDC = parseFloat(amountStr) / 1e18;
        if (isFinite(amountUSDC) && amountUSDC > 0) {
          totalRevenueUSDC += amountUSDC;

          // Track per-user investment
          if (tx.userId) {
            const userId = tx.userId.toString();
            userInvestments.set(userId, (userInvestments.get(userId) || 0) + amountUSDC);
          }
        }
      }

      // Convert admin fee from wei string to USDC number
      if (tx.adminFee) {
        const feeStr = String(tx.adminFee);
        const feeUSDC = parseFloat(feeStr) / 1e18;
        if (isFinite(feeUSDC) && feeUSDC > 0) {
          totalFeesUSDC += feeUSDC;
        }
      }
    }

    const revenueGenerated = totalRevenueUSDC;
    const transactionFeesCollected = totalFeesUSDC;

    // Calculate average investment per user (already in USDC)
    let totalInvestmentUSDC = 0;
    let userCount = 0;
    for (const investment of userInvestments.values()) {
      totalInvestmentUSDC += investment;
      userCount++;
    }
    const averageInvestmentPerUser = userCount > 0 ? totalInvestmentUSDC / userCount : 0;

    // Average participants per game: Get actual participant counts from games
    const gamesWithParticipants = await Game.find({
      startTime: { $gte: startDate, $lte: endDate },
    })
      .select("participantCount")
      .lean();

    let totalParticipants = 0;
    let gamesCount = 0;

    for (const game of gamesWithParticipants) {
      if (game.participantCount && game.participantCount > 0) {
        totalParticipants += game.participantCount;
        gamesCount++;
      }
    }

    const playerParticipationPerGame = gamesCount > 0 ? totalParticipants / gamesCount : 0;

    // New Users: count of users created in the period
    const newUsersCount = await User.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    // Returning Users: users who logged in during the period but were created before it
    // Include users where lastLogin exists (not null/undefined)
    const returningUsersCount = await User.countDocuments({
      lastLogin: { $gte: startDate, $lte: endDate, $ne: null, $exists: true },
      createdAt: { $lt: startDate },
    });

    // Calculate retention rate: Of all users who existed before this period, what % came back?
    const existingUsersCount = await User.countDocuments({
      createdAt: { $lt: startDate },
    });

    const retentionRate = existingUsersCount > 0 ? (returningUsersCount / existingUsersCount) * 100 : 0;

    // Wallet connects: count of users with lastLogin in the period
    // Include users where lastLogin exists (not null/undefined)
    const walletConnectsCount = await User.countDocuments({
      lastLogin: { $gte: startDate, $lte: endDate, $ne: null, $exists: true },
    });

    // Debug logging to help diagnose the issue
    console.log("Analytics Debug:", {
      filter,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      newUsersCount,
      returningUsersCount,
      existingUsersCount,
      walletConnectsCount,
    });

    // Games played: count of games started or completed in the period
    const gamesPlayedCount = await Game.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    // Portfolio creations: count of portfolios created in the period
    const portfolioCreationsCount = await Portfolio.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
    });

    return {
      revenueGenerated: isFinite(revenueGenerated) ? Number(revenueGenerated.toFixed(2)) : 0,
      transactionFeesCollected: isFinite(transactionFeesCollected) ? Number(transactionFeesCollected.toFixed(2)) : 0,
      averageInvestmentPerUser: isFinite(averageInvestmentPerUser) ? Number(averageInvestmentPerUser.toFixed(2)) : 0,
      playerParticipationPerGame: isFinite(playerParticipationPerGame)
        ? Number(playerParticipationPerGame.toFixed(1))
        : 0,
      newUsers: newUsersCount || 0,
      returningUsers: returningUsersCount || 0,
      retention: isFinite(retentionRate) ? Number(retentionRate.toFixed(1)) : 0,
      walletConnects: walletConnectsCount || 0,
      gamesPlayed: gamesPlayedCount || 0,
      portfolioCreations: portfolioCreationsCount || 0,
    };
  }
}

module.exports = new AdminAnalyticsService();
