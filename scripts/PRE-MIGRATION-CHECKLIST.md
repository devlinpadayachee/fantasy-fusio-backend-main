# Pre-Migration Checklist
## 🚨 CRITICAL: Complete ALL Steps Before Migration

This migration is **IRREVERSIBLE** in production. You must verify everything works before proceeding.

---

## Phase 1: Environment Setup ✅

### 1.1 Install MongoDB Tools
```bash
# Check if mongodump and mongorestore are installed
mongodump --version
mongorestore --version
```

**Expected Output:**
```
mongodump version: 100.x.x
mongorestore version: 100.x.x
```

**If not installed:**
- Download from: https://www.mongodb.com/try/download/database-tools
- Add to PATH
- Verify installation again

**Status:** [ ] PASS / [ ] FAIL

---

### 1.2 Verify Environment Variables
```bash
# Check that MONGODB_URI is set correctly
cd fantasy-fusio-backend-main
cat .env | grep MONGODB_URI
```

**Verify:**
- [ ] MONGODB_URI is set and correct
- [ ] Can connect to the database
- [ ] Have read/write permissions
- [ ] Not accidentally pointing to production (if testing on staging)

**Status:** [ ] PASS / [ ] FAIL

---

### 1.3 Check Disk Space
```bash
# Check available disk space (need 2x database size)
df -h .
```

**Requirements:**
- Need space for: Current DB + Backup + Some buffer
- If your DB is 100 MB, need at least 300 MB free

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 2: Create Test Environment 🧪

### 2.1 DO NOT TEST ON PRODUCTION FIRST!

**Create a staging/test environment:**

1. **Option A: Local Test Database**
   ```bash
   # Copy production data to local test DB
   mongodump --uri="PRODUCTION_URI" --out=./temp-prod-backup
   mongorestore --uri="mongodb://localhost:27017/fantasy-fusion-test" ./temp-prod-backup
   ```

2. **Option B: Cloud Staging Database**
   - Create a new MongoDB database (staging)
   - Restore production backup to staging
   - Update `.env` to point to staging

**Status:** [ ] Test environment created

---

### 2.2 Verify Test Data
```bash
# Connect to test database and verify data looks correct
npm run migrate:check
```

**Expected:** Should show documents that need migration

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 3: Code Verification 🔍

### 3.1 Review Model Changes

**Check these files have String types for monetary fields:**

```bash
# Users model
grep -A2 "totalEarnings\|currentBalance\|lockedBalance" src/models/User.js
```

**Expected:**
```javascript
totalEarnings: {
  type: String,
  default: "0",
},
currentBalance: {
  type: String,
  default: "0",
},
lockedBalance: {
  type: String,
  default: "0",
},
```

**Status:** [ ] PASS / [ ] FAIL

---

```bash
# Transaction model
grep -A2 "amount:\|gasUsed:\|gasPrice:\|networkFee:" src/models/Transaction.js
```

**Expected:** All should be `type: String`

**Status:** [ ] PASS / [ ] FAIL

---

```bash
# Game model
grep -A2 "totalPrizePool:" src/models/Game.js
```

**Expected:** `type: String`

**Status:** [ ] PASS / [ ] FAIL

---

```bash
# Portfolio model
grep -A2 "reward:" src/models/Portfolio.js
```

**Expected:** `type: String`

**Status:** [ ] PASS / [ ] FAIL

---

### 3.2 Verify BigInt Arithmetic

**Check User model methods use BigInt:**

```bash
# Check updateBalance, lockBalance, unlockBalance methods
grep -A10 "updateBalance\|lockBalance\|unlockBalance" src/models/User.js | grep BigInt
```

**Expected:** Should see `BigInt` usage in all three methods

**Status:** [ ] PASS / [ ] FAIL

---

### 3.3 Verify API Conversions

**Check that APIs convert wei to dollars:**

```bash
# Check auth controller
grep -A5 "weiToUSDC" src/controllers/auth.controller.js

# Check admin controllers
grep -A5 "weiToUSDC" src/controllers/asset-admin.controller.js
```

**Expected:** All monetary fields should be converted using `weiToUSDC` helper

**Status:** [ ] PASS / [ ] FAIL

---

### 3.4 Verify Frontend Removed Wei Conversions

```bash
# Should NOT find any 1e18 divisions in these files
cd ../fantasy-fusio-frontend-main
grep -r "/ 1e18\|/1e18" src/app src/components src/utils
```

**Expected:** No results (or only comments)

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 4: Test Migration on Staging 🧪

### 4.1 Run Migration Check
```bash
cd ../fantasy-fusio-backend-main
npm run migrate:check
```

**Document the output:**
- Users needing migration: _____
- Transactions needing migration: _____
- Games needing migration: _____
- Portfolios needing migration: _____

