# High-Level Code Structure Understanding Document

## Overview
The Fusio Fantasy Game Backend is a comprehensive Node.js application that powers a portfolio competition game on the Binance Smart Chain (BSC). Users compete against an AI-generated portfolio by creating and managing cryptocurrency portfolios, with all transactions and rewards handled via smart contracts.

## Core Architecture

### 1. Application Structure
The codebase follows a modular architecture with clear separation of concerns:

```
src/
├── config/         # Configuration management
├── controllers/    # Route handlers and business logic
├── middleware/     # Express middleware (auth, error handling, upload)
├── models/         # Mongoose database models
├── routes/         # API route definitions
├── services/       # Business logic services
├── cron/          # Automated background jobs
├── scripts/       # Utility scripts
└── index.js       # Application entry point
```

### 2. Technology Stack
- **Runtime**: Node.js with Express.js framework
- **Database**: MongoDB with Mongoose ODM
- **Blockchain**: Ether.js integration with BSC
- **Authentication**: JWT-based with wallet signatures
- **Caching**: Redis for performance optimization
- **Scheduling**: Node-cron for automated tasks
- **Security**: Helmet, CORS, rate limiting
- **Smart Contracts**: Solidity with OpenZeppelin libraries

## Key Components Deep Dive

### Configuration Layer (`src/config/`)
- **Centralized Configuration**: All environment variables and settings managed in `config/index.js`
- **Database Setup**: MongoDB connection configuration with connection pooling
- **Blockchain Config**: RPC URLs, contract addresses, gas settings
- **API Integrations**: Keys for CryptoCompare, Alpha Vantage, Moralis
- **Security Settings**: JWT secrets, CORS policies, rate limiting rules

### Database Models (`src/models/`)
The application uses several core models:
- **User**: Player accounts with wallet addresses
- **Game**: Competition instances with timing and rules
- **Portfolio**: User-created investment portfolios
- **Transaction**: All blockchain and internal transactions
- **Asset**: Supported cryptocurrencies and their metadata
- **Notification**: User alerts and system messages
- **GameCron**: Scheduled game creation automation

### Service Layer (`src/services/`)
Business logic is encapsulated in service modules:
- **blockchain.service.js**: All smart contract interactions
- **game.service.js**: Game lifecycle management
- **portfolio.service.js**: Portfolio creation and valuation
- **price.service.js**: External API price fetching
- **transaction.service.js**: Payment processing
- **auth.service.js**: Authentication and authorization

### API Routes (`src/routes/`)
RESTful API endpoints organized by domain:
- **Authentication**: Wallet connection and JWT management
- **Games**: Competition creation, status, and leaderboards
- **Portfolios**: User portfolio management
- **Transactions**: Payment processing and history
- **Assets**: Cryptocurrency data and management
- **Admin**: Administrative controls and analytics

### Cron Job System (`src/cron/`)
Automated background processing for:
- **Price Updates**: Real-time cryptocurrency pricing (every 5 minutes)
- **Game Management**: Lifecycle automation (game creation, status updates)
- **Portfolio Valuation**: Real-time portfolio value calculations
- **Winner Calculation**: Automated competition result processing
- **Reward Distribution**: Batch reward payouts to winners
- **Transaction Monitoring**: Blockchain transaction status tracking

## Blockchain Integration

### Smart Contract Architecture
The `FusioFantasyGameV2.sol` contract handles:
- **Game Creation**: Setting up competitions with entry fees and timeframes
- **Portfolio Management**: Creating and locking user portfolios
- **Fee Processing**: Entry fee collection with admin fee distribution
- **Reward System**: Secure reward assignment and distribution
- **Access Control**: Role-based permissions for admin and game manager functions

### Transaction Flow
1. **User Approval**: USDC allowance granted to contract
2. **Portfolio Creation**: Smart contract creates portfolio and collects entry fee
3. **Fee Distribution**: Admin fee sent to admin wallet, remainder to prize pool
4. **Game Processing**: Automated winner calculation and reward distribution
5. **Withdrawal**: Users can withdraw winnings to their wallets

## Data Flow Architecture

### Game Lifecycle
1. **Game Creation**: Admin or cron job creates game with parameters
2. **Registration Phase**: Users create portfolios and pay entry fees
3. **Active Phase**: Real-time portfolio valuation updates
4. **Completion Phase**: Winner calculation and reward distribution
5. **Settlement**: Final payouts and game archival

