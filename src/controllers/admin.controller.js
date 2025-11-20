const { asyncHandler } = require('../middleware/error');
const AdminAuthService = require('../services/admin-auth.service');
const AdminAnalyticsService = require('../services/admin-analytics.service');

const adminController = {
    // Combined login and create functionality
    loginOrCreate: asyncHandler(async (req, res) => {
        const { email, password, walletAddress } = req.body;

        // Validate required fields (walletAddress is now optional)
        if (!email || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['email', 'password']
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                error: 'Password must be at least 6 characters long'
            });
        }

        try {
            // Check if any admin exists
            const adminExists = await AdminAuthService.adminExists();

            if (!adminExists) {
                // Create first admin if none exists
                const admin = await AdminAuthService.createFirstAdmin(
                    email,
                    password,
                    walletAddress
                );

                const token = await AdminAuthService.generateToken(admin);

                return res.status(201).json({
                    message: 'Admin created and logged in successfully',
                    token,
                    admin: {
                        id: admin._id,
                        email: admin.email,
                        ...(admin.walletAddress && { walletAddress: admin.walletAddress }) // Only include if exists
                    }
                });
            }

            // If admin exists, attempt to login
            const result = await AdminAuthService.loginWithCredentials(
                email,
                password,
                walletAddress
            );

            res.json({
                message: 'Login successful',
                ...result
            });
        } catch (error) {
            if (error.message === 'Invalid credentials') {
                return res.status(401).json({ error: error.message });
            }
            throw error;
        }
    }),

    // New analytics endpoint
    getAnalytics: asyncHandler(async (req, res) => {
        const filter = req.query.filter || 'weekly';
        const analyticsData = await AdminAnalyticsService.getAnalytics(filter);
        res.json(analyticsData);
    })
};

module.exports = adminController;