**Status:** [ ] DOCUMENTED

---

### 4.2 Create Manual Backup First
```bash
npm run db:backup
```

**Verify:**
- [ ] Backup completed successfully
- [ ] Backup size looks reasonable
- [ ] All collections backed up

**Backup Path:** ________________________________

**Status:** [ ] PASS / [ ] FAIL

---

### 4.3 Run Migration on Test Database
```bash
npm run migrate:run
```

**Monitor for:**
- [ ] Backup created automatically
- [ ] No errors during migration
- [ ] All documents migrated
- [ ] Duration was reasonable

**Status:** [ ] PASS / [ ] FAIL

---

### 4.4 Verify Migration Results
```bash
npm run migrate:check
```

**Expected:** "✅ All documents are already migrated!"

**Status:** [ ] PASS / [ ] FAIL

---

### 4.5 Inspect Migrated Data

**Connect to database and verify:**

```bash
# Using MongoDB shell or Compass
# Check a few sample documents

# Sample User:
db.users.findOne({}, {totalEarnings: 1, currentBalance: 1, lockedBalance: 1})

# Sample Transaction:
db.transactions.findOne({}, {amount: 1, gasUsed: 1, gasPrice: 1, networkFee: 1})

# Sample Game:
db.games.findOne({}, {totalPrizePool: 1})

# Sample Portfolio with reward:
db.portfolios.findOne({"gameOutcome.reward": {$exists: true}}, {"gameOutcome.reward": 1})
```

**Verify all monetary fields are STRINGS not NUMBERS:**

**Example correct format:**
```javascript
{
  totalEarnings: "5000000000000000000",  // ✅ String
  currentBalance: "100000000000000000",   // ✅ String
}
```

**Example WRONG format:**
```javascript
{
  totalEarnings: 5000000000000000000,    // ❌ Number
  currentBalance: 1e+17,                  // ❌ Scientific notation
}
```

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 5: Test Backend API 🔧

### 5.1 Start Test Backend
```bash
npm start
```

**Status:** [ ] Server started successfully

---

### 5.2 Test User Authentication & Balance

**Create a test script or use Postman:**

```bash
# Test user login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","walletAddress":"0x..."}'
```

**Verify Response:**
- [ ] `currentBalance` is a number (in dollars, not wei)
- [ ] `totalEarnings` is a number (in dollars, not wei)
- [ ] `lockedBalance` is a number (in dollars, not wei)
- [ ] Values look reasonable (e.g., 5.00, not 5000000000000000000)

**Example correct response:**
```json
{
  "user": {
    "currentBalance": 100.50,
    "totalEarnings": 523.75,
    "lockedBalance": 45.00
  }
}
```

**Status:** [ ] PASS / [ ] FAIL

---

### 5.3 Test Admin APIs

**Test transaction history:**
```bash
# Get transactions (with admin token)
curl http://localhost:5000/api/admin/transactions \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Verify:**
- [ ] `amount` is in dollars (e.g., 5.00)
- [ ] `networkFees` is in dollars (e.g., 0.000123)
- [ ] No scientific notation (1e+17)
- [ ] No NaN or Infinity values

**Status:** [ ] PASS / [ ] FAIL

---

**Test games API:**
```bash
curl http://localhost:5000/api/admin/games \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Verify:**
- [ ] `prizePool` is in dollars (e.g., 500.00)
- [ ] Values look reasonable

**Status:** [ ] PASS / [ ] FAIL

---

**Test users API:**
```bash
curl http://localhost:5000/api/admin/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Verify:**
- [ ] `totalEarnings` is in dollars
- [ ] `lockedBalance` is in dollars
- [ ] No long strings or scientific notation

**Status:** [ ] PASS / [ ] FAIL

---

### 5.4 Test Analytics

```bash
curl http://localhost:5000/api/admin/analytics?filter=weekly \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Verify:**
- [ ] `revenueGenerated` looks correct
- [ ] `averageInvestmentPerUser` looks correct
- [ ] No NaN values
- [ ] No infinity values

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 6: Test Frontend 🎨

### 6.1 Start Frontend
```bash
cd ../fantasy-fusio-frontend-main
npm run dev
```

**Status:** [ ] Frontend started

---

### 6.2 Test User Dashboard

**Login and check dashboard:**

- [ ] Balance displays correctly (e.g., "$100.50")
- [ ] Total earnings displays correctly
- [ ] No scientific notation visible
- [ ] No "NaN" or "Infinity" text
- [ ] No extremely long numbers
- [ ] Leaderboard shows correct earnings

**Status:** [ ] PASS / [ ] FAIL

---

### 6.3 Test Transaction History

**Navigate to transaction history:**

