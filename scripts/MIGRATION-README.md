# Wei to String Migration Guide

## Overview

This migration converts all monetary fields (wei values) from `Number` to `String` type in MongoDB to prevent JavaScript integer overflow issues.

### Why This Migration is Critical

JavaScript's `Number` type can only safely represent integers up to `2^53 - 1` (9,007,199,254,740,991). Wei values frequently exceed this limit:

- **5 USDC** = `5,000,000,000,000,000,000` wei (safe)
- **100 USDC** = `100,000,000,000,000,000,000` wei ❌ **EXCEEDS SAFE INTEGER!**

Without this migration, large transactions will experience precision loss and data corruption.

## Affected Collections & Fields

### 1. Users
- `totalEarnings` (Number → String)
- `currentBalance` (Number → String)
- `lockedBalance` (Number → String)

### 2. Transactions
- `amount` (Number → String)
- `gasUsed` (Number → String)
- `gasPrice` (Number → String)
- `networkFee` (Number → String)

### 3. Games
- `totalPrizePool` (Number → String)

### 4. Portfolios
- `gameOutcome.reward` (Number → String)

## Available Scripts

All migration and backup scripts are available via npm commands:

```bash
# Database Backup & Restore
npm run db:backup          # Create a timestamped backup
npm run db:restore         # Restore from backup (interactive)

# Migration Scripts
npm run migrate:check      # Check which documents need migration (dry-run)
npm run migrate:run        # Run the migration (auto-creates backup first)
npm run migrate:rollback   # Rollback migration (emergency only)
```

## Migration Steps

### Step 1: Check Current Status (Dry Run)

First, check which documents need migration without making any changes:

```bash
cd fantasy-fusio-backend-main
node scripts/check-migration-status.js
```

This will show you:
- How many documents need migration
- Current data type distribution (Number vs String)
- Which fields need updating

**Example Output:**
```
📊 Checking users...
  Total documents: 150
  Need migration: 150
    totalEarnings:
      - Numbers: 150 ⚠️
      - Strings: 0 ✅

⚠️  Migration is required!
   Run: node scripts/migrate-wei-to-string.js
```

### Step 2: Backup Your Database

**CRITICAL: The migration script will automatically create a backup!**

But you can also create manual backups anytime:

```bash
# Automatic backup (recommended - saves to backups/ directory)
npm run db:backup

# Manual backup using mongodump
mongodump --uri="YOUR_MONGODB_URI" --out=./manual-backup-$(date +%Y%m%d)

# MongoDB Atlas (if using cloud)
# Use Atlas UI to create a snapshot
```

The automatic backup script will:
- ✅ Create timestamped backup in `backups/` directory
- ✅ Show backup size and duration
- ✅ List all collections backed up
- ✅ Keep only the 5 most recent backups
- ✅ Provide restore command

### Step 3: Stop Your Application

Ensure no writes are happening during migration:

```bash
# Stop your backend server
pm2 stop fantasy-fusion-backend
# or
pkill -f "node.*server.js"
```

### Step 4: Run the Migration

The migration script will **automatically create a backup** before making any changes!

```bash
cd fantasy-fusio-backend-main
npm run migrate:run
```

**Expected Output:**
```
🚀 Starting Wei to String Migration
==================================

📍 Database: mongodb://...

⚠️  This migration will convert all monetary Number fields to Strings.
⚠️  A backup will be created automatically before migration.

Do you want to continue? (yes/no): yes

💾 Creating database backup first...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Checking if mongodump is installed...
✅ mongodump is available

📦 Creating backup: backup-2024-01-15-14-30-00

⏳ This may take a few moments...

✅ Backup completed successfully!

📊 Backup Details:
  Location: /path/to/backups/backup-2024-01-15-14-30-00
  Size: 45.23 MB
  Duration: 3.45s

📚 Collections backed up:
  - users (1.23 MB)
  - transactions (15.67 MB)
  - games (2.34 MB)
  - portfolios (25.99 MB)

💡 To restore this backup, run:
   mongorestore --uri="..." --drop "/path/to/backup"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Backup created successfully!
📦 Backup location: /path/to/backups/backup-2024-01-15-14-30-00

💡 If migration fails, restore with:
   mongorestore --uri="..." --drop "/path/to/backup"

Backup complete. Proceed with migration? (yes/no): yes

🔄 Starting migration...

🔌 Connecting to MongoDB...
✅ Connected to MongoDB

📈 Collection Counts:
  - Users: 150
  - Transactions: 523
  - Games: 45
  - Portfolios: 892

📊 Migrating Users collection...
  ✓ Processed 100 users...
  ✓ Processed 150 users...
✅ Users migration complete: 150 updated, 0 errors

[... similar output for other collections ...]

🎉 Migration Complete!
=====================

📊 Summary:
  Users:        150 updated, 0 errors
  Transactions: 523 updated, 0 errors
  Games:        45 updated, 0 errors
  Portfolios:   892 updated, 0 errors

  Total: 1610 documents updated, 0 errors

✅ All done! No errors.
```

### Step 5: Verify Migration

Run the check script again to verify all documents are migrated:

```bash
node scripts/check-migration-status.js
```

Expected output:
```
✅ All documents are already migrated!
```

### Step 6: Deploy Updated Code

Deploy the updated models and API code:

```bash
# Pull latest code with updated models
git pull origin main

# Install dependencies (if any new ones)
npm install

# Restart your application
pm2 restart fantasy-fusion-backend
# or
npm start
```

### Step 7: Test the Application

Test critical flows:
- ✅ User login and balance display
- ✅ Create portfolio / enter game
- ✅ View transaction history
- ✅ Game completion and reward distribution
- ✅ Admin dashboard analytics

