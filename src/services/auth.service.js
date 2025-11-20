const jwt = require('jsonwebtoken');
const Web3 = require('web3');
const User = require('../models/User');
const config = require('../config');

class AuthService {
    constructor() {
        this.web3 = new Web3();
    }

    // Generate JWT token
    generateToken(userId) {
        return jwt.sign(
            { userId },
            config.jwt.secret,
            { expiresIn: config.jwt.expiresIn }
        );
    }

    // Connect wallet and generate nonce
    async connectWallet(address) {
        try {
            let user = await User.findOne({ address: address.toLowerCase() });

            if (!user) {
                user = new User({
                    address: address.toLowerCase(),
                    nonce: this.generateNonce()
                });
                await user.save();
            } else {
                user.nonce = this.generateNonce();
                await user.save();
            }

            return {
                address: user.address,
                nonce: user.nonce
            };
        } catch (error) {
            console.error('Error connecting wallet:', error);
            throw new Error('Failed to connect wallet');
        }
    }

    // Verify signature and authenticate user
    async verifySignature(address, signature, nonce) {
        try {
            const user = await User.findOne({ 
                address: address.toLowerCase(),
                nonce
            });

            if (!user) {
                throw new Error('User not found or invalid nonce');
            }

            // Verify signature
            const message = `Nonce: ${nonce}`;
            const recoveredAddress = this.web3.eth.accounts.recover(message, signature);

            if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
                throw new Error('Invalid signature');
            }

            // Generate new nonce for next authentication
            user.nonce = this.generateNonce();
            await user.save();

            // Generate JWT token
            const token = this.generateToken(user._id);

            return {
                token,
                user: {
                    address: user.address,
                    username: user.username,
                    profileImage: user.profileImage,
                    totalGamesPlayed: user.totalGamesPlayed,
                    totalWinnings: user.totalWinnings
                }
            };
        } catch (error) {
            console.error('Error verifying signature:', error);
            throw new Error('Failed to verify signature');
        }
    }

    // Update user profile
    async updateProfile(userId, updates) {
        try {
            const allowedUpdates = ['username', 'profileImage'];
            const updateData = {};

            Object.keys(updates).forEach(key => {
                if (allowedUpdates.includes(key)) {
                    updateData[key] = updates[key];
                }
            });

            const user = await User.findByIdAndUpdate(
                userId,
                updateData,
                { new: true, runValidators: true }
            );

            if (!user) {
                throw new Error('User not found');
            }

            return {
                address: user.address,
                username: user.username,
                profileImage: user.profileImage,
                totalGamesPlayed: user.totalGamesPlayed,
                totalWinnings: user.totalWinnings
            };
        } catch (error) {
            console.error('Error updating profile:', error);
            throw new Error('Failed to update profile');
        }
    }

    // Get user profile
    async getProfile(userId) {
        try {
            const user = await User.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            return {
                address: user.address,
                username: user.username,
                profileImage: user.profileImage,
                totalGamesPlayed: user.totalGamesPlayed,
                totalWinnings: user.totalWinnings
            };
        } catch (error) {
            console.error('Error getting profile:', error);
            throw new Error('Failed to get profile');
        }
    }

    // Helper function to generate random nonce
    generateNonce() {
        return Math.floor(Math.random() * 1000000).toString();
    }

    // Verify JWT token
    verifyToken(token) {
        try {
            return jwt.verify(token, config.jwt.secret);
        } catch (error) {
            throw new Error('Invalid token');
        }
    }
}

module.exports = new AuthService();