- [ ] Transaction amounts display correctly
- [ ] Network fees display correctly
- [ ] No formatting issues
- [ ] All values are human-readable

**Status:** [ ] PASS / [ ] FAIL

---

### 6.4 Test Game Views

**Check game details:**

- [ ] Prize pools display correctly
- [ ] Winner rewards display correctly
- [ ] Game history shows correct amounts
- [ ] No visual glitches

**Status:** [ ] PASS / [ ] FAIL

---

### 6.5 Test Admin Dashboard

**Login to admin panel:**

- [ ] Analytics numbers display correctly
- [ ] Revenue/fees show as dollars
- [ ] User list shows correct earnings
- [ ] Transaction list shows correct amounts
- [ ] Game list shows correct prize pools
- [ ] No "NaN" or "Infinity" anywhere

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 7: Test Critical Flows End-to-End 🔄

### 7.1 Test New User Registration

**Create a new user:**

1. Register/connect wallet
2. Check initial balances are "0"
3. Verify database has strings: `"0"` not `0`

**Status:** [ ] PASS / [ ] FAIL

---

### 7.2 Test Portfolio Creation (If Possible)

**Try to create a portfolio:**

1. Connect wallet with USDC
2. Approve USDC
3. Create portfolio
4. Verify balance deduction works correctly
5. Check database that amounts are stored as strings

**Status:** [ ] PASS / [ ] FAIL / [ ] SKIPPED (if no test funds)

---

### 7.3 Test Balance Operations

**Test User model methods work:**

Create a test script:

```javascript
// test-balance-operations.js
const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function testBalanceOperations() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Find a test user
  const user = await User.findOne({});
  console.log('Initial balance:', user.currentBalance);

  // Test updateBalance
  await user.updateBalance("5000000000000000000"); // 5 USDC
  await user.reload();
  console.log('After update:', user.currentBalance);

  // Verify it's a string
  console.log('Type:', typeof user.currentBalance);
  console.log('Is string:', typeof user.currentBalance === 'string');

  await mongoose.disconnect();
}

testBalanceOperations();
```

**Expected:**
- Balance should be updated
- Type should be "string"
- No errors

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 8: Performance & Edge Cases 🏃

### 8.1 Test Large Numbers

**Verify large amounts don't break:**

```javascript
// Check if BigInt handles very large values
const testAmount = "999999999999999999999"; // Very large
console.log(BigInt(testAmount).toString()); // Should work
```

**Status:** [ ] PASS / [ ] FAIL

---

### 8.2 Test Zero Values

**Verify zero handling:**

- [ ] User with 0 balance displays as "$0.00"
- [ ] Transaction with 0 fee displays correctly
- [ ] No division by zero errors

**Status:** [ ] PASS / [ ] FAIL

---

### 8.3 Test Negative Values (Edge Case)

**Check error handling:**

- Should not be possible, but verify system handles gracefully
- No crashes if somehow negative value appears

**Status:** [ ] PASS / [ ] FAIL

---

### 8.4 Check Database Indexes Still Work

```bash
# Verify indexes are functioning
db.users.getIndexes()
```

**Verify:**
- [ ] All indexes still present
- [ ] Queries using indexes are fast

**Status:** [ ] PASS / [ ] FAIL

---

### 8.5 Monitor Server Logs

**Start backend and watch logs:**

```bash
npm start | tee server-test.log
```

**Use the app and check for:**
- [ ] No "NaN" in logs
- [ ] No "Infinity" in logs
- [ ] No BigInt conversion errors
- [ ] No MongoDB type errors
- [ ] No precision loss warnings

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 9: Test Restore Process 🔄

### 9.1 Test Restore from Backup

**CRITICAL: Verify you can restore if something goes wrong**

```bash
# List backups
npm run db:restore

# Select a backup and restore it
# (Type 'cancel' when prompted, just testing the UI)
```

**Verify:**
- [ ] Backup list displays correctly
- [ ] Restore process prompts for confirmation
- [ ] Command syntax is correct

**Status:** [ ] PASS / [ ] FAIL

---

### 9.2 Actually Restore Once

**Do a real restore to verify it works:**

```bash
# Create a fresh backup
npm run db:backup

# Make a small change to test data
# (e.g., update one user's balance manually)

# Restore from backup
npm run db:restore
# Select the backup you just made

# Verify data is restored correctly
```

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 10: Load Testing (Optional but Recommended) 📊

### 10.1 Simulate Multiple Requests

**Use a tool like Apache Bench or k6:**

```bash
# Example: 100 requests to dashboard
ab -n 100 -c 10 http://localhost:5000/api/game/leaderboard/global
```

**Monitor:**
- [ ] Response times acceptable
- [ ] No memory leaks
- [ ] No crashes
- [ ] Consistent results

