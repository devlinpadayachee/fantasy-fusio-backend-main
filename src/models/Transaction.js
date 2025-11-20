const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    transactionHash: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "ENTRY_FEE",
        "ADMIN_FEE",
        "CREATE_PORTFOLIO",
        "GAS_FEE",
        "REWARD",
        "WITHDRAWAL",
        "REFUND",
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    adminFee: {
      type: Number,
      required: false,
    },
    gameId: {
      type: Number,
      required: false,
    },
    portfolioId: {
      type: Number,
      required: false,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
    },
    blockNumber: {
      type: Number,
      required: true,
    },
    blockTimestamp: {
      type: Date,
      required: true,
    },
    fromAddress: {
      type: String,
      required: true,
      lowercase: true,
    },
    toAddress: {
      type: String,
      required: true,
      lowercase: true,
    },
    gasUsed: {
      type: Number,
      required: true,
    },
    gasPrice: {
      type: Number,
      required: true,
    },
    networkFee: {
      type: Number,
      required: true,
    },
    error: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
transactionSchema.index({ transactionHash: 1 });
transactionSchema.index({ userId: 1 });
transactionSchema.index({ gameId: 1 });
transactionSchema.index({ portfolioId: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ blockTimestamp: -1 });
transactionSchema.index({ fromAddress: 1 });
transactionSchema.index({ toAddress: 1 });

// Methods
transactionSchema.methods.complete = async function() {
    this.status = 'COMPLETED';
    return this.save();
};

transactionSchema.methods.fail = async function(error) {
    this.status = 'FAILED';
    this.error = error;
    return this.save();
};

transactionSchema.methods.calculateNetworkFee = function() {
    return this.gasUsed * this.gasPrice;
};

// Statics
transactionSchema.statics.getUserTransactions = function(userId, limit = 50) {
    return this.find({ userId })
        .sort({ blockTimestamp: -1 })
        .limit(limit);
};

transactionSchema.statics.getGameTransactions = function(gameId) {
    return this.find({ gameId })
        .sort({ blockTimestamp: -1 });
};

transactionSchema.statics.getPendingTransactions = function() {
    return this.find({ status: 'PENDING' })
        .sort({ blockTimestamp: 1 });
};

transactionSchema.statics.createEntryFeeTransaction = async function(data) {
    return this.create({
        ...data,
        type: 'ENTRY_FEE',
        networkFee: data.gasUsed * data.gasPrice
    });
};

transactionSchema.statics.createRewardTransaction = async function(data) {
    return this.create({
        ...data,
        type: 'REWARD',
        networkFee: data.gasUsed * data.gasPrice
    });
};

// Virtual fields
transactionSchema.virtual('totalCost').get(function() {
    return this.amount + this.networkFee;
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
