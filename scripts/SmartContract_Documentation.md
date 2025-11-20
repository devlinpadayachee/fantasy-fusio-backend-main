# FusioFantasyGame Smart Contract Documentation

## Contract Overview

**Contract Name:** FusioFantasyGame

**Contract Purpose:**  
This contract manages the Fusio Fantasy Game, a decentralized portfolio competition game where users create portfolios of exactly 8 assets, pay entry fees in USDC, and compete against an AI-generated portfolio ("Ape"). The contract handles game lifecycle management, portfolio locking, entry fee processing, winner calculation, reward distribution, and secure withdrawals. It also supports automated game initialization and leaderboard updates via external cron jobs.

---

## Methods

### 1. `constructor(address _usdcToken, address _gasFeeWallet, address _apeWallet)`

- **Description:**  
  Initializes the contract with the USDC token address, gas fee wallet, and Ape wallet addresses. Sets initial counters to zero.

- **Parameters:**  
  - `_usdcToken`: `address` — The address of the USDC token contract.  
  - `_gasFeeWallet`: `address` — The wallet address to receive gas fees.  
  - `_apeWallet`: `address` — The wallet address representing the AI-generated portfolio ("Ape").

- **Return Values:** None

- **Visibility:** `public`

- **Modifiers:** None

---

### 2. `getCurrentGameForType(GameType gameType)`

- **Description:**  
  Returns the current active game ID for the specified game type (DEFI or TRADFI). Reverts if no active game exists.

- **Parameters:**  
  - `gameType`: `GameType` (enum) — The type of game (DEFI or TRADFI).

- **Return Values:**  
  - `uint256` — The current active game ID for the specified game type.

- **Visibility:** `public view`

- **Modifiers:** None

---

### 3. `getGameDetails(uint256 gameId)`

- **Description:**  
  Returns detailed information about a specific game.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.

- **Return Values:**  
  - `startTime`: `uint256` — Game start timestamp.  
  - `endTime`: `uint256` — Game end timestamp.  
  - `totalPrizePool`: `uint256` — Total prize pool accumulated for the game.  
  - `status`: `GameStatus` (enum) — Current status of the game (NONE, ACTIVE, COMPLETED).  
  - `gameType`: `GameType` (enum) — The type of the game (DEFI or TRADFI).

- **Visibility:** `external view`

- **Modifiers:** None

---

### 4. `getApePortfolioValue(uint256 gameId)`

- **Description:**  
  Returns the current value of the AI-generated portfolio ("Ape") for a given game.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.

- **Return Values:**  
  - `uint256` — The current value of the Ape portfolio.

- **Visibility:** `public view`

- **Modifiers:** None

---

### 5. `getPortfolioAssets(uint256 portfolioId)`

- **Description:**  
  Returns the asset symbols and quantities for a given portfolio.

- **Parameters:**  
  - `portfolioId`: `uint256` — The ID of the portfolio.

- **Return Values:**  
  - `symbols`: `bytes32[]` — Array of asset symbols (length 8).  
  - `quantities`: `uint256[]` — Array of token quantities corresponding to each asset.

- **Visibility:** `public view`

- **Modifiers:** None

---

### 6. `getUserLockedBalance(address user)`

- **Description:**  
  Returns the locked balance of a user, representing funds locked for entry fees.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.

- **Return Values:**  
  - `uint256` — The locked balance amount.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 7. `liveGameFunds()`

- **Description:**  
  Processes the entry fee and gas fee payment from the user. Deducts fees from user balance or transfers USDC from the user's wallet. Transfers gas fee and admin fee to the respective wallets and locks the remaining entry fee amount for the user.

- **Parameters:** None

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** None

- **Events Emitted:**  
  - `LockedBalance`  
  - `AdminFeeTransferred`

---

### 8. `getRequiredUSDCApproval(address user)`

- **Description:**  
  Returns the amount of USDC approval the user must grant to the contract to cover entry and gas fees.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.

- **Return Values:**  
  - `uint256` — The required USDC approval amount.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 9. `withdrawBalance(uint256 amount)`

- **Description:**  
  Allows a user to withdraw a specified amount of their available balance.

- **Parameters:**  
  - `amount`: `uint256` — The amount to withdraw.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `nonReentrant`

- **Events Emitted:**  
  - `BalanceWithdrawn`

---

### 10. `getBalance(address user)`

- **Description:**  
  Returns the available balance of a user.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.