**Status:** [ ] PASS / [ ] FAIL / [ ] SKIPPED

---

## Phase 11: Final Staging Verification ✅

### 11.1 Run All Tests

**If you have automated tests:**

```bash
npm test
```

**Status:** [ ] PASS / [ ] FAIL / [ ] NO TESTS

---

### 11.2 Leave Staging Running

**Monitor for 24 hours if possible:**

- [ ] Check for any delayed issues
- [ ] Monitor error logs
- [ ] Verify no memory leaks
- [ ] Check database performance

**Status:** [ ] PASS / [ ] FAIL

---

## Phase 12: Document Everything 📝

### 12.1 Record Current State

**Before production migration, document:**

- Total users: _____
- Total transactions: _____
- Total games: _____
- Total portfolios: _____
- Database size: _____ MB
- Backup size: _____ MB
- Expected migration time: _____ seconds

**Status:** [ ] DOCUMENTED

---

### 12.2 Create Rollback Plan

**Write down exact steps to rollback:**

1. Stop application immediately
2. Run restore command: `mongorestore --uri="..." --drop ./backups/[BACKUP_NAME]`
3. Restart application with OLD code (before string changes)
4. Verify app is working
5. Notify users if needed

**Status:** [ ] DOCUMENTED

---

### 12.3 Prepare Communication

**If this affects users, prepare:**

- [ ] Maintenance window announcement
- [ ] Expected downtime duration
- [ ] What users should expect
- [ ] Contact for issues

**Status:** [ ] PREPARED / [ ] NOT NEEDED

---

## Phase 13: Production Migration Plan 🚀

### 13.1 Schedule Maintenance Window

**Best time to run:**
- [ ] Off-peak hours chosen
- [ ] Team members available
- [ ] At least 2 people present
- [ ] Rollback plan ready

**Scheduled for:** _______________

---

### 13.2 Pre-Migration Steps

**On migration day, before starting:**

1. [ ] Announce maintenance to users
2. [ ] Stop accepting new transactions (put site in maintenance mode)
3. [ ] Wait for all pending operations to complete
4. [ ] Verify no users currently active
5. [ ] Stop the backend application
6. [ ] Stop any cron jobs
7. [ ] Stop any worker processes

---

### 13.3 Migration Steps

1. [ ] Pull latest code with String models
2. [ ] Verify code is correct version
3. [ ] Run `npm run migrate:run` on production
4. [ ] Monitor progress
5. [ ] Verify completion
6. [ ] Run `npm run migrate:check` to confirm
7. [ ] Start backend with new code
8. [ ] Smoke test critical endpoints
9. [ ] Remove maintenance mode
10. [ ] Monitor closely for 1 hour

---

### 13.4 Post-Migration

1. [ ] Test user login
2. [ ] Test transaction display
3. [ ] Test admin dashboard
4. [ ] Monitor error logs
5. [ ] Check database performance
6. [ ] Verify balances display correctly
7. [ ] Test one end-to-end flow (if safe)

---

## ✅ FINAL GO/NO-GO DECISION

**ALL of the following must be TRUE before production migration:**

- [ ] All Phase 1-12 checks passed
- [ ] Staging has been running successfully for 24+ hours
- [ ] Backup and restore process tested and working
- [ ] Team is ready and available
- [ ] Rollback plan is documented and understood
- [ ] Off-peak time window scheduled
- [ ] All stakeholders notified
- [ ] No other critical updates planned for same day

## 🚨 IF ANY ITEM ABOVE IS UNCHECKED: DO NOT PROCEED! 🚨

**Sign-off:**

- Technical Lead: _________________ Date: _______
- DevOps: _________________ Date: _______
- Tester: _________________ Date: _______

---

## Emergency Contacts

**If migration fails:**

1. **STOP IMMEDIATELY**
2. Do not proceed with troubleshooting
3. Run restore: `npm run db:restore [BACKUP_NAME]`
4. Revert code to previous version
5. Restart application
6. Investigate issue on staging
7. Fix and re-test before attempting again

**Team Contacts:**
- Lead Developer: _________________
- DevOps: _________________
- Database Admin: _________________

---

## Appendix: Common Issues

### Issue: "mongodump not found"
**Solution:** Install MongoDB Database Tools

### Issue: Migration fails midway
**Solution:** Run restore immediately, investigate on staging

### Issue: Values showing as NaN
**Solution:** Backend not converting wei to dollars properly, check API controllers

### Issue: Scientific notation visible
**Solution:** Frontend receiving raw numbers, check API responses

### Issue: "Cannot read property 'toString' of undefined"
**Solution:** Some documents have null values, migration script should handle this

---

**Last Updated:** [Current Date]
**Version:** 1.0

