const Admin = require('../models/Admin');
const jwt = require('jsonwebtoken');
const config = require('../config');
const ethers = require('ethers');

class AdminAuthService {
    /**
     * Check if any admin exists
     */
    static async adminExists() {
        try {
            return await Admin.adminExists();
        } catch (error) {
            throw error;
        }
    }

    /**
     * Generate JWT token for admin
     */
    static async generateToken(admin) {
        try {
            const token = jwt.sign(
                {
                    adminId: admin._id,
                    email: admin.email
                },
                config.jwt.secret,
                {
                    expiresIn: config.jwt.expiresIn
                }
            );
            return token;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Create first admin if no admin exists
     */
    static async createFirstAdmin(email, password, walletAddress) {
        try {
            // Create new admin (walletAddress is now optional)
            const admin = new Admin({
                email,
                password,
                walletAddress: walletAddress || undefined // Only set if provided
            });

            await admin.save();
            return admin;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Login admin with credentials
     */
    static async loginWithCredentials(email, password, walletAddress) {
        try {
            const admin = await Admin.findByEmail(email);
            if (!admin) {
                throw new Error('Invalid credentials');
            }

            const isValidPassword = await admin.comparePassword(password);
            if (!isValidPassword) {
                throw new Error('Invalid credentials');
            }

            // Update last login
            admin.lastLogin = new Date();
            await admin.save();

            // Generate JWT token
            const token = await this.generateToken(admin);

            return {
                token,
                admin: {
                    id: admin._id,
                    email: admin.email,
                    ...(admin.walletAddress && { walletAddress: admin.walletAddress }), // Only include if exists
                    lastLogin: admin.lastLogin
                }
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Verify if admin exists by email
     */
    static async verifyAdminByEmail(email) {
        try {
            const admin = await Admin.findByEmail(email);
            return !!admin;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Verify if admin exists by wallet address
     */
    static async verifyAdminByWallet(walletAddress) {
        try {
            const admin = await Admin.findByWalletAddress(walletAddress);
            return !!admin;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = AdminAuthService;
