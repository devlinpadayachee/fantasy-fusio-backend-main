const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');

// Authentication middleware
exports.authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
          return res.status(401).json({ error: "Invalid token format" });
        }

        try {
          const decoded = jwt.verify(token, config.jwt.secret);
          const user = await User.findById(decoded.userId);

          if (!user) {
            return res.status(401).json({ error: "User not found" });
          }

          // Attach user to request object
          req.user = user;
          next();
        } catch (error) {
          if (error.name === "TokenExpiredError") {
            return res.status(401).json({
              error: "Token expired, Please sign in and try again.",
            });
          }
          return res
            .status(401)
            .json({ error: "Invalid token Please sign in and try again." });
        }
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Admin authentication middleware
exports.authenticateAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
              error: "No token provided, Please sign in and try again.",
            });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({
              error: "Invalid token format Please sign in and try again.",
            });
        }

        try {
            const decoded = jwt.verify(token, config.jwt.secret);
            
            // Check if this is an admin token (has adminId)
            if (!decoded.adminId) {
                return res.status(403).json({ error: 'Admin access required' });
            }

            const Admin = require('../models/Admin');
            const admin = await Admin.findById(decoded.adminId);

            if (!admin) {
                return res.status(401).json({ error: 'Admin not found' });
            }

            // Attach admin to request object
            req.admin = admin;
            next();
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Token expired' });
            }
            return res.status(401).json({ error: 'Invalid token' });
        }
    } catch (error) {
        console.error('Admin authentication error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Admin middleware (alias for backward compatibility)
exports.isAdmin = exports.authenticateAdmin;

// Rate limiting middleware
exports.rateLimit = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const key = `rateLimit:${userId}`;
        const limit = 200; // requests
        const window = 60 * 1000; // 1 minute

        // Get current count from Redis
        const current = await req.redis.get(key) || 0;

        if (current >= limit) {
            return res.status(429).json({
                error: 'Too many requests',
                message: 'Please try again later'
            });
        }

        // Increment count
        await req.redis.multi()
            .incr(key)
            .pexpire(key, window)
            .exec();

        next();
    } catch (error) {
        console.error('Rate limiting error:', error);
        next(); // Continue on error
    }
};

// Wallet signature verification middleware
exports.verifySignature = async (req, res, next) => {
    try {
        const { address, signature, message } = req.body;
        
        if (!address || !signature || !message) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['address', 'signature', 'message']
            });
        }

        const recoveredAddress = ethers.utils.verifyMessage(message, signature);
        
        if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        next();
    } catch (error) {
        console.error('Signature verification error:', error);
        res.status(400).json({ error: 'Invalid signature format' });
    }
};

// CORS middleware
exports.cors = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.corsOrigin);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
};

// Request validation middleware
exports.validateRequest = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation Error',
                details: error.details.map(detail => detail.message)
            });
        }
        next();
    };
};
