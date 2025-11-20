const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transaction.controller');
const { authenticate, isAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// User transaction routes
router.post('/entry-fee', transactionController.processEntryFee);
router.post('/withdraw', transactionController.processWithdrawal);
router.get('/withdraw-info', transactionController.getWithdrawInfo);
router.get('/history', transactionController.getTransactionHistory);
router.get('/balance', transactionController.getUserBalance);
router.get('/stats', transactionController.getTransactionStats);
router.get('/export', transactionController.exportTransactionHistory);
router.get('/:transactionHash', transactionController.getTransactionDetails);
router.post('/:transactionHash/retry', transactionController.retryTransaction);

// Admin only routes
router.use(isAdmin);
router.post('/game/:gameId/distribute-rewards', transactionController.processRewardDistribution);
router.get('/pending', transactionController.getPendingTransactions);

module.exports = router;