- **Return Values:**  
  - `uint256` — The user's available balance.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 11. `processPayment(address user, GameType gameType)`

- **Description:**  
  Deducts the entry fee (minus admin fee) from the user's locked balance and adds it to the current game's prize pool.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.  
  - `gameType`: `GameType` (enum) — The type of game.

- **Return Values:**  
  - `bool` — Returns true if payment processed successfully.

- **Visibility:** `private`

- **Modifiers:** None

---

### 12. `createAndLockPortfolio(address user, bytes32[] calldata symbols, uint256[] calldata tokenQtys, GameType gameType, bool isApe, bytes memory signature)`

- **Description:**  
  Creates and locks a portfolio for a user with exactly 8 assets and their quantities. Verifies the owner's signature for authorization. Deducts entry fee if not an Ape portfolio. Locks the portfolio and associates it with the current game.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.  
  - `symbols`: `bytes32[]` — Array of exactly 8 asset symbols.  
  - `tokenQtys`: `uint256[]` — Array of exactly 8 token quantities.  
  - `gameType`: `GameType` (enum) — The type of game.  
  - `isApe`: `bool` — Whether this portfolio is the AI-generated Ape portfolio.  
  - `signature`: `bytes` — Owner's signature for verification.

- **Return Values:**  
  - `uint256` — The newly created portfolio ID.

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `PortfolioCreated`

---

### 13. `createGame(uint256 startTime, uint256 endTime, GameType gameType)`

- **Description:**  
  Creates a new game with specified start and end times and game type. Ensures no active game of the same type exists.

- **Parameters:**  
  - `startTime`: `uint256` — Timestamp for game start.  
  - `endTime`: `uint256` — Timestamp for game end.  
  - `gameType`: `GameType` (enum) — The type of game.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `GameCreated`

---

### 14. `calculateWinners(uint256 gameId, uint256 batchSize)`

- **Description:**  
  Calculates winners for a game in batches by comparing portfolio values against the Ape portfolio. Updates winners list and emits progress events.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.  
  - `batchSize`: `uint256` — Number of portfolios to process in this batch.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `WinnersCalculationProgress`  
  - `WinnersCalculationComplete`

---

### 15. `isWinnersCalculationComplete(uint256 gameId)`

- **Description:**  
  Returns whether the winners calculation for a game is complete.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.

- **Return Values:**  
  - `bool` — True if winners calculation is complete, false otherwise.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 16. `endGame(uint256 gameId)`

- **Description:**  
  Marks a game as completed. Can only be called after the game has ended.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `GameCompleted`

---

### 17. `distributeRewards(uint256 gameId, uint256 start, uint256 end)`

- **Description:**  
  Distributes rewards to winners in batches. Updates user balances and marks rewards as claimed.

- **Parameters:**  
  - `gameId`: `uint256` — The ID of the game.  
  - `start`: `uint256` — Start index of winners batch.  
  - `end`: `uint256` — End index of winners batch.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `RewardDistributed`  
  - `GameCompleted` (if last batch)

---

### 18. `getPortfolio(address user, uint256 portfolioId)`

- **Description:**  
  Returns detailed information about a user's portfolio including assets, lock status, values, and associated game.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.  
  - `portfolioId`: `uint256` — The portfolio ID.

- **Return Values:**  
  - `symbols`: `bytes32[]` — Array of asset symbols.  
  - `tokenQtys`: `uint256[]` — Array of token quantities.  
  - `isLocked`: `bool` — Whether the portfolio is locked.  
  - `initialValue`: `uint256` — Initial portfolio value.  
  - `currentValue`: `uint256` — Current portfolio value.  
  - `gameId`: `uint256` — Associated game ID.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 19. `getUserPortfolioIds(address user)`

- **Description:**  
  Returns all portfolio IDs owned by a user.

- **Parameters:**  
  - `user`: `address` — The user's wallet address.

- **Return Values:**  
  - `uint256[]` — Array of portfolio IDs.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 20. `getGameStatus(uint256 gameId)`

- **Description:**  
  Returns the status and type of a game.

- **Parameters:**  
  - `gameId`: `uint256` — The game ID.

- **Return Values:**  
  - `GameStatus` — Status of the game.  
  - `GameType` — Type of the game.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 21. `updatePortfolioValue(uint256 portfolioId, uint256 newValue, uint256 gameId, bytes memory signature)`

- **Description:**  
  Updates the current value of a portfolio. Requires owner signature verification. Can only be called before winners are calculated.

