const mongoose = require('mongoose');
const cron = require('node-cron');

// Win condition schemas
const marloweWinConditionSchema = new mongoose.Schema({
    // No additional config needed for Marlowe Baines
}, { _id: false });

const equalDistributeWinConditionSchema = new mongoose.Schema({
    topWinnersPercentage: {
        type: Number,
        required: true,
        min: 1,
        validate: {
            validator: Number.isInteger,
            message: 'Top winners must be an integer'
        }
    },
    rewardPercentage: {
        type: Number,
        required: true,
        min: 0.01,
        max: 100,
        validate: {
            validator: function(v) {
                return Number(v.toFixed(2)) === v;
            },
            message: 'Reward percentage can have up to 2 decimal places'
        }
    }
}, { _id: false });

const tieredRewardsSchema = new mongoose.Schema({
    tiers: [{
        position: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: 'Position must be an integer'
            }
        },
            rewardPercentage: {
                type: Number,
                required: true,
                min: 0,
                max: 100,
                validate: {
                    validator: function(v) {
                        return Number(v.toFixed(2)) === v;
                    },
                    message: 'Reward percentage can have up to 2 decimal places'
                }
            }
    }]
}, { _id: false });

const gameCronSchema = new mongoose.Schema(
  {
    gameType: {
      type: String,
      enum: ["DEFI", "TRADFI"],
      required: true,
    },
    customGameName: {
      type: String,
      required: false,
      trim: true,
      maxlength: 100,
    },
    cronType: {
      type: String,
      enum: ["ONCE", "RECURRING"],
      required: true,
    },
    entryPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    creationTime: {
      type: Date,
      required: true,
    },
    startTime: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Start time must be an integer.",
      },
    },
    gameDuration: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Game duration must be an integer",
      },
    },
    entryCap: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "Entry cap must be an integer",
      },
    },
    recurringSchedule: {
      type: Number,
      required: function () {
        return this.cronType === "RECURRING";
      },
      min: 1,
      validate: {
        validator: function (value) {
          if (this.cronType === "RECURRING") {
            return Number.isInteger(value) && value > 0;
          }
          return true;
        },
        message: "Recurring schedule must be a positive integer",
      },
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
        validate: {
          validator: function (config) {
            switch (this.winCondition.type) {
              case "MARLOWE_BAINES":
                return Object.keys(config).length === 0;
              case "EQUAL_DISTRIBUTE":
                return (
                  config.topWinnersPercentage &&
                  config.rewardPercentage &&
                  config.topWinnersPercentage > 0 &&
                  config.rewardPercentage > 0 &&
                  config.rewardPercentage <= 100
                );
              case "TIERED":
                return (
                  Array.isArray(config.tiers) &&
                  config.tiers.length > 0 &&
                  config.tiers.every(
                    (tier) =>
                      tier.position > 0 &&
                      tier.rewardPercentage >= 0 &&
                      tier.rewardPercentage <= 100
                  ) &&
                  // Ensure total reward percentage doesn't exceed 100%
                  config.tiers.reduce(
                    (sum, tier) => sum + tier.rewardPercentage,
                    0
                  ) <= 100
                );
              default:
                return false;
            }
          },
          message: "Invalid win condition configuration",
        },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastExecuted: {
      type: Date,
    },
    nextExecution: {
      type: Date,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
gameCronSchema.index({ gameType: 1, isActive: 1 });
gameCronSchema.index({ cronType: 1, nextExecution: 1 });


// Soft delete method
gameCronSchema.methods.softDelete = function() {
    this.deletedAt = new Date();
    this.isActive = false;
    return this.save();
};

// Restore method
gameCronSchema.methods.restore = function() {
    this.deletedAt = null;
    this.isActive = true;
    return this.save();
};


gameCronSchema.methods.updateNextExecution = function() {
    if (this.cronType === 'ONCE') {
        // For one-time games, nextExecution is based on creationTime + startTime
        const executionDate = new Date(this.creationTime);
        executionDate.setHours(this.startTime, 0, 0, 0);
        this.nextExecution = executionDate;
    } else {
        // For recurring games, nextExecution = creationTime + recurringSchedule (hours)
        const nextDate = new Date(this.creationTime);
        nextDate.setHours(nextDate.getHours() + this.recurringSchedule);
        this.nextExecution = nextDate;
    }
    return this;
};

// Pre-save middleware
gameCronSchema.pre('save', function(next) {
    if (this.isNew || this.isModified('startTime') || this.isModified('recurringSchedule')) {
        // Update next execution time
        if (!this.nextExecution) {
            this.updateNextExecution();
        }
    }
    next();
});

// Query middleware for soft delete
gameCronSchema.pre(/^find/, function() {
  // this.where({ deletedAt: null });
});

// Static method to get active cron jobs
gameCronSchema.statics.getActiveCronJobs = function() {
    return this.find({ isActive: true, deletedAt: null });
};

// Static method to get due cron jobs
gameCronSchema.statics.getDueCronJobs = function() {
    return this.find({
        isActive: true,
        deletedAt: null,
        nextExecution: { $lte: new Date() }
    });
};

// Static method to find with deleted records
gameCronSchema.statics.findWithDeleted = function(filter = {}) {
    return this.find(filter).where({});
};

// Static method to find only deleted records
gameCronSchema.statics.findDeleted = function(filter = {}) {
    return this.find({ ...filter, deletedAt: { $ne: null } });
};

const GameCron = mongoose.model('GameCron', gameCronSchema);

module.exports = GameCron;
