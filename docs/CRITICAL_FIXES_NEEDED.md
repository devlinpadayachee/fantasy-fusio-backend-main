# Critical System Issues & Fixes

**Date:** 2025-11-15
**Status:** Identified - Awaiting Implementation
**Priority:** HIGH - Address before production scale-up

---

## 🔴 CRITICAL Issues (Must Fix - Risk of Money Loss)

### 1. Race Conditions in Portfolio Value Updates

**Severity:** 🔴 CRITICAL
**Files Affected:**
- `src/models/Portfolio.js` (line 143-180)
- `src/cron/index.js` (lines 78-120)

**Problem:**
Multiple cron jobs can update the same portfolio simultaneously with no locking mechanism:
- "Regular Portfolio Value Update" (runs every 1 min)
- "Final Portfolio Value Update" (runs every 1 min)
- Both could process the same game at the same time

**Impact:**
- Final portfolio values could be incorrect
- Wrong winners determined
- Incorrect payouts

**Current Code:**
```javascript
// Portfolio.js
portfolioSchema.methods.calculateValue = async function (prices) {
  let totalValue = 0;
  for (const asset of this.assets) {
    totalValue += prices[asset.assetId] * asset.tokenQty;
  }

  return mongoose.model('Portfolio').findOneAndUpdate(
    { _id: this._id },
    { $set: { currentValue, performancePercentage } }
  );
};
```

**Fix:**
```javascript
// Add version key checking for optimistic locking
portfolioSchema.methods.calculateValue = async function (prices) {
  const currentVersion = this.__v;
  let totalValue = 0;

  for (const asset of this.assets) {
    const price = prices[asset.assetId];
    if (!price || price <= 0) {
      throw new Error(`Invalid price for asset ${asset.assetId}`);
    }
    totalValue += price * asset.tokenQty;
  }

  const currentValue = totalValue;
  const performancePercentage = ((totalValue - this.initialValue) / this.initialValue) * 100;

  // Use optimistic locking with version key
  const updated = await mongoose.model('Portfolio').findOneAndUpdate(
    {
      _id: this._id,
      __v: currentVersion  // Only update if version matches
    },
    {
      $set: { currentValue, performancePercentage },
      $inc: { __v: 1 },
      $push: {
        valueHistory: {
          $each: [{ value: currentValue, timestamp: new Date() }],
          $slice: -20
        }
      }
    },
    { new: true }
  );

  if (!updated) {
    throw new Error('Portfolio update conflict - already being updated');
  }

  return updated;
};
```

**Additional Fix - Add Processing Lock:**
```javascript
// game.service.js - Add lock before processing
async updateLockedPortfolioValues(game) {
  // Check if already being processed
  const isLocked = await Game.findOneAndUpdate(
    { _id: game._id, isProcessingValues: { $ne: true } },
    { $set: { isProcessingValues: true } }
  );

  if (!isLocked) {
    console.log(`Game ${game.gameId} is already being processed, skipping`);
    return;
  }

  try {
    const portfolios = await Portfolio.find({
      gameId: game.gameId,
      status: "LOCKED",
      isLocked: true,
    });

    const assetData = await Asset.find({ type: game.gameType }).select("currentPrice assetId");
    const currentPrices = assetData.reduce((acc, asset) => {
      acc[asset.assetId] = asset.currentPrice;
      return acc;
    }, {});

    for (const portfolio of portfolios) {
      try {
        await portfolio.calculateValue(currentPrices);
      } catch (error) {
        console.error(`Error updating portfolio ${portfolio._id}:`, error);
        // Continue with other portfolios
      }
    }
  } finally {
    // Always release lock
    await Game.findByIdAndUpdate(game._id, { $set: { isProcessingValues: false } });
  }
}
```

**Schema Change Needed:**
```javascript
// models/Game.js - Add processing flag
isProcessingValues: {
  type: Boolean,
  default: false
}
```

---

### 2. No Validation of Portfolio Values After Calculation

**Severity:** 🔴 CRITICAL
**Files Affected:** `src/services/game.service.js` (line 882-914)

**Problem:**
If price API fails, portfolios get `currentValue = 0` but system continues to calculate winners anyway. Result: Everyone "loses" to Ape, no one gets paid.

