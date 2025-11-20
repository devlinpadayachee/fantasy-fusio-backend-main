const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const config = require('./config');

// Import middleware
const { errorHandler, notFound, validationError } = require('./middleware/error');

// Import services
const blockchainService = require('./services/blockchain.service');

// Import setup functions
const { connectDB } = require('./config/database');
const { setupRoutes } = require('./routes');

// Create Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors(config.cors));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: {
        error: 'Too many requests',
        message: 'Please try again later'
    }
});
app.use(limiter);

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Logging
if (config.nodeEnv !== 'test') {
    app.use(morgan(config.logging.format));
}

// Setup routes
setupRoutes(app);

// Error handling
app.use(validationError);
app.use(notFound);
app.use(errorHandler);

// Connect to MongoDB and start server
connectDB(app, config);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Starting graceful shutdown...');

    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    

    if (blockchainService.web3.currentProvider.connected) {
        await blockchainService.web3.currentProvider.disconnect();
        console.log('Blockchain connection closed');
    }
    
    process.exit(0);
});

module.exports = app;
