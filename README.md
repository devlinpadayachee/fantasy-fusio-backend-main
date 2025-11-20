# Portfolio Competition Game Backend

A Node.js backend system for a Portfolio Competition Game where users compete against an AI-generated portfolio ("Ape") on the Binance Smart Chain.

## Features

- User authentication via wallet signatures
- Portfolio creation and management
- Real-time price tracking for DeFi and TradFi assets
- Automated game lifecycle management
- USDC transaction handling
- Live leaderboard updates
- Automated reward distribution

## Tech Stack

- Node.js & Express
- MongoDB with Mongoose
- Web3.js for blockchain interactions
- Smart Contracts on BSC (Solidity)
- CryptoCompare & Alpha Vantage APIs

## Prerequisites

- Node.js >= 14.0.0
- MongoDB >= 4.4
- BSC Testnet/Mainnet RPC access
- CryptoCompare API key
- Alpha Vantage API key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd portfolio-competition-game-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Deploy smart contracts:
```bash
npm run deploy:contract
```

5. Initialize assets:
```bash
npm run seed:assets
```

## Configuration

Key environment variables:

```env
# Node Environment
NODE_ENV=development
PORT=3000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/portfolio-game

# Blockchain
BLOCKCHAIN_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
CONTRACT_ADDRESS=your-contract-address
USDC_ADDRESS=your-usdc-address
ADMIN_PRIVATE_KEY=your-admin-private-key

# API Keys
CRYPTOCOMPARE_API_KEY=your-api-key
ALPHAVANTAGE_API_KEY=your-api-key
```

## Project Structure

```
src/
├── config/         # Configuration files
├── controllers/    # Route controllers
├── middleware/     # Express middleware
├── models/         # Mongoose models
├── routes/         # Express routes
├── services/       # Business logic
├── scripts/        # Utility scripts
├── cron/          # Scheduled tasks
└── index.js        # Application entry point

contracts/         # Solidity smart contracts
test/             # Test files
```

## API Endpoints

### Authentication
- `POST /api/auth/nonce` - Get nonce for wallet signature
- `POST /api/auth/verify` - Verify wallet signature
- `GET /api/auth/profile` - Get user profile

### Game
- `GET /api/game/status` - Get current game status
- `GET /api/game/:gameId/leaderboard` - Get game leaderboard
- `GET /api/game/history` - Get game history
- `POST /api/game/portfolio` - Submit new portfolio

### Transactions
- `POST /api/transaction/entry-fee` - Process entry fee
- `POST /api/transaction/withdraw` - Process withdrawal
- `GET /api/transaction/history` - Get transaction history

## Automated Tasks

The system runs several automated tasks:

- Price updates: Every minute
- Game state updates: Every 5 minutes
- New game initialization: Monday 03:00 UTC
- Portfolio locking: Monday 03:00 UTC
- Game settlement: Sunday 23:59 UTC
- Price history cleanup: Daily 00:00 UTC

## Development

Start the development server:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

Lint code:
```bash
npm run lint
```

Format code:
```bash
npm run format
```

## Smart Contract Deployment

1. Configure network in hardhat.config.js
2. Deploy contract:
```bash
npm run deploy:contract
```
3. Verify contract:
```bash
npm run verify:contract <contract-address>
```

## Testing

The project includes unit tests and integration tests:

```bash
# Run all tests
npm test

# Run specific test file
npm test test/game.test.js
```

## Security

- JWT authentication for API endpoints
- Wallet signature verification
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation
- Error handling

## Error Handling

The system implements comprehensive error handling:

- Validation errors
- Blockchain errors
- Database errors
- API errors
- Authentication errors
- Rate limiting errors

## Monitoring

Health check endpoint:
```
GET /health
```

Returns system status including:
- MongoDB connection state
- Blockchain connection state
- Environment
- Timestamp

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