**Impact:**
- All users lose even if they had winning portfolios
- Complete loss of trust in platform

**Current Code:**
```javascript
async updateLockedPortfolioValues(game) {
  const portfolios = await Portfolio.find({ ... });

  for (const portfolio of portfolios) {
    await portfolio.calculateValue(currentPrices);  // No validation!
  }

  game.status = "CALCULATING_WINNERS";  // Proceeds anyway
  await game.save();
}
```

**Fix:**
```javascript
async updateLockedPortfolioValues(game) {
  const portfolios = await Portfolio.find({
    gameId: game.gameId,
    status: "LOCKED",
    isLocked: true,
  });

  if (portfolios.length === 0) {
    throw new Error(`No locked portfolios found for game ${game.gameId}`);
  }

  const assetData = await Asset.find({ type: game.gameType }).select("currentPrice assetId");

  // VALIDATE: Check we have prices for all assets
  if (assetData.length === 0) {
    throw new Error(`No price data available for game type ${game.gameType}`);
  }

  const currentPrices = assetData.reduce((acc, asset) => {
    if (!asset.currentPrice || asset.currentPrice <= 0) {
      console.error(`Invalid price for asset ${asset.assetId}: ${asset.currentPrice}`);
      return acc;
    }
    acc[asset.assetId] = asset.currentPrice;
    return acc;
  }, {});

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const portfolio of portfolios) {
    try {
      const updated = await portfolio.calculateValue(currentPrices);

      // VALIDATE: Check the calculated value is reasonable
      if (!updated || updated.currentValue === 0 || isNaN(updated.currentValue)) {
        throw new Error(`Portfolio ${portfolio._id} has invalid value: ${updated?.currentValue}`);
      }

      // VALIDATE: Check value isn't wildly off (e.g., more than 10x or less than 0.1x)
      const changeRatio = updated.currentValue / portfolio.initialValue;
      if (changeRatio > 10 || changeRatio < 0.1) {
        console.warn(`Portfolio ${portfolio._id} has suspicious value change: ${changeRatio}x`);
        // Still allow it but log for review
      }

      successCount++;
    } catch (error) {
      failCount++;
      errors.push({ portfolioId: portfolio.portfolioId, error: error.message });
      console.error(`Error updating portfolio ${portfolio._id}:`, error);
    }
  }

  // VALIDATE: Require at least 90% success rate
  const successRate = successCount / portfolios.length;
  if (successRate < 0.9) {
    throw new Error(
      `Portfolio value update failed: Only ${successCount}/${portfolios.length} updated successfully. Errors: ${JSON.stringify(errors.slice(0, 5))}`
    );
  }

  console.log(`Updated values for ${successCount}/${portfolios.length} portfolios (${(successRate * 100).toFixed(1)}% success)`);
}
```

---

### 3. Price Cache Duration Too Short

**Severity:** 🔴 CRITICAL
**Files Affected:** `src/services/price.service.js` (line 15)

**Problem:**
- Prices update every 5 minutes
- Cache expires after 60 seconds
- If API call fails at minute 2, cache is expired but no new data
- Portfolio calculations use `undefined` prices → value becomes 0

**Current Code:**
```javascript
this.CACHE_DURATION = 60 * 1000; // 1 minute cache
```

**Fix:**
```javascript
this.CACHE_DURATION = 10 * 60 * 1000; // 10 minutes - Allow stale data
this.STALE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour - Emergency fallback

// Modify getCachedPrice to support stale data
getCachedPrice(symbol, allowStale = false) {
  const cached = this.cache.prices.get(symbol);
  const lastUpdate = this.cache.lastUpdate.get(symbol);

  if (!cached || !lastUpdate) {
    return null;
  }

  const age = Date.now() - lastUpdate;

  // Fresh data
  if (age < this.CACHE_DURATION) {
    return cached;
  }

  // Stale but acceptable in emergency
  if (allowStale && age < this.STALE_CACHE_DURATION) {
    console.warn(`Using stale price data for ${symbol} (${(age / 60000).toFixed(1)} mins old)`);
    return cached;
  }

  return null;
}

// Add database-backed fallback
async getPriceWithFallback(symbol, type) {
  // Try cache first
  let price = this.getCachedPrice(symbol);
  if (price) return price;

  // Try database (last known good price)
  const asset = await Asset.findOne({
    symbol,
    type,
    lastUpdated: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Within last hour
  });

  if (asset?.currentPrice) {
    console.warn(`Using database fallback price for ${symbol}: $${asset.currentPrice}`);
    return { price: asset.currentPrice, source: 'database' };
  }

  // Last resort: try stale cache
  price = this.getCachedPrice(symbol, true);
  if (price) return price;

  throw new Error(`No price available for ${symbol} from any source`);
}
```

