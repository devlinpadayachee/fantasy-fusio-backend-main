# GameHistory Migration Plan

## Problem

The `gameHistory` array stored on the User model is:
- ❌ **Redundant** - All data already exists in Portfolio collection
- ❌ **Unbounded growth** - Can exceed MongoDB's 16MB document limit
- ❌ **Performance issue** - Large arrays slow down queries and updates
- ❌ **Not scalable** - Each game adds an entry, growing forever

## Current State

### User Model
```javascript
gameHistory: [
  {
    gameId: Number,
    portfolioId: Number,
    performance: Number,
    earnings: Number,
    rank: Number,
    timestamp: Date,
  }
]
```

### Portfolio Model (Already Has This Data!)
```javascript
{
  userId: ObjectId,      // Reference to User
  gameId: Number,         // Same as gameHistory.gameId
  portfolioId: Number,    // Same as gameHistory.portfolioId
  performancePercentage: Number,  // Same as gameHistory.performance
  gameOutcome: {
    reward: String,       // Same as gameHistory.earnings
    rank: Number,          // Same as gameHistory.rank
  },
  createdAt: Date,        // Same as gameHistory.timestamp
}
```

## Solution

### 1. Remove gameHistory from User Model
- ✅ All data is already in Portfolio collection
- ✅ No data loss
- ✅ Better performance

### 2. Update Code to Use Portfolio Queries

#### Before (Using gameHistory):
```javascript
// ❌ BAD - Reading from User.gameHistory
const user = await User.findById(userId);
const history = user.gameHistory;
```

#### After (Using Portfolio):
```javascript
// ✅ GOOD - Query Portfolio collection
const portfolios = await Portfolio.find({ userId })
  .sort({ createdAt: -1 })
  .populate('gameId');
```

### 3. Update Stats Calculation

#### Before:
```javascript
// ❌ BAD - Checking gameHistory array
const existingEntry = this.gameHistory.find(
  (entry) => entry.gameId === Number(gameId)
);
```

#### After:
```javascript
// ✅ GOOD - Query Portfolio collection
const existingPortfolio = await Portfolio.findOne({
  userId: this._id,
  gameId: Number(gameId)
});
```

## Migration Steps

### Step 1: Run Analysis
```bash
node scripts/migrate-remove-gamehistory.js
```

This will:
- Analyze current gameHistory usage
- Verify Portfolio has equivalent data
- Show statistics

### Step 2: Remove gameHistory Field
The script will remove the field from all User documents.

### Step 3: Update User Model
Remove the `gameHistory` field definition from `src/models/User.js`.

### Step 4: Update `updateGameStats()` Method
Replace gameHistory checks with Portfolio queries.

## Code Changes Required

### 1. User Model (`src/models/User.js`)

**Remove:**
```javascript
gameHistory: [
  {
    gameId: Number,
    portfolioId: Number,
    performance: Number,
    earnings: Number,
    rank: Number,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
],
```

**Update `updateGameStats()` method:**
```javascript
userSchema.methods.updateGameStats = async function (gameId, portfolioId, performance, earnings, rank) {
  try {
    const parsedEarnings = BigInt(earnings || "0");

    // ✅ Check Portfolio instead of gameHistory
    const existingPortfolio = await Portfolio.findOne({
      userId: this._id,
      gameId: Number(gameId),
      portfolioId: { $ne: Number(portfolioId) }
    });

    // Update statistics
    this.totalPortfoliosCreated = (this.totalPortfoliosCreated || 0) + 1;

    // Only increment totalGamesPlayed if it's a new game
    if (!existingPortfolio) {
      this.totalGamesPlayed = (this.totalGamesPlayed || 0) + 1;
    }

    if (parsedEarnings > 0) {
      this.gamesWon += 1;
      const totalEarnings = BigInt(this.totalEarnings || "0");
      this.totalEarnings = (totalEarnings + parsedEarnings).toString();

      // ✅ Check Portfolio for unique wins instead of gameHistory
      const alreadyWonGame = await Portfolio.exists({
        userId: this._id,
        gameId: Number(gameId),
        portfolioId: { $ne: Number(portfolioId) },
        status: "WON"
      });

      if (!alreadyWonGame) {
        this.uniqueGamesWon = (this.uniqueGamesWon || 0) + 1;
      }
    }

    return this.save();
  } catch (error) {
    console.error("Error updating game stats:", error);
    throw error;
  }
};
```

### 2. Add Helper Method for Game History

Add to User model:
```javascript
userSchema.methods.getGameHistory = async function (options = {}) {
  const { limit = 50, page = 1, gameType } = options;

  const query = { userId: this._id };
  if (gameType) {
    query.gameType = gameType.toUpperCase();
  }

  const portfolios = await Portfolio.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('gameId', 'name gameType startTime endTime');

  const total = await Portfolio.countDocuments(query);

  return {
    history: portfolios.map(p => ({
      gameId: p.gameId,
      portfolioId: p.portfolioId,
      performance: p.performancePercentage,
      earnings: p.gameOutcome?.reward || "0",
      rank: p.gameOutcome?.rank,
      timestamp: p.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};
```

## Benefits

✅ **No data loss** - All data already in Portfolio
✅ **Better performance** - No large arrays to load
✅ **Scalable** - Portfolio collection can grow infinitely
✅ **Simpler code** - Single source of truth
✅ **Better queries** - Can filter, sort, paginate easily

## Verification

After migration, verify:
1. ✅ User documents no longer have gameHistory field
2. ✅ Stats still calculate correctly
3. ✅ Game history queries work from Portfolio
4. ✅ No performance degradation

## Rollback Plan

If needed, gameHistory can be reconstructed from Portfolio:
```javascript
// Reconstruct gameHistory from Portfolio (if needed)
const portfolios = await Portfolio.find({ userId });
const gameHistory = portfolios.map(p => ({
  gameId: p.gameId,
  portfolioId: p.portfolioId,
  performance: p.performancePercentage,
  earnings: p.gameOutcome?.reward || 0,
  rank: p.gameOutcome?.rank,
  timestamp: p.createdAt,
}));
```

