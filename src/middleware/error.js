// Async handler wrapper
exports.asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// 404 handler
exports.notFound = (req, res, next) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`
    });
};

// Error handler
exports.errorHandler = (err, req, res, next) => {
    console.error('Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
        method: req.method,
        userId: req.user ? req.user._id : undefined
    });

    // Handle validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: Object.values(err.errors).map(e => e.message)
        });
    }

    // Handle duplicate key errors
    if (err.name === 'MongoError' && err.code === 11000) {
        return res.status(400).json({
            error: 'Duplicate Error',
            details: 'This record already exists'
        });
    }

    // Handle blockchain errors
    if (err.message && err.message.includes('blockchain')) {
        return res.status(400).json({
            error: 'Blockchain Error',
            details: err.message,
            code: err.code || 'BLOCKCHAIN_ERROR'
        });
    }

    // Handle Web3 errors
    if (err.message && err.message.includes('Web3')) {
        return res.status(400).json({
            error: 'Web3 Error',
            details: err.message,
            code: 'WEB3_ERROR'
        });
    }

    // Handle contract errors
    if (err.message && (
        err.message.includes('contract') ||
        err.message.includes('transaction') ||
        err.message.includes('gas')
    )) {
        return res.status(400).json({
            error: 'Smart Contract Error',
            details: err.message,
            code: 'CONTRACT_ERROR'
        });
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Authentication Error',
            details: 'Invalid token',
            code: 'INVALID_TOKEN'
        });
    }

    // Handle token expiration
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Authentication Error',
            details: 'Token expired',
            code: 'TOKEN_EXPIRED'
        });
    }

    // Handle rate limit errors
    if (err.message && err.message.includes('rate limit')) {
        return res.status(429).json({
            error: 'Rate Limit Error',
            details: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED'
        });
    }

    // Handle network errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
        return res.status(503).json({
            error: 'Service Unavailable',
            details: 'Network error occurred',
            code: 'NETWORK_ERROR'
        });
    }

    // Handle API errors
    if (err.response && err.response.data) {
        return res.status(err.response.status || 400).json({
            error: 'API Error',
            details: err.response.data,
            code: 'API_ERROR'
        });
    }

    // Handle file upload errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            error: 'File Upload Error',
            details: 'File size exceeds limit',
            code: 'FILE_SIZE_ERROR'
        });
    }

    // Handle database connection errors
    if (err.name === 'MongooseServerSelectionError') {
        return res.status(503).json({
            error: 'Database Error',
            details: 'Database connection failed',
            code: 'DB_CONNECTION_ERROR'
        });
    }

    // Default error response
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        code: err.code || 'INTERNAL_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
            stack: err.stack,
            timestamp: new Date().toISOString()
        })
    });
};

// Request validation error handler
exports.validationError = (err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'Invalid JSON',
            details: 'Request body contains invalid JSON',
            code: 'INVALID_JSON'
        });
    }
    next(err);
};

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', {
        reason,
        promise,
        timestamp: new Date().toISOString()
    });
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', {
        error,
        timestamp: new Date().toISOString()
    });
    // Gracefully shutdown the server
    process.exit(1);
});