---

### 4. Batch Limits Too Small for Scale

**Severity:** 🟡 SERIOUS
**Files Affected:** `src/cron/index.js` (lines 84, 107, 130, 156)

**Problem:**
```javascript
.limit(5);   // Only 5 games for final value update
.limit(5);   // Only 5 games for regular updates
.limit(3);   // Only 3 games for winner calculation
.limit(2);   // Only 2 games for reward distribution
```

If 100 games end simultaneously: Takes 20+ minutes to process all → users wait 20+ minutes for payouts.

**Fix:**
```javascript
// Add at top of cron/index.js
const BATCH_CONFIG = {
  finalValueUpdate: {
    base: 10,
    max: 50,
    scaleFactor: 0.3  // Process 30% of pending games per cycle
  },
  regularUpdate: {
    base: 10,
    max: 50,
    scaleFactor: 0.5
  },
  winnerCalculation: {
    base: 5,
    max: 20,
    scaleFactor: 0.4
  },
  rewardDistribution: {
    base: 3,
    max: 10,
    scaleFactor: 0.3
  }
};

const calculateDynamicLimit = async (stage, countQuery) => {
  const count = await Game.countDocuments(countQuery);
  const config = BATCH_CONFIG[stage];
  const dynamicLimit = Math.min(
    config.max,
    Math.max(config.base, Math.ceil(count * config.scaleFactor))
  );
  return dynamicLimit;
};

// Usage:
const limit = await calculateDynamicLimit('finalValueUpdate', { status: "UPDATE_VALUES" });
const games = await Game.find({ status: "UPDATE_VALUES" })
  .sort({ updatedAt: 1 })
  .limit(limit);
```

---

## 🟡 SERIOUS Issues (Should Fix Soon)

### 5. No Fallback If External Price APIs Fail

**Severity:** 🟡 SERIOUS
**Files Affected:** `src/services/price.service.js`

**Problem:**
- CryptoCompare or Alpha Vantage API down → no price data
- Game gets stuck in UPDATE_VALUES forever
- Requires manual intervention

**Fix:**
```javascript
// Add redundant API sources
class PriceService {
  constructor() {
    // ... existing code ...

    this.priceAPIs = [
      {
        name: 'CryptoCompare',
        defi: true,
        tradfi: false,
        fetchFunction: this.fetchFromCryptoCompare.bind(this)
      },
      {
        name: 'CoinGecko',
        defi: true,
        tradfi: false,
        fetchFunction: this.fetchFromCoinGecko.bind(this)
      },
      {
        name: 'AlphaVantage',
        defi: false,
        tradfi: true,
        fetchFunction: this.fetchFromAlphaVantage.bind(this)
      },
      {
        name: 'Finnhub',
        defi: false,
        tradfi: true,
        fetchFunction: this.fetchFromFinnhub.bind(this)
      }
    ];
  }

  async updateDefiPricesWithFallback() {
    const defiAPIs = this.priceAPIs.filter(api => api.defi);

    for (const api of defiAPIs) {
      try {
        console.log(`Attempting to update DeFi prices from ${api.name}`);
        await api.fetchFunction();
        console.log(`✓ Successfully updated from ${api.name}`);
        return; // Success, exit
      } catch (error) {
        console.error(`✗ Failed to update from ${api.name}:`, error.message);
        // Try next API
      }
    }

    // All APIs failed - use database fallback
    console.error('All price APIs failed - using database fallback');
    await this.ensureRecentPricesInDatabase();
  }

  async ensureRecentPricesInDatabase() {
    const recentThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 mins
    const staleAssets = await Asset.find({
      lastUpdated: { $lt: recentThreshold }
    });

    if (staleAssets.length > 0) {
      throw new Error(
        `Critical: ${staleAssets.length} assets have stale prices (>30 mins old). Cannot proceed with game calculations.`
      );
    }

    console.log('All assets have recent prices in database, using cached data');
  }

  // Implement CoinGecko as backup
  async fetchFromCoinGecko() {
    const defiAssets = await Asset.find({ type: 'DEFI', isActive: true });
    const symbols = defiAssets.map(a => a.symbol.toLowerCase()).join(',');

    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: symbols,
        vs_currencies: 'usd',
        include_24hr_change: true
      }
    });

    // Update assets...
  }
}
```