- **Parameters:**  
  - `portfolioId`: `uint256` — The portfolio ID.  
  - `newValue`: `uint256` — The new portfolio value.  
  - `gameId`: `uint256` — The game ID.  
  - `signature`: `bytes` — Owner's signature for verification.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

---

### 22. `updateGasFeeWallet(address newWallet)`

- **Description:**  
  Updates the gas fee wallet address.

- **Parameters:**  
  - `newWallet`: `address` — New gas fee wallet address.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

---

### 23. `updateApeWallet(address newWallet)`

- **Description:**  
  Updates the Ape wallet address.

- **Parameters:**  
  - `newWallet`: `address` — New Ape wallet address.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

---

### 24. `getGameWinners(uint256 gameId)`

- **Description:**  
  Returns the list of winning portfolio IDs for a game.

- **Parameters:**  
  - `gameId`: `uint256` — The game ID.

- **Return Values:**  
  - `uint256[]` — Array of winning portfolio IDs.

- **Visibility:** `external view`

- **Modifiers:** None

---

### 25. `emergencyWithdraw(address token, uint256 amount)`

- **Description:**  
  Emergency function to withdraw stuck tokens from the contract. Only callable by the owner.

- **Parameters:**  
  - `token`: `address` — The token contract address.  
  - `amount`: `uint256` — Amount of tokens to withdraw.

- **Return Values:** None

- **Visibility:** `external`

- **Modifiers:** `onlyOwner`

- **Events Emitted:**  
  - `EmergencyWithdraw`

---

## Events

### 1. `PortfolioCreated`

- **Description:**  
  Emitted when a new portfolio is created and locked.

- **Parameters:**  
  - `user`: `address` (indexed) — Owner of the portfolio.  
  - `portfolioId`: `uint256` (indexed) — ID of the created portfolio.  
  - `symbols`: `bytes32[]` — Asset symbols in the portfolio.  
  - `tokenQtys`: `uint256[]` — Quantities of each asset.  
  - `gameId`: `uint256` — Associated game ID.  
  - `initialValue`: `uint256` — Initial portfolio value.

---

### 2. `GameCreated`

- **Description:**  
  Emitted when a new game is created.

- **Parameters:**  
  - `gameId`: `uint256` (indexed) — ID of the created game.  
  - `startTime`: `uint256` — Game start timestamp.  
  - `endTime`: `uint256` — Game end timestamp.

---

### 3. `GameCompleted`

- **Description:**  
  Emitted when a game is marked as completed.

- **Parameters:**  
  - `gameId`: `uint256` (indexed) — ID of the completed game.

---

### 4. `RewardDistributed`

- **Description:**  
  Emitted when a reward is distributed to a portfolio.

- **Parameters:**  
  - `portfolioId`: `uint256` — ID of the rewarded portfolio.  
  - `amount`: `uint256` — Amount of reward distributed.

---

### 5. `WinningsWithdrawn`

- **Description:**  
  Emitted when a user withdraws winnings.

- **Parameters:**  
  - `user`: `address` (indexed) — User withdrawing winnings.  
  - `amount`: `uint256` — Amount withdrawn.

---

### 6. `LockedBalance`

- **Description:**  
  Emitted when a user's balance is locked for entry fee.

- **Parameters:**  
  - `user`: `address` (indexed) — User whose balance is locked.  
  - `amount`: `uint256` — Amount locked.

---

### 7. `BalanceWithdrawn`

- **Description:**  
  Emitted when a user withdraws balance.

- **Parameters:**  
  - `user`: `address` (indexed) — User withdrawing balance.  
  - `amount`: `uint256` — Amount withdrawn.

---

### 8. `WinnersCalculationProgress`

- **Description:**  
  Emitted during batch processing of winners calculation.

- **Parameters:**  
  - `gameId`: `uint256` — Game ID.  
  - `processedCount`: `uint256` — Number of portfolios processed so far.  
  - `totalCount`: `uint256` — Total portfolios to process.

---

### 9. `WinnersCalculationComplete`

- **Description:**  
  Emitted when winners calculation is complete.

- **Parameters:**  
  - `gameId`: `uint256` — Game ID.  
  - `winnerCount`: `uint256` — Number of winners.

---

### 10. `AdminFeeTransferred`

- **Description:**  
  Emitted when admin and gas fees are transferred.

