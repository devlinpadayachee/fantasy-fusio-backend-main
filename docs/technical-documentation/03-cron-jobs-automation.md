# Cron Jobs & Automation

## Overview
The Fusio Fantasy Game uses a comprehensive cron job system to automate various tasks including price updates, game management, reward distribution, and blockchain transaction monitoring. The system is built using `node-cron` for scheduling and includes robust error handling and monitoring.

## Cron Job Architecture

### System Design
- **Scheduler**: `node-cron` library for cron expressions
- **Queue Management**: Bull Queue for background processing
- **Monitoring**: Real-time job status tracking
- **Error Handling**: Comprehensive logging and retry mechanisms
- **Scalability**: Batch processing for large datasets

## Cron Job Configuration

### File Structure
```
src/cron/
├── index.js              # Main cron job initialization
├── jobs/
│   ├── price-updater.js  # Asset price updates
│   ├── game-manager.js   # Game lifecycle management
│   ├── reward-distributor.js # Reward calculation and distribution
│   └── transaction-monitor.js # Blockchain transaction monitoring
└── utils/
    ├── logger.js         # Cron job logging
    └── validator.js      # Cron expression validation
```

## Job Descriptions

### 1. Price Update Job
**Schedule**: Every 5 minutes
**Expression**: `*/5 * * * *`
**Purpose**: Update cryptocurrency prices from external APIs

```javascript
// Implementation details
cron.schedule("*/5 * * * *", async () => {
  try {
    logCronExecution("Price Update");
    await priceService.updateAllPrices();
  } catch (error) {
    console.error("Price update cron job error:", error);
  }
});
```

**Process Flow**:
1. Fetch prices from CryptoCompare API
2. Update database with new prices
3. Cache results in Redis
4. Log price update events

### 2. Game Cron Job Processor
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Process scheduled game creation from GameCron entries

```javascript
// Key operations
const dueCrons = await GameCron.getDueCronJobs();
for (const cronJob of dueCrons) {
  const game = await gameService.createGameFromCron(cronJob);
  // Update cron job status
}
```

**Features**:
- Support for ONCE and RECURRING cron types
- Automatic next execution calculation
- Error handling and retry logic
- Status tracking and logging

### 3. Portfolio Value Updates
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Update portfolio values for active games

**Two types of updates**:
- **Final Portfolio Value Update**: For games ending
- **Regular Portfolio Value Update**: For active games

```javascript
// Final updates
const games = await Game.find({ status: "UPDATE_VALUES" });
for (const game of games) {
  await gameService.updateLockedPortfolioValues(game);
}

// Regular updates
const progressGames = await Game.find({
  status: "ACTIVE",
  startTime: { $lte: now },
  endTime: { $gte: now }
});
```

### 4. Winners Calculation
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Calculate winners for completed games

**Process**:
1. Find games ready for winner calculation
2. Calculate winners based on portfolio performance
3. Update game status
4. Prepare for reward distribution

### 5. Reward Distribution
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Distribute rewards to winners

**Batch Processing**:
- Process 2 games per minute
- Handle blockchain transactions
- Update user balances
- Send notifications

### 6. Game Status Management
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Manage game lifecycle transitions

**Operations**:
- Start upcoming games
- End completed games
- Handle APE portfolio generation
- Update game statuses

### 7. Blockchain Transaction Monitoring
**Schedule**: Every minute
**Expression**: `* * * * *`
**Purpose**: Monitor pending blockchain transactions

**Process**:
1. Check pending portfolio lock transactions
2. Verify transaction receipts
3. Update portfolio status
4. Handle failed transactions
5. Create transaction records

## Cron Job Configuration

### Environment Variables
```bash
# Cron job settings
CRON_ENABLED=true
CRON_LOG_LEVEL=info
CRON_MAX_CONCURRENT_JOBS=5
CRON_RETRY_ATTEMPTS=3
CRON_RETRY_DELAY=5000
```

### Cron Expressions Reference

| Job | Expression | Description |
|-----|------------|-------------|
| Price Update | `*/5 * * * *` | Every 5 minutes |
| Game Cron | `* * * * *` | Every minute |
| Portfolio Update | `* * * * *` | Every minute |
| Winners Calculation | `* * * * *` | Every minute |
| Reward Distribution | `* * * * *` | Every minute |
| Game Status | `* * * * *` | Every minute |
| Transaction Monitor | `* * * * *` | Every minute |

