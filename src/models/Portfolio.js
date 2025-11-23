const mongoose = require("mongoose");

const portfolioSchema = new mongoose.Schema(
  {
    portfolioId: {
      type: Number,
      required: true,
      unique: true,
    },
    portfolioName: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    gameId: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING_LOCK_BALANCE",
        "PENDING",
        "LOCKING",
        "AWAITING DECISION",
        "LOCKED",
        "COMPLETED",
        "FAILED",
        "WON",
        "LOST",
      ],
      default: "PENDING",
    },
    error: {
      type: String,
      default: null,
    },
    gameOutcome: {
      isWinner: {
        type: Boolean,
        default: false,
      },
      reward: {
        type: String,
        default: "0",
      },
      rank: {
        type: Number,
      },
      rewardTransactionHash: String,
      settledAt: Date,
    },
    gameType: {
      type: String,
      enum: ["DEFI", "TRADFI"],
      required: true,
    },
    assets: [
      {
        assetId: {
          type: Number,
          required: true,
        },
        symbol: {
          type: String,
          required: true,
        },
        tokenQty: {
          type: Number,
          required: true,
        },
        allocation: {
          type: Number,
          required: true,
        },
      },
    ],
    initialValue: {
      type: Number,
      required: true,
      default: 100000, // $100,000 initial portfolio value
    },
    currentValue: {
      type: Number,
      required: true,
      default: 100000,
    },
    performancePercentage: {
      type: Number,
      default: 0,
    },
    valueHistory: [
      {
        value: Number,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockedAt: {
      type: Date,
    },
    transactionHash: {
      type: String,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastRetryAt: {
      type: Date,
    },
    retryError: {
      type: String,
    },
    isApe: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
portfolioSchema.index({ portfolioId: 1 });
portfolioSchema.index({ userId: 1 });
portfolioSchema.index({ gameId: 1 });
portfolioSchema.index({ status: 1 });
portfolioSchema.index({ "assets.assetId": 1 });

// Methods
portfolioSchema.methods.calculateValue = async function (prices) {
  let totalValue = 0;
  const Asset = require("./Asset");

  for (const asset of this.assets) {
    let price = prices[asset.assetId];

    // If price is missing, try to get last known price from Asset model
    if (!price || !isFinite(price)) {
      const assetDoc = await Asset.findOne({ assetId: asset.assetId });
      if (assetDoc && assetDoc.currentPrice) {
        price = assetDoc.currentPrice;
        console.warn(`Using last known price for asset ${asset.assetId}: $${price}`);
      } else {
        console.error(`No price available for asset ${asset.assetId} in portfolio ${this.portfolioId}`);
        throw new Error(`No price available for asset ${asset.assetId}`);
      }
    }

    totalValue += price * asset.tokenQty;
  }

  const currentValue = totalValue;
  const performancePercentage = ((totalValue - this.initialValue) / this.initialValue) * 100;

  // Prepare new value history entry
  const newValueEntry = {
    value: currentValue,
    timestamp: new Date(),
  };

  // Use atomic update to avoid version conflicts
  return mongoose.model("Portfolio").findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        currentValue: currentValue,
        performancePercentage: performancePercentage,
      },
      $push: {
        valueHistory: {
          $each: [newValueEntry],
          $slice: -20,
        },
      },
    },
    { new: true }
  );
};

portfolioSchema.methods.lock = function (transactionHash) {
  this.isLocked = true;
  this.lockedAt = new Date();
  this.status = "ACTIVE";
  this.transactionHash = transactionHash;
  return this.save();
};

portfolioSchema.methods.markAsWinner = async function (reward, rank) {
  this.status = "WON";
  this.gameOutcome = {
    isWinner: true,
    reward,
    rank,
    settledAt: new Date(),
  };
  return this.save();
};

portfolioSchema.methods.markAsLoser = async function (rank) {
  this.status = "LOST";
  this.gameOutcome = {
    isWinner: false,
    reward: "0",
    rank,
    settledAt: new Date(),
  };
  return this.save();
};

portfolioSchema.methods.complete = function () {
  if (!this.gameOutcome) {
    this.status = "COMPLETED";
  }
  return this.save();
};

// Static method to get winners for a game
portfolioSchema.statics.getGameWinners = function (gameId) {
  return this.find({
    gameId,
    status: "WON",
  })
    .sort({ "gameOutcome.rank": 1 })
    .populate("userId");
};

// Static method to get all settled portfolios for a game
portfolioSchema.statics.getSettledPortfolios = function (gameId) {
  return this.find({
    gameId,
    status: { $in: ["WON", "LOST"] },
  })
    .sort({ "gameOutcome.rank": 1 })
    .populate("userId");
};

// Statics
portfolioSchema.statics.getActivePortfolios = function (gameId) {
  return this.find({
    gameId,
    status: "ACTIVE",
  }).populate("userId", "username");
};

portfolioSchema.statics.getUserPortfolios = function (userId, gameType) {
  const query = { userId };
  if (gameType) {
    query.gameType = gameType;
  }
  return this.find(query).sort({ createdAt: -1 });
};

portfolioSchema.statics.getPortfoliosByGameType = function (gameType, status, userId) {
  const query = { gameType };
  if (status) {
    query.status = status;
  }
  return this.find(query).populate("userId", "username profileImage").sort({ performancePercentage: -1 }).exec();
};

portfolioSchema.statics.getPortfolioRank = async function (portfolioId, gameType) {
  const portfolio = await this.findById(portfolioId);
  if (!portfolio) return null;

  const betterPerformers = await this.countDocuments({
    gameType,
    status: "LOCKED",
    performancePercentage: { $gt: portfolio.performancePercentage },
  });

  return betterPerformers + 1;
};

const Portfolio = mongoose.model("Portfolio", portfolioSchema);

module.exports = Portfolio;
