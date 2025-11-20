require('dotenv').config();

const config = {
  // Node environment
  nodeEnv: process.env.NODE_ENV || "development",

  // Server configuration
  port: process.env.PORT || 3000,
  host: process.env.HOST || "localhost",

  // MongoDB configuration
  mongodb: {
    uri:
      process.env.MONGODB_URI,
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoIndex: true,
      serverSelectionTimeoutMS: 30000, // Increased from 5000
      socketTimeoutMS: 60000, // Increased from 45000
      connectTimeoutMS: 30000,
      retryWrites: true,
      retryReads: true,
      maxPoolSize: 50,
      minPoolSize: 10,
    },
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key",
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  },

  // Blockchain configuration
  blockchain: {
    rpcUrl:
      process.env.BLOCKCHAIN_RPC_URL ||
      "https://data-seed-prebsc-1-s1.binance.org:8545/",
    chainId: parseInt(process.env.CHAIN_ID || "56"), // BSC Testnet
    contractAddress: process.env.CONTRACT_ADDRESS,
    usdcAddress: process.env.USDC_ADDRESS,
    privateKey: process.env.ADMIN_PRIVATE_KEY,
    gasLimit: parseInt(process.env.GAS_LIMIT || "3000000"),
    gasPrice: process.env.GAS_PRICE || "auto",
    confirmations: parseInt(process.env.CONFIRMATIONS || "1"),
    timeoutBlocks: parseInt(process.env.TIMEOUT_BLOCKS || "50"),
    networkPollingInterval: parseInt(
      process.env.NETWORK_POLLING_INTERVAL || "4000"
    ),
  },

  // API Keys
  apiKeys: {
    cryptoCompare: process.env.CRYPTOCOMPARE_API_KEY,
    alphaVantage: process.env.ALPHAVANTAGE_API_KEY,
    moralis: process.env.MORALIS_API_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImJiOWNjYmJlLTU0ZGMtNGRiZi04M2JhLWZjOWJjOTE0OWQ5YyIsIm9yZ0lkIjoiOTAyOTciLCJ1c2VySWQiOiI4OTkzOSIsInR5cGVJZCI6IjE5NTJjMWVlLWY0MjAtNGFiMS05MzFmLWViZGVmNzRiZDk1YiIsInR5cGUiOiJQUk9KRUNUIiwiaWF0IjoxNzQyNDkxODg0LCJleHAiOjQ4OTgyNTE4ODR9.pHHIp6iXSyPBHTgRUk9aOgA7kOqQ4ahY_zzpqvPYoHI",
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },

  // Rate limiting
  rateLimit: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500, // limit each IP to 500 requests per windowMs
  },

  // Game configuration
  game: {
    entryFee: 5, // USDC
    gasFee: 0.1, // USDC
    adminFeePercentage: 10,
    maxAssets: 8,
    initialPortfolioValue: 100000,
    minAllocation: 1,
    maxAllocation: 100,
    gameStartTime: "03:00", // UTC
    gameEndTime: "23:59", // UTC
    priceUpdateInterval: 60000, // 1 minute
    leaderboardUpdateInterval: 300000, // 5 minutes
    historyRetentionDays: 7,
  },

  // Cache configuration
  cache: {
    ttl: 60, // seconds
    checkPeriod: 120, // seconds
    maxItems: 100,
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "combined",
    dir: process.env.LOG_DIR || "logs",
    maxFiles: process.env.LOG_MAX_FILES || "14d",
  },

  // Email configuration (for future use)
  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    from: process.env.EMAIL_FROM,
  },

  // Redis configuration (for caching and rate limiting)
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0"),
  },

  // AWS configuration (for future use)
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET,
  },
};

// Environment-specific configurations
if (config.nodeEnv === 'development') {
    // Add development-specific configurations here
    config.mongodb.options.maxPoolSize = 50;
    config.mongodb.options.minPoolSize = 10;
}

// Validation
const requiredEnvVars = [
    'MONGODB_URI',
    'CONTRACT_ADDRESS',
    'USDC_ADDRESS',
    'ADMIN_PRIVATE_KEY',
    'CRYPTOCOMPARE_API_KEY',
    'ALPHAVANTAGE_API_KEY',
    'JWT_SECRET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_S3_BUCKET'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Validate blockchain configuration
if (!config.blockchain.contractAddress || !config.blockchain.usdcAddress) {
    throw new Error('Invalid blockchain configuration: Missing contract addresses');
}

if (!config.blockchain.privateKey) {
    throw new Error('Invalid blockchain configuration: Missing admin private key');
}

// Validate API keys
if (!config.apiKeys.cryptoCompare || !config.apiKeys.alphaVantage) {
    throw new Error('Invalid API configuration: Missing API keys');
}

module.exports = config;