## Monitoring & Alerting

### Health Checks
```javascript
// Health check endpoint
app.get('/health/cron', async (req, res) => {
  const status = await cronService.getCronJobStatus();
  res.json({
    status: 'healthy',
    jobs: status,
    lastRun: new Date()
  });
});
```

### Logging System
```javascript
// Structured logging
const logCronExecution = (jobName) => {
  console.log(`[${new Date().toISOString()}] Executing cron job: ${jobName}`);
};

// Error logging
console.error("Price update cron job error:", {
  error: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString()
});
```

### Metrics Collection
- **Job execution count**
- **Job success/failure rate**
- **Average execution time**
- **Error frequency**
- **Queue size monitoring**

## Error Handling & Recovery

### Retry Strategies
```javascript
// Exponential backoff retry
const retryWithBackoff = async (operation, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }
};
```

### Error Recovery
- **Automatic retry**: Failed jobs retry with exponential backoff
- **Manual intervention**: Admin dashboard for failed jobs
- **Data consistency**: Rollback mechanisms for failed transactions
- **Alert system**: Notifications for critical failures

## Performance Optimization

### Batch Processing
- **Database queries**: Use aggregation pipelines
- **Blockchain calls**: Batch multiple operations
- **API requests**: Cache external API responses
- **Memory management**: Limit concurrent operations

### Resource Management
```javascript
// Limit concurrent operations
const semaphore = new Semaphore(5); // Max 5 concurrent operations

// Memory cleanup
setInterval(() => {
  // Clean up old logs
  // Clear expired cache
  // Release unused resources
}, 300000); // Every 5 minutes
```

## Testing Cron Jobs

### Local Testing
```bash
# Run specific cron job
npm run cron:price-update

# Run all cron jobs
npm run cron:all

# Test cron expressions
npm run cron:test
```

### Test Environment
```javascript
// Test configuration
const testConfig = {
  cronEnabled: false,
  testMode: true,
  mockExternalAPIs: true,
  logLevel: 'debug'
};
```

### Integration Tests
```javascript
describe('Cron Jobs', () => {
  it('should update prices successfully', async () => {
    const result = await priceUpdateJob.execute();
    expect(result.success).toBe(true);
    expect(result.updatedCount).toBeGreaterThan(0);
  });
});
```

## Deployment Considerations

### Production Setup
```bash
# PM2 configuration
module.exports = {
  apps: [{
    name: 'fusio-cron',
    script: 'src/cron/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      CRON_ENABLED: 'true'
    }
  }]
};
```

### Docker Configuration
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "src/cron/index.js"]
```

### Kubernetes Deployment
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: fusio-price-updater
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: price-updater
            image: fusio/cron:latest
            command: ["node", "src/cron/jobs/price-updater.js"]
```

## Troubleshooting

### Common Issues

#### 1. Cron Jobs Not Running
```bash
# Check if cron is enabled
echo $CRON_ENABLED

# Check logs
tail -f logs/cron.log

# Manual trigger
node src/cron/index.js
```

#### 2. Memory Issues
```bash
# Monitor memory usage
top -p $(pgrep node)

# Check for memory leaks
node --inspect src/cron/index.js
```

#### 3. Database Connection Issues
```bash
# Test database connection
mongo mongodb://localhost:27017/fusio

# Check connection pool
db.serverStatus().connections
```

### Debug Mode
```javascript
// Enable debug logging
process.env.DEBUG = 'cron:*';
process.env.CRON_LOG_LEVEL = 'debug';
```

### Health Monitoring
```bash
# Check cron job status
curl http://localhost:3000/health/cron

# Check individual job
curl http://localhost:3000/health/cron/price-updater
```

## Best Practices

### 1. Job Design
- Keep jobs idempotent
- Implement proper error handling
- Use transactions for database operations
- Log all important events

### 2. Resource Management
- Limit concurrent operations
- Implement proper cleanup
- Monitor memory usage
- Use connection pooling

### 3. Monitoring
- Set up alerts for failures
- Monitor execution times
- Track success/failure rates
- Implement health checks

### 4. Testing
- Test all edge cases
- Mock external dependencies
- Use test databases
- Implement integration tests