- **Parameters:**  
  - `user`: `address` (indexed) — User paying fees.  
  - `adminFee`: `uint256` — Admin fee amount.  
  - `gasFee`: `uint256` — Gas fee amount.

---

### 11. `SignerAdded`

- **Description:**  
  Emitted when a signer is added. *(Note: No signer management functions in current contract)*

- **Parameters:**  
  - `signer`: `address` (indexed) — Signer address added.

---

### 12. `SignerRemoved`

- **Description:**  
  Emitted when a signer is removed. *(Note: No signer management functions in current contract)*

- **Parameters:**  
  - `signer`: `address` (indexed) — Signer address removed.

---

### 13. `EmergencyWithdraw`

- **Description:**  
  Emitted when an emergency withdrawal of tokens is performed.

- **Parameters:**  
  - `token`: `address` (indexed) — Token contract address.  
  - `amount`: `uint256` — Amount withdrawn.  
  - `recipient`: `address` (indexed) — Recipient address.

---

## Errors

The contract uses `require` statements with revert messages for error handling. Notable errors include:

- "Invalid USDC token address" — When USDC token address is zero during construction.
- "Invalid gas fee wallet address" — When gas fee wallet address is zero during construction.
- "Invalid ape wallet address" — When Ape wallet address is zero during construction.
- "No game exists for this type" — When querying current game for a type with no active game.
- "Game not active" — When an operation requires an active game but the game is not active.
- "Game has ended" — When an operation requires the game to be ongoing but it has ended.
- "Game not ended yet" — When an operation requires the game to be ended but it is still ongoing.
- "Invalid signature" — When signature verification fails.
- "Must select exactly 8 assets" — When portfolio asset count is not exactly 8.
- "Must provide 8 token quantities" — When portfolio token quantities count is not exactly 8.
- "Payment failed" — When payment processing fails.
- "Batch size must be greater than 0" — When batch size for winner calculation is zero.
- "No portfolios in game" — When no portfolios exist in a game during winner calculation.
- "Winners already calculated" — When trying to calculate winners again.
- "Amount must be greater than 0" — When withdrawing zero or negative amounts.
- "Insufficient balance" — When withdrawing more than available balance.
- "Portfolio not found or not owned by user" — When accessing a portfolio not owned by the user.
- "Portfolio not found" — When portfolio ownership or existence checks fail.
- "Value exceeds maximum limit" — When updating portfolio value beyond allowed max.
- "User does not have enough Locked Balance" — When user locked balance is insufficient for payment.
- "Current game still active" — When trying to create a new game while current is active.
- "Invalid start time" / "Invalid end time" — When game start/end times are invalid.
- "Invalid wallet address" — When updating wallet addresses to zero address.
- "Amount must be greater than 0" — When emergency withdrawing zero or negative amounts.
- "Invalid token address" — When emergency withdrawing from zero token address.

---

## Additional Features and Considerations

- **Signature Verification:**  
  Critical functions like portfolio creation and portfolio value updates require owner signature verification to ensure authorized actions.

- **Portfolio Locking:**  
  Portfolios are locked upon creation and cannot be modified afterward, ensuring fairness during the game.

- **Entry Fee and Fees Handling:**  
  Entry fees are deducted in USDC, with a portion allocated as admin fee and gas fee transferred to designated wallets.

- **Game Lifecycle Management:**  
  Games are created with start and end times, and their status is tracked (NONE, ACTIVE, COMPLETED).

- **Batch Processing:**  
  Winner calculation and reward distribution are designed to be processed in batches to handle gas limits.

- **Emergency Withdraw:**  
  Owner can withdraw stuck tokens from the contract in emergencies.

- **Role of Owner:**  
  The contract owner has administrative privileges including creating games, calculating winners, distributing rewards, updating wallets, and emergency withdrawals.

- **No Custom Errors:**  
  The contract uses revert strings for error handling instead of custom error types.

- **Constants:**  
  - Initial portfolio value is 100,000 USDC (scaled by 1e18).  
  - Entry fee is 5 USDC.  
  - Gas fee is 0.1 USDC.  
  - Admin fee is 10% of entry fee.  
  - Portfolios must have exactly 8 assets.

- **Game Types:**  
  Supports two game types: DEFI and TRADFI.

- **Mappings:**  
  Extensive mappings track user balances, portfolios, games, winners, and rewards.

---

This documentation provides a comprehensive overview of the FusioFantasyGame smart contract, its methods, events, errors, and key features.
