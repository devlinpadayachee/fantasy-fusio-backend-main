# Blockchain Integration

## Overview
The Fusio Fantasy Game integrates with the Binance Smart Chain (BSC) to provide a secure, transparent, and decentralized gaming experience. All game logic, asset management, and reward distribution are handled through smart contracts.

## Smart Contract Architecture

### Core Contracts

#### 1. FusioFantasyGameV2.sol
**Purpose**: Main game contract managing game lifecycle, portfolios, and rewards
**Features**:
- Game creation and management
- Portfolio creation and locking
- Entry fee collection and admin fee distribution
- Reward calculation and distribution
- Winner determination and prize pool management

#### 2. MockUSDC.sol
**Purpose**: Test USDC token for development and testing
**Features**:
- ERC-20 compliant token
- Minting capabilities for testing
- Standard token operations

### Contract Deployment

#### Deployment Addresses (Testnet)
```
Network: BSC Testnet
Chain ID: 97
RPC URL: https://data-seed-prebsc-1-s1.binance.org:8545/

Contract Addresses:
- FusioFantasyGameV2: [Deployed Address]
- USDC Token: [Deployed Address]
```

#### Deployment Script
```javascript
// scripts/deploy.js
const hre = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  
  // Deploy USDC Token (for testing)
  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.deployed();
  console.log("USDC Token deployed to:", usdc.address);
  
  // Deploy Game Contract
  const Game = await ethers.getContractFactory("FusioFantasyGameV2");
  const game = await upgrades.deployProxy(Game, [
    usdc.address,
    "0xYourAdminWallet",
    "0xYourGasWallet"
  ]);
  await game.deployed();
  console.log("Game contract deployed to:", game.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

## Blockchain Service Layer

### Service Overview
The `blockchain.service.js` file provides a comprehensive interface for all blockchain interactions, abstracting the complexity of direct smart contract calls.

### Key Functions

#### 1. USDC Management
```javascript
// Check USDC allowance
const allowance = await blockchainService.checkUSDCAllowance(userAddress);

// Get USDC balance
const balance = await blockchainService.getUSDCBalance(address);

// Approve USDC spending
await blockchainService.approveUSDC(amount);
```

#### 2. Game Management
```javascript
// Create new game
const game = await blockchainService.createGame(
  gameId,
  startTime,
  endTime,
  entryFee,
  entryCap
);

// End game
await blockchainService.endGame(gameId);
```

#### 3. Portfolio Management
```javascript
// Create and lock portfolio
const portfolio = await blockchainService.createAndLockPortfolio(
  userId,
  userAddress,
  symbols,
  allocations,
  tokenQtys,
  gameType,
  isApe
);

// Update portfolio value
await blockchainService.updatePortfolioValue(
  portfolioId,
  currentValue,
  gameId
);
```

#### 4. Reward Distribution
```javascript
// Calculate winners
const winners = await blockchainService.calculateWinners(gameId);

// Distribute rewards
await blockchainService.distributeRewards(gameId, start, end);

// Batch assign rewards
await blockchainService.batchAssignRewards(
  gameId,
  portfolioIds,
  amounts
);
```

### Transaction Management

#### Transaction Queue
The system uses a transaction queue to handle blockchain operations efficiently:
- **Batch Processing**: Groups multiple transactions
- **Retry Logic**: Automatic retry on failures
- **Gas Optimization**: Dynamic gas price calculation
- **Status Tracking**: Real-time transaction status

#### Transaction Lifecycle
1. **Submission**: Transaction added to queue
2. **Validation**: Check gas estimates and nonce
3. **Broadcast**: Send to blockchain network
4. **Monitoring**: Track transaction status
5. **Confirmation**: Wait for block confirmations
6. **Completion**: Update database and notify users

### Gas Optimization

#### Gas Estimation
```javascript
// Estimate gas for transaction
const gasEstimate = await contract.estimateGas.createGame(
  gameId,
  startTime,
  endTime,
  entryFee,
  entryCap
);

// Set appropriate gas limit
const gasLimit = gasEstimate.mul(110).div(100); // 10% buffer
```

#### Dynamic Gas Pricing
```javascript
// Get current gas price
const gasPrice = await provider.getGasPrice();

// Adjust based on network congestion
const adjustedGasPrice = gasPrice.mul(networkMultiplier);
```

### Security Features

#### 1. Access Control
- **Role-based permissions**: Different roles for different operations
- **Admin functions**: Only admin can update critical parameters
- **Game managers**: Limited permissions for game operations

#### 2. Input Validation
- **Address validation**: Ensure valid Ethereum addresses
- **Amount validation**: Check for positive amounts and sufficient balances
- **Time validation**: Ensure valid game start/end times

#### 3. Reentrancy Protection
- **NonReentrant modifier**: Prevents reentrancy attacks
- **Checks-effects-interactions**: Follows best practices for state updates

#### 4. Signature Verification
- **EIP-712**: Typed data signatures for authorization
- **Nonce tracking**: Prevents replay attacks
- **Admin signatures**: Require admin approval for critical operations

### Error Handling

#### Common Error Types
```javascript
// Blockchain errors
const errors = {
  INSUFFICIENT_BALANCE: 'Insufficient USDC balance',
  INVALID_SIGNATURE: 'Invalid admin signature',
  GAME_NOT_FOUND: 'Game does not exist',
  GAME_ALREADY_STARTED: 'Game already started',
  PORTFOLIO_EXISTS: 'Portfolio ID already exists',
  REWARD_ALREADY_ASSIGNED: 'Reward already assigned',
  TRANSACTION_FAILED: 'Blockchain transaction failed',
  GAS_ESTIMATE_FAILED: 'Gas estimation failed',
  NETWORK_ERROR: 'Blockchain network error'
};
```

### Monitoring & Debugging

#### Transaction Monitoring
```javascript
// Monitor transaction status
const receipt = await provider.getTransactionReceipt(txHash);
if (receipt.status === 1) {
  console.log('Transaction successful');
} else {
  console.log('Transaction failed');
}
```

#### Event Listening
```javascript
// Listen for contract events
contract.on('GameCreated', (gameId, startTime, endTime, entryFee) => {
  console.log(`Game ${gameId} created`);
});

contract.on('PortfolioCreated', (gameId, portfolioId, owner) => {
  console.log(`Portfolio ${portfolioId} created for game ${gameId}`);
});
```

### Testing Strategy

#### Unit Tests
- Smart contract functions
- Service layer methods
- API endpoints

#### Integration Tests
- End-to-end game flow
- Blockchain interactions
- Error scenarios

#### Load Testing
- Transaction throughput
- Gas optimization
- Network latency

### Deployment Checklist

#### Pre-deployment
- [ ] Smart contract audit completed
- [ ] Testnet deployment successful
- [ ] All tests passing
- [ ] Gas optimization reviewed
- [ ] Security review completed

#### Production Deployment
- [ ] Mainnet deployment
- [ ] Contract verification on BSCScan
- [ ] Monitoring setup
- [ ] Backup procedures
- [ ] Incident response plan

### Best Practices

#### 1. Security
- Always validate inputs
- Use safe math operations
- Implement proper access control
- Regular security audits

#### 2. Performance
- Batch transactions when possible
- Use efficient data structures
- Monitor gas usage
- Implement caching

#### 3. Reliability
- Implement retry logic
- Use transaction queues
- Monitor network health
- Have fallback mechanisms