---

### 6. No Dead Letter Queue for Failed Blockchain Transactions

**Severity:** 🟡 SERIOUS
**Files Affected:** `src/services/transaction-queue.service.js` (line 88)

**Problem:**
Failed transactions disappear with no record. Winner doesn't get paid, money stuck forever.

**Fix:**
```javascript
// Create new model: models/FailedTransaction.js
const failedTransactionSchema = new mongoose.Schema({
  gameId: Number,
  portfolioId: Number,
  userId: mongoose.Schema.Types.ObjectId,
  amount: String,
  type: {
    type: String,
    enum: ['REWARD_DISTRIBUTION', 'GAME_COMPLETION', 'OTHER']
  },
  error: String,
  errorStack: String,
  retryCount: { type: Number, default: 0 },
  lastRetryAt: Date,
  status: {
    type: String,
    enum: ['PENDING_RETRY', 'FAILED_PERMANENTLY', 'RESOLVED'],
    default: 'PENDING_RETRY'
  },
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FailedTransaction', failedTransactionSchema);

// Update transaction-queue.service.js
async processQueue() {
  // ... existing code ...

  } catch (error) {
    console.error(`Transaction failed: ${description}`, error);

    // Try recovery strategies...

    // If all retries exhausted
    if (retries >= this.maxRetries) {
      // Store in dead letter queue
      await FailedTransaction.create({
        type: 'REWARD_DISTRIBUTION',
        error: error.message,
        errorStack: error.stack,
        metadata: {
          description,
          retries,
          nonce: this.currentNonce
        }
      });

      // Alert admins
      await this.alertAdmins('Transaction Failed', {
        description,
        error: error.message,
        retries
      });

      this.queue.shift();
      reject(error);
    }
  }
}

async alertAdmins(title, data) {
  // Send Discord webhook
  if (process.env.DISCORD_ADMIN_WEBHOOK) {
    await axios.post(process.env.DISCORD_ADMIN_WEBHOOK, {
      content: `🚨 **${title}**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
    });
  }

  // Log to monitoring service
  console.error(`[ALERT] ${title}:`, data);
}
```

**Add Retry Cron Job:**
```javascript
// In cron/index.js - Add new job to retry failed transactions
cron.schedule("*/10 * * * *", async () => {
  try {
    logCronExecution("Retry Failed Transactions");

    const failedTxs = await FailedTransaction.find({
      status: 'PENDING_RETRY',
      retryCount: { $lt: 10 },
      $or: [
        { lastRetryAt: { $exists: false } },
        { lastRetryAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } } // 30 mins ago
      ]
    }).limit(5);

    for (const tx of failedTxs) {
      try {
        // Attempt to resend transaction
        await gameService.retryFailedReward(tx);

        tx.status = 'RESOLVED';
        await tx.save();
      } catch (error) {
        tx.retryCount += 1;
        tx.lastRetryAt = new Date();

        if (tx.retryCount >= 10) {
          tx.status = 'FAILED_PERMANENTLY';
          // Alert admins for manual intervention
        }

        await tx.save();
      }
    }
  } catch (error) {
    console.error("Failed transaction retry cron error:", error);
  }
});
```

---

### 7. Cron Jobs Run Simultaneously (Causing DB Overload)

**Severity:** 🟡 SERIOUS
**Files Affected:** `src/cron/index.js` (all cron schedules)

**Problem:**
All cron jobs use `"* * * * *"` → all start at :00 seconds → MongoDB gets 8 concurrent queries → timeouts.

**Fix:**
```javascript
// Stagger cron jobs by offsetting their schedules

