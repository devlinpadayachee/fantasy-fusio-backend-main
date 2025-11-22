const mongoose = require("mongoose");

const gameSchema = new mongoose.Schema(
  {
    gameId: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      default: "Game",
    },
    transactionHash: {
      type: String,
    },
    gameType: {
      type: String,
      enum: ["DEFI", "TRADFI"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "TRX-PENDING",
        "UPCOMING",
        "PENDING",
        "ACTIVE",
        "CALCULATING_WINNERS",
        "UPDATE_VALUES",
        "DISTRIBUTING_REWARDS",
        "COMPLETED",
        "FAILED",
      ],
      default: "TRX-PENDING",
    },
    hasCalculatedWinners: {
      type: Boolean,
      default: false,
    },
    isFullyDistributed: {
      type: Boolean,
      default: false,
    },
    lastProcessedWinnerIndex: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    totalPrizePool: {
      type: String,
      default: "0",
    },
    participantCount: {
      type: Number,
      default: 0,
    },
    entryCap: {
      type: Number,
      default: 0,
    },
    apePortfolio: {
      portfolioId: {
        type: Number,
        required: false,
      },
    },
    gameCronId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GameCron",
      required: false,
      index: true,
    },
    winCondition: {
      type: {
        type: String,
        enum: ["MARLOWE_BAINES", "EQUAL_DISTRIBUTE", "TIERED"],
        required: true,
      },
      config: {
        type: mongoose.Schema.Types.Mixed,
        required: function () {
          return this.winCondition.type !== "MARLOWE_BAINES";
        },
      },
    },
    entryPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    winners: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        portfolioId: Number,
        reward: String, // Wei amount - must be String for precision
        performancePercentage: Number,
        isRewardDistributed: {
          type: Boolean,
          default: false,
        },
        distributionTransactionHash: String,
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
gameSchema.index({ gameId: 1 });
gameSchema.index({ status: 1 });
gameSchema.index({ gameType: 1 });

// Methods
gameSchema.methods.updatePrizePool = function (amount) {
  const currentPool = BigInt(this.totalPrizePool || "0");
  const addAmount = BigInt(amount);
  this.totalPrizePool = (currentPool + addAmount).toString();
  return this.save();
};

gameSchema.methods.incrementParticipants = function () {
  this.participantCount += 1;
  return this.save();
};

gameSchema.methods.updateApePortfolio = function (currentValue) {
  this.apePortfolio.currentValue = currentValue;
  this.apePortfolio.performancePercentage =
    ((currentValue - this.apePortfolio.initialValue) / this.apePortfolio.initialValue) * 100;
  return this.save();
};

gameSchema.methods.addWinner = function (userId, portfolioId, reward, performancePercentage) {
  this.winners.push({
    userId,
    portfolioId,
    reward,
    performancePercentage,
  });
  return this.save();
};

// Statics
gameSchema.statics.getCurrentGame = function (gameType) {
  return this.findOne({
    gameType,
    status: {
      $in: ["ACTIVE", "CALCULATING_WINNERS"],
    },
  });
};

gameSchema.statics.getGamesNeedingWinnerCalculation = function () {
  return this.find({
    status: "ACTIVE",
    endTime: { $lte: new Date() },
    hasCalculatedWinners: false,
  });
};

gameSchema.statics.getGamesNeedingRewardDistribution = function () {
  return this.find({
    status: "CALCULATING_WINNERS",
    hasCalculatedWinners: true,
    isFullyDistributed: false,
  });
};

gameSchema.methods.markWinnerCalculated = async function () {
  this.hasCalculatedWinners = true;
  this.status = "CALCULATING_WINNERS";
  return this.save();
};

gameSchema.methods.markWinnerRewardDistributed = async function (winnerId, transactionHash) {
  const winner = this.winners.id(winnerId);
  if (winner) {
    winner.isRewardDistributed = true;
    winner.distributionTransactionHash = transactionHash;
  }
  return this.save();
};

gameSchema.methods.markFullyDistributed = async function () {
  this.isFullyDistributed = true;
  this.status = "DISTRIBUTING_REWARDS";
  return this.save();
};

gameSchema.statics.getPendingGame = function (gameType) {
  return this.findOne({
    gameType,
    status: "PENDING",
  });
};

gameSchema.statics.getNotCompletedGame = function (gameType) {
  return this.findOne({
    gameType,
    status: {
      $in: ["PENDING", "ACTIVE", "CALCULATING_WINNERS", "UPDATE_VALUES", "DISTRIBUTING_REWARDS"],
    },
  });
};

const Game = mongoose.model("Game", gameSchema);

module.exports = Game;
