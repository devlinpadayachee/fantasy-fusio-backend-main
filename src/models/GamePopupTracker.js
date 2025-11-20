const mongoose = require('mongoose');

const gamePopupTrackerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  gameId: {
    type: Number,
    required: true
  },
  shown: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index to ensure unique combination of userId and gameId
gamePopupTrackerSchema.index({ userId: 1, gameId: 1 }, { unique: true });

module.exports = mongoose.model('GamePopupTracker', gamePopupTrackerSchema);