// Price updates - Every 5 minutes at :00 seconds
cron.schedule("*/5 * * * *", async () => {
  await priceService.updateAllPrices();
});

// Game initialization - Every minute at :05 seconds
cron.schedule("5-59/1 * * * *", async () => {
  await processGameCrons();
});

// Final value update - Every minute at :10 seconds
cron.schedule("10-59/1 * * * *", async () => {
  await updateFinalValues();
});

// Regular value update - Every minute at :20 seconds
cron.schedule("20-59/1 * * * *", async () => {
  await updateRegularValues();
});

// Winner calculation - Every minute at :30 seconds
cron.schedule("30-59/1 * * * *", async () => {
  await calculateWinners();
});

// Reward distribution - Every minute at :40 seconds
cron.schedule("40-59/1 * * * *", async () => {
  await distributeRewards();
});

// Game completion check - Every minute at :50 seconds
cron.schedule("50-59/1 * * * *", async () => {
  await checkGameCompletions();
});

// Transaction status check - Every minute at :15 seconds
cron.schedule("15-59/1 * * * *", async () => {
  await checkPendingTransactions();
});
```

---

## 🟠 MODERATE Issues (Should Address)

### 8. No Idempotency Protection

**Severity:** 🟠 MODERATE
**Files Affected:** `src/services/game.service.js` (reward distribution)

**Problem:**
If cron runs twice, rewards could be sent twice → USDC drained.

**Fix:**
```javascript
async distributeGameRewards(game, batchSize = 50) {
  const undistributedWinners = game.winners.filter(w => !w.isRewardDistributed);

  for (const winner of undistributedWinners) {
    // CHECK: Has this already been paid?
    const existingTx = await Transaction.findOne({
      gameId: game.gameId,
      portfolioId: winner.portfolioId,
      type: 'REWARD',
      status: 'COMPLETED'
    });

    if (existingTx) {
      console.log(`Portfolio ${winner.portfolioId} already paid, skipping`);
      await game.markWinnerRewardDistributed(winner._id, existingTx.transactionHash);
      continue;
    }

    // Proceed with payment...
  }
}
```

---

### 9. No System Monitoring/Alerting

**Severity:** 🟠 MODERATE
**Files Affected:** New files needed

**Fix:**
Create `src/services/monitoring.service.js`:

```javascript
const axios = require('axios');

class MonitoringService {
  constructor() {
    this.discordWebhook = process.env.DISCORD_MONITORING_WEBHOOK;
    this.metrics = {
      cronExecutions: new Map(),
      errors: [],
      lastHealthCheck: Date.now()
    };
  }

  async logCronExecution(jobName, duration, success, error = null) {
    const metric = {
      jobName,
      timestamp: new Date(),
      duration,
      success,
      error: error?.message
    };

    this.metrics.cronExecutions.set(jobName, metric);

    if (!success) {
      await this.alertCritical(`Cron job failed: ${jobName}`, { error: error?.message, duration });
    }

    // Alert if job takes too long
    if (duration > 30000) { // 30 seconds
      await this.alertWarning(`Cron job slow: ${jobName}`, { duration });
    }
  }

  async alertCritical(message, data) {
    console.error(`[CRITICAL] ${message}`, data);

    if (this.discordWebhook) {
      await axios.post(this.discordWebhook, {
        content: `🚨 **CRITICAL**: ${message}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
        username: 'Fantasy Finance Monitor'
      }).catch(err => console.error('Failed to send Discord alert:', err));
    }
  }

  async alertWarning(message, data) {
    console.warn(`[WARNING] ${message}`, data);

    if (this.discordWebhook) {
      await axios.post(this.discordWebhook, {
        content: `⚠️ **WARNING**: ${message}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
        username: 'Fantasy Finance Monitor'
      }).catch(err => console.error('Failed to send Discord alert:', err));
    }
  }

  getHealthStatus() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cronJobs: Array.from(this.metrics.cronExecutions.values()),
      recentErrors: this.metrics.errors.slice(-10),
      timestamp: new Date()
    };
  }
}

