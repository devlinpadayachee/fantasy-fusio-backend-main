const mongoose = require('mongoose');
const config = require('../config');

async function fixIndexes() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ape-game');
        
        // Get the User collection
        const User = mongoose.connection.collection('users');
        
        console.log('Current indexes:');
        const indexes = await User.indexes();
        console.log(indexes);

        // Drop the problematic index if it exists
        console.log('Dropping walletAddress index...');
        try {
            await User.dropIndex('walletAddress_1');
            console.log('Successfully dropped walletAddress index');
        } catch (error) {
            if (error.code !== 27) { // 27 is the error code for index not found
                throw error;
            }
            console.log('walletAddress index not found');
        }

        // Create the correct index
        console.log('Creating address index...');
        await User.createIndex({ address: 1 }, { unique: true });
        console.log('Successfully created address index');

        console.log('Updated indexes:');
        const updatedIndexes = await User.indexes();
        console.log(updatedIndexes);

        await mongoose.disconnect();
        console.log('Done');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

fixIndexes();
