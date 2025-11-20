const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
    assetId: {
        type: Number,
        required: true,
        unique: true
    },
    symbol: {
        type: String,
        required: true,
        unique: true
    },
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['DEFI', 'TRADFI'],
        required: true
    },
    currentPrice: {
        type: Number,
        required: true,
        default: 0
    },
    priceHistory: [{
        price: Number,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    change24h: {
        type: Number,
        default: 0
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    imageUrl: { // Add this line
        type: String,
        required: false
    },
    exchange: {
        type: String,
        required: false
    },
    assetType: {
        type: String,
        required: false
    },
    ape: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

const Asset = mongoose.model('Asset', assetSchema);

module.exports = Asset;