module.exports = new MonitoringService();
```

Add health check endpoint in `src/routes/index.js`:
```javascript
router.get('/health', (req, res) => {
  const health = monitoringService.getHealthStatus();
  res.json(health);
});
```

---

### 10. Single Points of Failure

**Severity:** 🟠 MODERATE
**Files Affected:** `src/services/blockchain.service.js`, `src/config/database.js`

**Fix:**

```javascript
// blockchain.service.js - Add RPC failover
class BlockchainService {
  constructor() {
    this.rpcEndpoints = [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
      'https://bsc.rpc.blxrbdn.com'
    ];
    this.currentRpcIndex = 0;
    this.initializeProvider();
  }

  initializeProvider() {
    const rpcUrl = this.rpcEndpoints[this.currentRpcIndex];
    console.log(`Connecting to BSC RPC: ${rpcUrl}`);

    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl, 56);

    // Setup error handler for automatic failover
    this.provider.on('error', (error) => {
      console.error(`RPC error on ${rpcUrl}:`, error);
      this.switchToNextRpc();
    });
  }

  switchToNextRpc() {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcEndpoints.length;
    console.log(`Switching to backup RPC endpoint: ${this.rpcEndpoints[this.currentRpcIndex]}`);
    this.initializeProvider();

    // Reinitialize wallet and contract with new provider
    this.adminWallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);
    this.contract = new ethers.Contract(
      config.blockchain.contractAddress,
      FusioFantasyGameV2.abi,
      this.adminWallet
    );
  }
}
```

---

## 🟢 MINOR Issues (Nice to Have)

### 11. No Rate Limiting on API Endpoints

**Fix:** Add rate limiting middleware
```javascript
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Apply to portfolio submission
router.post('/submit-pending', apiLimiter, portfolioController.submitPendingPortfolio);
```

---

### 12. Missing Database Indexes

**Fix:** Add compound indexes in models
```javascript
// Game.js
gameSchema.index({ status: 1, endTime: 1 }); // For game completion queries
gameSchema.index({ status: 1, hasCalculatedWinners: 1 }); // For winner calculation
gameSchema.index({ status: 1, isFullyDistributed: 1 }); // For reward distribution

// Portfolio.js
portfolioSchema.index({ gameId: 1, status: 1 }); // For game portfolio queries
portfolioSchema.index({ status: 1, transactionHash: 1 }); // For transaction checks
```

---

### 13. Console-Only Logging

**Fix:** Add Winston logger
```javascript
// src/utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

module.exports = logger;
```

Replace all `console.log` with `logger.info`, `console.error` with `logger.error`, etc.

---

## Implementation Priority

### Phase 1 (CRITICAL - Do First):
1. ✅ Add race condition protection (#1)
2. ✅ Add portfolio value validation (#2)
3. ✅ Fix price cache duration (#3)
4. ✅ Add monitoring & alerts (#9)

### Phase 2 (SERIOUS - Do Soon):
5. ✅ Add dynamic batch limits (#4)
6. ✅ Add API fallbacks (#5)
7. ✅ Add dead letter queue (#6)
8. ✅ Stagger cron jobs (#7)

### Phase 3 (MODERATE - Do When Possible):
9. ✅ Add idempotency checks (#8)
10. ✅ Add RPC failover (#10)

### Phase 4 (MINOR - Polish):
11. ✅ Add rate limiting (#11)
12. ✅ Add database indexes (#12)
13. ✅ Add structured logging (#13)

---

## Testing Checklist After Fixes

- [ ] Test race condition: Run two value update crons simultaneously
- [ ] Test price API failure: Block API calls and verify fallback works
- [ ] Test invalid portfolio values: Mock zero prices and verify game doesn't proceed
- [ ] Test batch scaling: Create 100 games ending simultaneously
- [ ] Test transaction failure: Mock blockchain failures and verify dead letter queue
- [ ] Test cron staggering: Monitor database load at :00 seconds
- [ ] Test RPC failover: Kill primary RPC and verify switch
- [ ] Load test: 1000 concurrent users submitting portfolios

---

## Environment Variables to Add

```env
# Monitoring
DISCORD_MONITORING_WEBHOOK=https://discord.com/api/webhooks/...
DISCORD_ADMIN_WEBHOOK=https://discord.com/api/webhooks/...

# Backup APIs
COINGECKO_API_KEY=...
FINNHUB_API_KEY=...

# Logging
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

---

**Document End**