### Price Update System
1. **API Fetching**: External APIs (CryptoCompare, Alpha Vantage) queried
2. **Data Processing**: Price normalization and validation
3. **Database Storage**: Historical price data maintained
4. **Portfolio Recalculation**: All active portfolios revalued
5. **Cache Updates**: Redis cache refreshed for performance

### Transaction Processing
1. **Initiation**: User requests transaction (entry fee, withdrawal)
2. **Validation**: Balance and allowance checks
3. **Blockchain Submission**: Transaction sent to BSC network
4. **Monitoring**: Cron jobs track transaction confirmations
5. **Database Update**: Local records updated with blockchain data
6. **Notification**: User alerted of transaction status

## Security Architecture

### Authentication & Authorization
- **Wallet Signatures**: Users authenticate via crypto wallet signatures
- **JWT Tokens**: Session management for API access
- **Role-Based Access**: Admin, game manager, and user roles
- **Rate Limiting**: API abuse prevention

### Blockchain Security
- **Smart Contract Audits**: OpenZeppelin libraries for battle-tested code
- **Reentrancy Protection**: Guards against reentrancy attacks
- **Access Control**: Role-based function access
- **Input Validation**: Comprehensive parameter checking
- **Signature Verification**: EIP-712 typed data signing

### Application Security
- **Input Sanitization**: All user inputs validated
- **Error Handling**: Comprehensive error catching and logging
- **HTTPS Enforcement**: Secure communication channels
- **CORS Configuration**: Cross-origin request control
- **Helmet Security Headers**: XSS and clickjacking protection

## Performance Optimizations

### Database Optimization
- **Indexing**: Strategic indexes on frequently queried fields
- **Connection Pooling**: Efficient database connection management
- **Aggregation Pipelines**: Optimized complex queries
- **Caching**: Redis for frequently accessed data

### API Performance
- **Rate Limiting**: Prevents API abuse and ensures fair usage
- **Compression**: Response compression for reduced bandwidth
- **Pagination**: Efficient handling of large datasets
- **Caching**: Response caching for static data

### Blockchain Optimization
- **Batch Transactions**: Multiple operations grouped for gas efficiency
- **Gas Estimation**: Dynamic gas pricing based on network conditions
- **Transaction Queues**: Asynchronous processing to prevent blocking
- **Event Monitoring**: Efficient event listening for contract updates

## Monitoring & Observability

### Health Checks
- **Application Health**: `/health` endpoint for system status
- **Database Connectivity**: MongoDB connection monitoring
- **Blockchain Status**: BSC network connectivity checks
- **Cron Job Status**: Automated task health monitoring

### Logging System
- **Structured Logging**: Consistent log format across services
- **Error Tracking**: Comprehensive error logging with context
- **Performance Metrics**: Response times and throughput tracking
- **Audit Trails**: Important actions logged for compliance

### Alerting System
- **Critical Errors**: Immediate alerts for system failures
- **Performance Degradation**: Threshold-based monitoring
- **Blockchain Issues**: Network connectivity and transaction failures
- **Security Events**: Suspicious activity detection

## Deployment & DevOps

### Environment Management
- **Development**: Local development with testnet blockchain
- **Staging**: Pre-production environment for testing
- **Production**: Live environment with mainnet blockchain

### Containerization
- **Docker Support**: Containerized deployment for consistency
- **Multi-stage Builds**: Optimized production images
- **Environment Variables**: Secure configuration management

### Scaling Considerations
- **Horizontal Scaling**: Stateless design supports multiple instances
- **Database Sharding**: Support for database scaling
- **Load Balancing**: NGINX configuration for traffic distribution
- **CDN Integration**: Static asset delivery optimization

## Development Workflow

### Code Organization
- **Modular Design**: Clear separation of concerns
- **Service Pattern**: Business logic encapsulated in services
- **Middleware Pattern**: Reusable request processing
- **Error Handling**: Consistent error response format

### Testing Strategy
- **Unit Tests**: Individual function and module testing
- **Integration Tests**: API endpoint and service interaction testing
- **Blockchain Tests**: Smart contract interaction testing
- **Load Testing**: Performance and scalability validation

### Documentation
- **API Documentation**: Comprehensive endpoint documentation
- **Code Comments**: Inline documentation for complex logic
- **Architecture Docs**: High-level system design documentation
- **Deployment Guides**: Step-by-step deployment instructions

This document provides a comprehensive overview of how the Fusio Fantasy Game Backend is structured and operates. The modular architecture, comprehensive automation, and robust security measures ensure a scalable and maintainable system for blockchain-based portfolio competitions.
