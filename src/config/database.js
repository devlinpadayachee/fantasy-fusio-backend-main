const mongoose = require('mongoose');
const { initializeCronJobs } = require('../cron');

const connectDB = async (app, config) => {
    try {
        if (!config.mongodb.uri) {
            throw new Error('MONGODB_URI environment variable is not set. Please configure it in your environment variables.');
        }

        // Validate MongoDB URI format
        if (!config.mongodb.uri.startsWith('mongodb://') && !config.mongodb.uri.startsWith('mongodb+srv://')) {
            throw new Error('Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://');
        }

        await mongoose.connect(config.mongodb.uri, config.mongodb.options);
        console.log('Connected to MongoDB');

        // Initialize cron jobs after database connection
        initializeCronJobs();

        // Start server
        app.listen(config.port, () => {
            console.log(`Server running on port ${config.port}`);
            console.log(`Environment: ${config.nodeEnv}`);
            console.log('Cron Jobs Initialized:');
        });
    } catch (error) {
        console.error('MongoDB connection error:', error.message || error);
        if (error.message && error.message.includes('authentication failed')) {
            console.error('\n⚠️  MongoDB Authentication Failed!');
            console.error('Please check:');
            console.error('1. MONGODB_URI is set correctly in your environment variables');
            console.error('2. Username and password in the connection string are correct');
            console.error('3. Database user has proper permissions');
            console.error('4. IP whitelist includes Render\'s IP addresses (or 0.0.0.0/0 for MongoDB Atlas)');
        }
        process.exit(1);
    }
};

module.exports = { connectDB };
