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
    currentBalance: {
      type: String,
      default: "0",
    },
    lockedBalance: {
      type: String,
      default: "0",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
    gameHistory: [
      {
        gameId: Number,
        portfolioId: Number,
        performance: Number,
        earnings: Number,
        rank: Number,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
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
    // Ensure earnings is a valid number
    const parsedEarnings = parseFloat(earnings);
    if (isNaN(parsedEarnings)) {
      console.error("Invalid earnings value:", earnings);
      throw new Error("Invalid earnings value");
    }

    // Update game history
    this.gameHistory.push({
      gameId: Number(gameId),
      portfolioId: Number(portfolioId),
      performance: parseFloat(performance),
      earnings: parsedEarnings,
      rank: Number(rank),
      timestamp: new Date(),
    });

    // Update statistics
    // Note: totalGamesPlayed in legacy was used as "portfolios played", but user requested tracking games vs portfolios separately.
    // To maintain backward compatibility but support new stats:
    // We will track unique games played separately if needed, but for now let's ensure we have totalPortfoliosCreated

    this.totalPortfoliosCreated = (this.totalPortfoliosCreated || 0) + 1;

    // If this is the first portfolio for this gameId, increment totalGamesPlayed
    // Check if user already has an entry for this gameId in gameHistory (excluding the one we just added)
    const existingEntry = this.gameHistory.find(
      (entry) => entry.gameId === Number(gameId) && entry.portfolioId !== Number(portfolioId)
    );

    // Only increment totalGamesPlayed if it's a new game for this user
    if (!existingEntry) {
      // We need to be careful here. Previous logic (fixUserStats) calculated totalGamesPlayed as total entries.
      // If we change the definition now, existing data will be mixed.
      // The user said: "This si not the gamess participated in as we already know that its their total games but we want to see that if they create 1000 portoflios and the never win then they suck"
      // So "Total Games Played" should likely remain "Unique Games Participated In".
      // And "Total Portfolios Created" is the new metric.

      // My previous fixUserStats script calculated totalGamesPlayed as unique games? No, I changed it to count every portfolio as a "game played" in the last step of previous turn.
      // "totalGamesPlayed++;" inside the portfolio loop.

      // So currently in DB, totalGamesPlayed = totalPortfoliosCreated.

      // To fix this, I should:
      // 1. Introduce `totalPortfoliosCreated` (done)
      // 2. Update `totalGamesPlayed` to mean UNIQUE games played.
      // 3. Backfill both correctly.

      this.totalGamesPlayed = (this.totalGamesPlayed || 0) + 1;
    }

    if (parsedEarnings > 0) {
      this.gamesWon += 1;
      const totalEarnings = BigInt(this.totalEarnings || "0");
      // parsedEarnings is already in wei (string), not dollars
      const earningsToAdd = BigInt(parsedEarnings);
      this.totalEarnings = (totalEarnings + earningsToAdd).toString();

      // Check if this is a new unique game win
      // Look for other winning entries for this same gameId
      const alreadyWonGame = this.gameHistory.some(
        (entry) => entry.gameId === Number(gameId) && entry.portfolioId !== Number(portfolioId) && entry.earnings > 0
      );

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

userSchema.methods.updateBalance = function (amount) {
  try {
    const currentBalance = BigInt(this.currentBalance || "0");
    const addAmount = BigInt(amount);
    this.currentBalance = (currentBalance + addAmount).toString();
    return this.save();
  } catch (error) {
    console.error("Error updating balance:", error);
    throw error;
  }
};

userSchema.methods.lockBalance = function (amount) {
  try {
    const currentBalance = BigInt(this.currentBalance || "0");
    const lockAmount = BigInt(amount);
    const lockedBalance = BigInt(this.lockedBalance || "0");

    if (currentBalance >= lockAmount) {
      this.currentBalance = (currentBalance - lockAmount).toString();
      this.lockedBalance = (lockedBalance + lockAmount).toString();
      return this.save();
    }
    throw new Error("Insufficient balance");
  } catch (error) {
    console.error("Error locking balance:", error);
    throw error;
  }
};

userSchema.methods.unlockBalance = function (amount) {
  try {
    const lockedBalance = BigInt(this.lockedBalance || "0");
    const unlockAmount = BigInt(amount);
    const currentBalance = BigInt(this.currentBalance || "0");

    if (lockedBalance >= unlockAmount) {
      this.lockedBalance = (lockedBalance - unlockAmount).toString();
      this.currentBalance = (currentBalance + unlockAmount).toString();
      return this.save();
    }
    throw new Error("Insufficient locked balance");
  } catch (error) {
    console.error("Error unlocking balance:", error);
    throw error;
  }
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
