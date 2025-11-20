const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['BALANCE_LOCKED','TRANSACTION_FAILED','PORTFOLIO_CREATED', 'PORTFOLIO_WON', 'PORTFOLIO_LOST']
  },
  message: {
    type: String,
    required: true
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  shown: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: Object,
    default: {}
  }
});

module.exports = mongoose.model('Notification', notificationSchema);
