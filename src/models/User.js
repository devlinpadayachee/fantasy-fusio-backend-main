const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      maxLength: 50,
    },
    profileImage: {
      type: String,
      default: null,
    },
    totalGamesPlayed: {
      type: Number,
      default: 0,
    },
    gamesWon: {
      type: Number,
      default: 0,
    },
    uniqueGamesWon: {
      type: Number,
      default: 0,
    },
    totalPortfoliosCreated: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: String,
      default: "0",
    },
    // NOTE: currentBalance and lockedBalance have been REMOVED from the schema
    // These values are now always fetched from the blockchain (source of truth)
    // Use blockchainService.getUserBalances() for withdrawable balance
    // Use blockchainService.getUserLockedBalance() for locked/in-play balance
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ address: 1 }, { unique: true, background: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true, background: true });
userSchema.index({ totalEarnings: -1 }, { background: true });

// Methods
userSchema.methods.generateNonce = function () {
  this.nonce = Math.floor(Math.random() * 1000000).toString();
  return this.save();
};

userSchema.methods.updateGameStats = async function (gameId, portfolioId, performance, earnings, rank) {
  try {
    const Portfolio = require("./Portfolio");

    // Ensure earnings is valid (should be wei string)
    const parsedEarnings = BigInt(earnings || "0");

    // Update statistics
    this.totalPortfoliosCreated = (this.totalPortfoliosCreated || 0) + 1;

    // Check if user already has a portfolio for this gameId (excluding current one)
    // This tells us if it's a new unique game for this user
    const existingPortfolio = await Portfolio.exists({
      userId: this._id,
      gameId: Number(gameId),
      portfolioId: { $ne: Number(portfolioId) },
    });

    // Only increment totalGamesPlayed if it's a new unique game for this user
    if (!existingPortfolio) {
      this.totalGamesPlayed = (this.totalGamesPlayed || 0) + 1;
    }

    // Handle winning portfolios
    if (parsedEarnings > 0n) {
      this.gamesWon += 1;
      const totalEarnings = BigInt(this.totalEarnings || "0");
      this.totalEarnings = (totalEarnings + parsedEarnings).toString();

      // Check if user already won this game before (different portfolio)
      const alreadyWonGame = await Portfolio.exists({
        userId: this._id,
        gameId: Number(gameId),
        portfolioId: { $ne: Number(portfolioId) },
        status: "WON",
      });

      // If this is the first win for this game, increment unique games won
      if (!alreadyWonGame) {
        this.uniqueGamesWon = (this.uniqueGamesWon || 0) + 1;
      }
    }

    return this.save();
  } catch (error) {
    console.error("Error updating game stats:", error);
    throw error;
  }
};

// REMOVED: updateBalance, lockBalance, unlockBalance methods
// These are no longer used - balances are now always pulled from the blockchain (source of truth)
// See blockchainService.getUserBalances() and blockchainService.getUserLockedBalance()

userSchema.methods.getGameHistory = async function (options = {}) {
  const Portfolio = require("./Portfolio");
  const { limit = 50, page = 1, gameType, status } = options;

  const query = { userId: this._id };
  if (gameType) {
    query.gameType = gameType.toUpperCase();
  }
  if (status) {
    query.status = status;
  }

  const portfolios = await Portfolio.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const total = await Portfolio.countDocuments(query);

  return {
    history: portfolios.map((p) => ({
      gameId: p.gameId,
      portfolioId: p.portfolioId,
      portfolioName: p.portfolioName,
      gameType: p.gameType,
      performance: p.performancePercentage,
      earnings: p.gameOutcome?.reward || "0",
      rank: p.gameOutcome?.rank,
      status: p.status,
      timestamp: p.createdAt,
    })),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// Statics
userSchema.statics.findByAddress = function (address) {
  return this.findOne({ address: address.toLowerCase() });
};

userSchema.statics.getTopPlayers = function (limit = 10) {
  return this.find({ totalGamesPlayed: { $gt: 0 } })
    .sort({ totalEarnings: -1 })
    .limit(limit)
    .select("username totalGamesPlayed gamesWon totalEarnings");
};

// Middleware
userSchema.pre("save", async function (next) {
  if (this.isModified("username")) {
    // Convert username to lowercase for case-insensitive comparison
    this.username = this.username.toLowerCase();
  }
  if (this.isModified("address")) {
    // Convert address to lowercase for case-insensitive comparison
    this.address = this.address.toLowerCase();
  }
  next();
});

const User = mongoose.model("User", userSchema);

module.exports = User;
