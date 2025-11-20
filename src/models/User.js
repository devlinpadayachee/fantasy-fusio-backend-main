const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    address: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    nonce: {
        type: String,
        required: true
    },
    username: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
        maxLength: 50
    },
    profileImage: {
        type: String,
        default: null
    },
    totalGamesPlayed: {
        type: Number,
        default: 0
    },
    gamesWon: {
        type: Number,
        default: 0
    },
    totalEarnings: {
        type: Number,
        default: 0
    },
    currentBalance: {
        type: Number,
        default: 0
    },
    lockedBalance: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    gameHistory: [{
        gameId: Number,
        portfolioId: Number,
        performance: Number,
        earnings: Number,
        rank: Number,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Indexes
userSchema.index({ address: 1 }, { unique: true, background: true });
userSchema.index({ username: 1 }, { unique: true, sparse: true, background: true });
userSchema.index({ totalEarnings: -1 }, { background: true });

// Methods
userSchema.methods.generateNonce = function() {
    this.nonce = Math.floor(Math.random() * 1000000).toString();
    return this.save();
};

userSchema.methods.updateGameStats = async function(gameId, portfolioId, performance, earnings, rank) {
    try {
        // Ensure earnings is a valid number
        const parsedEarnings = parseFloat(earnings);
        if (isNaN(parsedEarnings)) {
            console.error('Invalid earnings value:', earnings);
            throw new Error('Invalid earnings value');
        }

        // Update game history
        this.gameHistory.push({
            gameId: Number(gameId),
            portfolioId: Number(portfolioId),
            performance: parseFloat(performance),
            earnings: parsedEarnings,
            rank: Number(rank),
            timestamp: new Date()
        });

        // Update statistics
        this.totalGamesPlayed += 1;
        if (parsedEarnings > 0) {
            this.gamesWon += 1;
            this.totalEarnings = (this.totalEarnings || 0) + parsedEarnings;
        }
        return this.save();
    } catch (error) {
        console.error('Error updating game stats:', error);
        throw error;
    }
};

userSchema.methods.updateBalance = function(amount) {
    try {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            throw new Error('Invalid amount value');
        }
        this.currentBalance = (this.currentBalance || 0) + parsedAmount;
        return this.save();
    } catch (error) {
        console.error('Error updating balance:', error);
        throw error;
    }
};

userSchema.methods.lockBalance = function(amount) {
    try {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            throw new Error('Invalid amount value');
        }
        if (this.currentBalance >= parsedAmount) {
            this.currentBalance = (this.currentBalance || 0) - parsedAmount;
            this.lockedBalance = (this.lockedBalance || 0) + parsedAmount;
            return this.save();
        }
        throw new Error('Insufficient balance');
    } catch (error) {
        console.error('Error locking balance:', error);
        throw error;
    }
};

userSchema.methods.unlockBalance = function(amount) {
    try {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            throw new Error('Invalid amount value');
        }
        if (this.lockedBalance >= parsedAmount) {
            this.lockedBalance = (this.lockedBalance || 0) - parsedAmount;
            this.currentBalance = (this.currentBalance || 0) + parsedAmount;
            return this.save();
        }
        throw new Error('Insufficient locked balance');
    } catch (error) {
        console.error('Error unlocking balance:', error);
        throw error;
    }
};

// Statics
userSchema.statics.findByAddress = function(address) {
    return this.findOne({ address: address.toLowerCase() });
};

userSchema.statics.getTopPlayers = function(limit = 10) {
    return this.find({ totalGamesPlayed: { $gt: 0 } })
        .sort({ totalEarnings: -1 })
        .limit(limit)
        .select('username totalGamesPlayed gamesWon totalEarnings');
};

// Middleware
userSchema.pre('save', async function(next) {
    if (this.isModified('username')) {
        // Convert username to lowercase for case-insensitive comparison
        this.username = this.username.toLowerCase();
    }
    if (this.isModified('address')) {
        // Convert address to lowercase for case-insensitive comparison
        this.address = this.address.toLowerCase();
    }
    next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;
