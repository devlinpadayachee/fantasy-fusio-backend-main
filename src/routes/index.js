const mongoose = require('mongoose');
const config = require('../config');

// Import routes
const authRoutes = require('./auth.routes');
const adminRoutes = require('./admin.routes');
const gameRoutes = require('./game.routes');
const gameCronRoutes = require('./game-cron.routes');
const transactionRoutes = require('./transaction.routes');
const assetsRoutes = require('./asset.routes');
const assetAdminRoutes = require('./asset-admin.routes');
const portfolioRoutes = require('./portfolio.routes');
const notificationRoutes = require('./notification.routes');

const setupRoutes = (app) => {
    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/game', gameRoutes);
    app.use('/api/game-cron', gameCronRoutes);
    app.use('/api/transaction', transactionRoutes);
    app.use('/api/assets', assetsRoutes);
    app.use('/api/admin/assets', assetAdminRoutes);
    app.use('/api/portfolio', portfolioRoutes);
    app.use('/api/notifications', notificationRoutes);

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date(),
            environment: config.nodeEnv,
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
        });
    });
};

module.exports = { setupRoutes };
