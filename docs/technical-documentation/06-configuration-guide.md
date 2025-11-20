# Configuration Guide

## Overview
This guide provides comprehensive instructions for setting up and configuring the Fusio Fantasy Game platform, including environment setup, deployment procedures, and operational configurations.

## Prerequisites

### System Requirements
- **Operating System**: Linux (Ubuntu 20.04+), macOS (10.15+), or Windows 10+
- **Node.js**: v16.0.0 or higher
- **MongoDB**: v5.0 or higher
- **Redis**: v6.0 or higher
- **Docker**: v20.10 or higher (optional)
- **Git**: v2.20 or higher

### Hardware Requirements
- **CPU**: 4 cores minimum, 8 cores recommended
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 50GB minimum, 100GB recommended
- **Network**: Stable internet connection with 10Mbps+ bandwidth

## Environment Setup

### 1. Development Environment

#### Local Development Setup

**Step 1: Clone Repository**
```bash
git clone https://github.com/your-org/fusio-fantasy-backend.git
cd fusio-fantasy-backend
```

**Step 2: Install Dependencies**
```bash
npm install
```

**Step 3: Environment Configuration**
Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

**Step 4: Configure Environment Variables**
Edit `.env` file with your configuration:

```bash
# Application Configuration
NODE_ENV=development
PORT=3000
HOST=localhost

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/fusio_fantasy
REDIS_HOST=localhost
REDIS_PORT=6379

# Blockchain Configuration
BLOCKCHAIN_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
CHAIN_ID=97
CONTRACT_ADDRESS=0x...
USDC_ADDRESS=0x...
ADMIN_PRIVATE_KEY=0x...

# API Keys
JWT_SECRET=your-jwt-secret-key
CRYPTOCOMPARE_API_KEY=your-cryptocompare-key
ALPHAVANTAGE_API_KEY=your-alphavantage-key

# AWS Configuration (Optional)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=fusio-fantasy-bucket
```

**Step 5: Database Setup**
```bash
# Start MongoDB
mongod --dbpath /path/to/data

# Create database
mongo
use fusio_fantasy
```

**Step 6: Redis Setup**
```bash
# Start Redis
redis-server

# Test connection
redis-cli ping
```

**Step 7: Initialize Database**
```bash
npm run db:init
npm run db:migrate
```

### 2. Docker Setup

#### Docker Compose Configuration
Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
      - redis
    volumes:
      - ./logs:/app/logs

  mongodb:
    image: mongo:5.0
    ports:
      - "27017:27017"
    volumes:
      - ./data/mongodb:/data/db
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password

  redis:
    image: redis:6.0-alpine
    ports:
      - "6379:6379"
    volumes:
      - ./data/redis:/data
```

#### Docker Commands
```bash
# Build and start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### 3. Production Environment

#### AWS EC2 Setup

**Step 1: Launch EC2 Instance**
- **Instance Type**: t3.medium or t3.large
- **AMI**: Ubuntu 20.04 LTS
- **Security Groups**: Allow ports 22, 80, 443, 3000

**Step 2: Server Setup**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/5.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-5.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Install Redis
sudo apt-get install -y redis-server

# Install PM2
npm install -g pm2
```

**Step 3: Application Deployment**
```bash
# Clone repository
git clone https://github.com/your-org/fusio-fantasy-backend.git
cd fusio-fantasy-backend

# Install dependencies
npm install

# Build application
npm run build

# Start with PM2
pm2 start ecosystem.config.js
```

#### Ecosystem Configuration
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'fusio-fantasy-backend',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

### 4. Environment-Specific Configurations

#### Development Environment
```bash
# .env.development
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/fusio_fantasy_dev
REDIS_HOST=localhost
REDIS_PORT=6379
```

#### Staging Environment
```bash
# .env.staging
NODE_ENV=staging
PORT=3000
MONGODB_URI=mongodb://staging-db:27017/fusio_fantasy_staging
REDIS_HOST=staging-redis
REDIS_PORT=6379
```

#### Production Environment
```bash
# .env.production
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://prod-db:27017/fusio_fantasy_prod
REDIS_HOST=prod-redis
REDIS_PORT=6379
```

## Database Configuration

### MongoDB Configuration

#### Connection String
```javascript
// MongoDB connection options
const mongoose = require('mongoose');

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  autoIndex: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 60000,
  connectTimeoutMS: 30000,
  maxPoolSize: 50,
  minPoolSize: 10,
  retryWrites: true,
  retryReads: true
};

mongoose.connect(process.env.MONGODB_URI, options);
```

#### Database Indexes
```javascript
// Example index creation
db.users.createIndex({ email: 1 }, { unique: true });
db.games.createIndex({ gameId: 1 }, { unique: true });
db.transactions.createIndex({ transactionHash: 1 }, { unique: true });
```

### Redis Configuration

#### Connection Options
```javascript
const redis = require('redis');

const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      return new Error('Redis server connection refused');
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Redis retry time exhausted');
    }
    if (options.attempt > 10) {
      return undefined;
    }
    return Math.min(options.attempt * 100, 3000);
  }
});
```

## Security Configuration

### SSL/TLS Setup

#### Nginx Configuration
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/ssl/certs/yourdomain.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Security Headers
```javascript
// Express security headers
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));
```

## Monitoring & Logging

### Application Monitoring

#### PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'fusio-fantasy-backend',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '1G'
  }]
};
```

#### Monitoring Commands
```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs

# Monitor resources
pm2 monit

# Restart application
pm2 restart all
```

### Log Management

#### Log Rotation
```bash
# Setup logrotate
sudo nano /etc/logrotate.d/fusio-fantasy

# Logrotate configuration
/var/log/fusio-fantasy/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 app app
    postrotate
        pm2 reload all
    endscript
}
```

## Monitoring & Alerting

### Health Checks
```bash
# Health check endpoint
curl http://localhost:3000/health

# Database health check
curl http://localhost:3000/health/db

# Redis health check
curl http://localhost:3000/health/redis
```

### Monitoring Tools
- **PM2**: Process monitoring
- **MongoDB Atlas**: Database monitoring
- **Redis**: Cache monitoring
- **New Relic**: Application performance monitoring
- **Datadog**: Infrastructure monitoring

## Backup & Recovery

### Database Backup
```bash
# MongoDB backup
mongodump --uri=mongodb://localhost:27017/fusio_fantasy --out=/backup/$(date +%Y%m%d)

# MongoDB restore
mongorestore --uri=mongodb://localhost:27017/fusio_fantasy /backup/20240101/
```

### Redis Backup
```bash
# Redis backup
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
```

### Application Backup
```bash
# Backup application
tar -czf backup-$(date +%Y%m%d).tar.gz /app
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Issues
```bash
# Check MongoDB status
sudo systemctl status mongod

# Check Redis status
sudo systemctl status redis

# Test connection
mongo --eval "db.runCommand('ping')"
```

#### 2. Memory Issues
```bash
# Check memory usage
free -h
top

# Check PM2 memory usage
pm2 monit
```

#### 3. Network Issues
```bash
# Check connectivity
curl -I http://localhost:3000/health
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=fusio:* npm start

# Enable verbose logging
NODE_ENV=development npm start
```

## Support

### Contact Information
- **Email**: support@fusiofantasy.com
- **Discord**: https://discord.gg/fusiofantasy
- **Documentation**: https://docs.fusiofantasy.com

### Support Channels
- **GitHub Issues**: https://github.com/your-org/fusio-fantasy-backend/issues
- **Discord**: https://discord.gg/fusiofantasy
- **Email**: support@fusiofantasy.com