## Restoring from Backup

If something goes wrong during migration, you can restore from the automatic backup:

### Option 1: Automatic Restore (Interactive)

```bash
npm run db:restore
```

This will:
1. Show you all available backups
2. Let you choose which one to restore
3. Require double confirmation (for safety)
4. Restore the selected backup

### Option 2: Restore Specific Backup

```bash
npm run db:restore backup-2024-01-15-14-30-00
```

### Option 3: Manual Restore (Using mongorestore)

```bash
mongorestore --uri="YOUR_MONGODB_URI" --drop ./backups/backup-2024-01-15-14-30-00
```

The `--drop` flag will drop existing collections before restoring (recommended).

## Rollback (Emergency Only)

⚠️ **WARNING: Rollback will cause precision loss for large values!**

Only use this if you need to revert the migration immediately without restoring from backup:

```bash
npm run migrate:rollback
```

You will be prompted to confirm. The script will convert all String values back to Numbers, but **large wei values will lose precision**.

## Troubleshooting

### Migration Failed with Errors

If the migration script reports errors:

1. Check the error messages in the console
2. Verify MongoDB connection string in `.env`
3. Ensure you have write permissions to the database
4. Check if any documents have corrupt data
5. Restore from backup if needed

### Application Errors After Migration

If your application shows errors after migration:

1. **"Cannot read property 'toString' of undefined"**
   - Some documents may have null/undefined values
   - The migration script handles this, but check your queries

2. **"Invalid amount value"**
   - Ensure all API endpoints are updated to handle strings
   - Check that BigInt conversions are working correctly

3. **Balance showing as NaN or wrong**
   - Clear browser cache and localStorage
   - Check that frontend is using the updated API responses

### Partial Migration

If migration was interrupted:

1. The script is idempotent (safe to run multiple times)
2. Run `check-migration-status.js` to see what's left
3. Run `migrate-wei-to-string.js` again
4. It will only update documents that still need migration

## Technical Details

### BigInt Usage

All monetary arithmetic now uses JavaScript's `BigInt` type:

```javascript
// Old (unsafe)
this.currentBalance += amount; // May overflow!

// New (safe)
const currentBalance = BigInt(this.currentBalance || "0");
const addAmount = BigInt(amount);
this.currentBalance = (currentBalance + addAmount).toString();
```

### API Conversion

Backend APIs convert wei strings to USDC dollars before sending to frontend:

```javascript
const weiToUSDC = (weiValue) => {
  if (!weiValue) return 0;
  const weiStr = String(weiValue);
  return parseFloat(ethers.utils.formatUnits(weiStr, 18));
};

// Example
const balanceWei = "5000000000000000000"; // from DB
const balanceUSDC = weiToUSDC(balanceWei); // 5.00
```

### Frontend Changes

Frontend no longer performs wei conversions - all values come as dollars:

```javascript
// Old
const balance = userProfile.user.currentBalance / 1e18;

// New
const balance = userProfile.user.currentBalance; // Already in USDC
```

## Database Indexes

After migration, ensure indexes are still valid:

```javascript
// These indexes should work fine with String type
db.users.createIndex({ totalEarnings: -1 });
db.users.createIndex({ address: 1 }, { unique: true });
```

Note: String comparison for sorting may behave differently. We handle this in queries:

```javascript
// For sorting by totalEarnings, we convert to number in aggregation
User.aggregate([
  {
    $addFields: {
      totalEarningsNum: { $toDouble: "$totalEarnings" }
    }
  },
  { $sort: { totalEarningsNum: -1 } }
]);
```

## Performance Considerations

- **Storage**: Strings take slightly more space than Numbers (~10-20% more)
- **Queries**: String operations are marginally slower, but negligible for this use case
- **Arithmetic**: BigInt operations are fast and safe for our scale
- **API**: Conversion to dollars happens once per request (minimal overhead)

## Support

If you encounter issues during migration:

1. Check the logs from the migration script
2. Verify your backup is valid and restorable
3. Review the error messages carefully
4. Contact the development team if needed

## Migration Checklist

- [ ] Run `npm run migrate:check` to assess scope
- [ ] Ensure MongoDB tools are installed (`mongodump`, `mongorestore`)
- [ ] Review the migration plan with your team
- [ ] Stop application to prevent writes during migration
- [ ] Run `npm run migrate:run` (will auto-backup and migrate)
- [ ] Verify success with `npm run migrate:check`
- [ ] Keep the backup until verification is complete
- [ ] Deploy updated code
- [ ] Restart application
- [ ] Test critical user flows:
  - [ ] User login and balance display
  - [ ] Portfolio creation and game entry
  - [ ] Transaction history viewing
  - [ ] Game completion and rewards
  - [ ] Withdrawal functionality
  - [ ] Admin dashboard analytics
- [ ] Monitor logs for errors for 24-48 hours
- [ ] Verify balances and transactions display correctly
- [ ] Check that large amounts don't show as NaN or "Infinity"
- [ ] Delete old backup after 7 days (if all is working)

## FAQ

**Q: Do I need to run this migration on development and production?**
A: Yes, run it on each environment separately.

**Q: How long does the migration take?**
A: Depends on document count. ~1-2 seconds per 100 documents.

**Q: Can users use the app during migration?**
A: No, stop the application first to prevent data inconsistencies.

**Q: What if I have millions of documents?**
A: The script processes in batches and shows progress. For very large datasets, consider running during maintenance windows.

**Q: Will this affect my MongoDB Atlas free tier?**
A: The migration is read-heavy but should stay within limits. Monitor your metrics.

**Q: Can I test this on a staging database first?**
A: Absolutely recommended! Copy your production data to staging and test there first.

