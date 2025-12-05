const { asyncHandler } = require('../middleware/error');
const transactionService = require('../services/transaction.service');
const blockchainService = require('../services/blockchain.service');
const User = require('../models/User');

const transactionController = {
    // Process entry fee payment
    processEntryFee: asyncHandler(async (req, res) => {
        const userId = req.user._id;
        const { gameId } = req.body;

        if (!gameId) {
            return res.status(400).json({ error: 'gameId is required' });
        }

        // Check if user has sufficient USDC allowance
        const user = await User.findById(userId);
        const allowanceCheck = await blockchainService.checkUSDCAllowance(user.address, gameId);

        if (allowanceCheck.needsApproval) {
            const ethers = require('ethers');
            const weiToUSDC = (wei) => parseFloat(ethers.utils.formatUnits(String(wei), 18));

            return res.status(400).json({
                error: 'Insufficient USDC allowance',
                requiredAmount: weiToUSDC(allowanceCheck.requiredAmount),
                currentAllowance: weiToUSDC(allowanceCheck.currentAllowance)
            });
        }

        // Process entry fee
        const transaction = await transactionService.processEntryFee(userId, gameId);

        res.json({
            transaction,
            message: 'Entry fee processed successfully'
        });
    }),

    // Process reward distribution
    processRewardDistribution: asyncHandler(async (req, res) => {
        const { gameId } = req.params;

        // Only admin can trigger reward distribution
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const transactions = await transactionService.processRewardDistribution(gameId);

        res.json({
            transactions,
            message: 'Rewards distributed successfully'
        });
    }),

    // Process withdrawal request
    processWithdrawal: asyncHandler(async (req, res) => {
        const userId = req.user._id;
        const { transactionHash } = req.body;

        if (!transactionHash || !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
            return res.status(400).json({ error: 'Invalid transaction hash format' });
        }

        const transaction = await transactionService.processWithdrawal(userId, transactionHash);

        res.json({
            transaction,
            message: transaction.status === 'PENDING'
                ? 'Withdrawal transaction is being processed'
                : transaction.status === 'COMPLETED'
                    ? 'Withdrawal processed successfully'
                    : 'Withdrawal transaction failed'
        });
    }),

    // Get transaction history
    getTransactionHistory: asyncHandler(async (req, res) => {
        const ethers = require('ethers');
        const userId = req.user._id;
        const {
            page = 1,
            limit = 50,
            type,
            status,
            startDate,
            endDate
        } = req.query;

        const result = await transactionService.getUserTransactions(userId, {
            limit: parseInt(limit),
            offset: (parseInt(page) - 1) * parseInt(limit),
            type,
            status,
            startDate,
            endDate
        });

        // Helper function to convert wei to USDC dollars
        const weiToUSDC = (weiValue) => {
            if (!weiValue) return 0;
            const weiStr = String(weiValue);
            return parseFloat(ethers.utils.formatUnits(weiStr, 18));
        };

        // Convert wei values to USDC in transactions
        const formattedTransactions = result.transactions.map(tx => ({
            ...tx.toObject ? tx.toObject() : tx,
            amount: weiToUSDC(tx.amount),
            networkFee: weiToUSDC(tx.networkFee),
            adminFee: weiToUSDC(tx.adminFee),
            gasPrice: weiToUSDC(tx.gasPrice),
        }));

        res.json({
            transactions: formattedTransactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: result.total,
                pages: Math.ceil(result.total / parseInt(limit)),
                hasMore: result.hasMore
            }
        });
    }),

    // Get transaction details
    getTransactionDetails: asyncHandler(async (req, res) => {
        const { transactionHash } = req.params;
        const userId = req.user._id;

        const details = await transactionService.getTransactionDetails(transactionHash);

        // Ensure user can only access their own transactions
        if (details.userId.toString() !== userId.toString() && !req.user.isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        res.json(details);
    }),

    // Get pending transactions
    getPendingTransactions: asyncHandler(async (req, res) => {
        // Only admin can view all pending transactions
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const transactions = await transactionService.getPendingTransactions();
        res.json(transactions);
    }),

    // Retry failed transaction
    retryTransaction: asyncHandler(async (req, res) => {
        const { transactionHash } = req.params;
        const userId = req.user._id;

        // Get original transaction
        const originalTx = await transactionService.getTransactionDetails(transactionHash);

        // Ensure user can only retry their own transactions
        if (originalTx.userId.toString() !== userId.toString() && !req.user.isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const transaction = await transactionService.retryTransaction(transactionHash);

        res.json({
            transaction,
            message: 'Transaction retried successfully'
        });
    }),

    // Get user balance
    getUserBalance: asyncHandler(async (req, res) => {
        const ethers = require('ethers');
        const userId = req.user._id;
        const { gameId } = req.query;
        const user = await User.findById(userId);

        // Fetch both balances from blockchain (source of truth)
        const [balance, lockedBalanceWei] = await Promise.all([
            blockchainService.getUSDCBalance(user.address),
            blockchainService.getUserLockedBalance(user.address),
        ]);

        // Helper function to convert wei to USDC dollars
        const weiToUSDC = (weiValue) => {
            if (!weiValue) return 0;
            const weiStr = String(weiValue);
            return parseFloat(ethers.utils.formatUnits(weiStr, 18));
        };

        const response = {
            balance: weiToUSDC(balance),
            lockedBalance: weiToUSDC(lockedBalanceWei),
        };

        // Only check allowance if gameId is provided
        if (gameId) {
            const allowance = await blockchainService.checkUSDCAllowance(user.address, gameId);
            response.allowance = weiToUSDC(allowance.currentAllowance);
            response.requiredAllowance = weiToUSDC(allowance.requiredAmount);
            response.needsApproval = allowance.needsApproval;
        }

        res.json(response);
    }),

    // Get transaction statistics
    getTransactionStats: asyncHandler(async (req, res) => {
        const userId = req.user._id;
        const user = await User.findById(userId);

        // Calculate various statistics
        const stats = {
            totalTransactions: await Transaction.countDocuments({ userId }),
            totalVolume: user.totalEarnings,
            successfulTransactions: await Transaction.countDocuments({
                userId,
                status: 'COMPLETED'
            }),
            failedTransactions: await Transaction.countDocuments({
                userId,
                status: 'FAILED'
            }),
            pendingTransactions: await Transaction.countDocuments({
                userId,
                status: 'PENDING'
            }),
            transactionsByType: await Transaction.aggregate([
                { $match: { userId: user._id } },
                { $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    volume: { $sum: '$amount' }
                }}
            ])
        };

        res.json(stats);
    }),

    // Export transaction history
    exportTransactionHistory: asyncHandler(async (req, res) => {
        const userId = req.user._id;
        const { format = 'csv', startDate, endDate } = req.query;

        const transactions = await Transaction.find({
            userId,
            ...(startDate && endDate ? {
                blockTimestamp: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            } : {})
        }).sort({ blockTimestamp: -1 });

        if (format === 'csv') {
            const csv = transactions.map(tx => [
                tx.transactionHash,
                tx.type,
                tx.amount,
                tx.status,
                tx.blockTimestamp,
                tx.fromAddress,
                tx.toAddress,
                tx.networkFee
            ].join(',')).join('\n');

            res.header('Content-Type', 'text/csv');
            res.attachment('transaction-history.csv');
            return res.send(csv);
        }

        res.json(transactions);
    }),

    // Get withdrawal information
    getWithdrawInfo: asyncHandler(async (req, res) => {
        const userId = req.user._id;
        const withdrawInfo = await transactionService.getWithdrawInfo(userId);
        res.json(withdrawInfo);
    })
};

module.exports = transactionController;
