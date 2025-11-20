const mongoose = require('mongoose');
const { initializeCronJobs } = require('../cron');

const connectDB = async (app, config) => {
    try {
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
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

module.exports = { connectDB };
