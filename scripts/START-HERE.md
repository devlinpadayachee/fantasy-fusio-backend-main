# 🚀 Database Migration: START HERE

## What is this migration?

This migration converts all monetary values in the database from JavaScript `Number` type to `String` type. This is **critical** because:

1. **JavaScript Numbers are unsafe for large values** - They can only safely represent integers up to `2^53 - 1` (9,007,199,254,740,991)
2. **Wei amounts are much larger** - 1 USDC = 1,000,000,000,000,000,000 wei (18 zeros)
3. **Data loss is happening** - Large amounts get converted to scientific notation or lose precision
4. **This breaks calculations** - Especially for balances, rewards, and transaction fees

## 🚨 CRITICAL: This migration is IRREVERSIBLE in production!

You **MUST** follow the complete testing process before running on production.

---

## 📋 Quick Start Guide

### Step 1: Read the Documentation

**Read these files in order:**

1. **`START-HERE.md`** ← You are here
2. **`PRE-MIGRATION-CHECKLIST.md`** ← Complete testing checklist (MANDATORY)
3. **`MIGRATION-README.md`** ← Detailed migration instructions

### Step 2: Install Prerequisites

```bash
# Install MongoDB Database Tools
# Download from: https://www.mongodb.com/try/download/database-tools

# Verify installation
mongodump --version
mongorestore --version
```

### Step 3: Test Conversion Logic

```bash
# This tests the conversion logic WITHOUT touching your database
npm run test:conversions
```

**Expected output:**
```
🧪 Testing Wei to String Conversion Logic
=========================================

Testing Wei to USDC Conversion:

Test 1: 5 USDC
  Input (wei): 5000000000000000000
  Output (USDC): 5
  Expected: 5
  ✅ PASS

[... more tests ...]

📊 Test Summary

✅ Passed: 15
❌ Failed: 0
📈 Total: 15
🎯 Success Rate: 100.0%

🎉 All tests passed! Conversion logic is working correctly.
```

**If any tests fail, DO NOT proceed!**

### Step 4: Create a Test Environment

⚠️ **DO NOT TEST ON PRODUCTION!**

**Option A: Local Test Database**

```bash
# Backup production to local test
mongodump --uri="YOUR_PRODUCTION_URI" --out=./prod-backup
mongorestore --uri="mongodb://localhost:27017/fantasy-fusion-test" ./prod-backup

# Update .env to point to test database
cp .env .env.backup
echo "MONGODB_URI=mongodb://localhost:27017/fantasy-fusion-test" > .env
```

**Option B: Cloud Staging Database**

1. Create a new MongoDB database (staging)
2. Restore production backup to staging
3. Update `.env` to point to staging

### Step 5: Follow the Complete Checklist

Open `PRE-MIGRATION-CHECKLIST.md` and complete **ALL** items.

**Do not skip any steps!**

### Step 6: Run Migration on Test/Staging

```bash
# Check what needs migration
npm run migrate:check

# Run the migration (will auto-backup first)
npm run migrate:run
```

### Step 7: Verify Everything Works

Follow Phase 5-11 in the checklist:
- ✅ Test all backend APIs
- ✅ Test all frontend pages
- ✅ Test critical user flows
- ✅ Run for 24 hours on staging
- ✅ Monitor for any issues

### Step 8: Production Migration (Only After Complete Testing)

**See `PRE-MIGRATION-CHECKLIST.md` Phase 13**

---

## 📂 File Reference

### Scripts

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `backup-database.js` | Create database backup | Anytime, or before migration |
| `restore-database.js` | Restore from backup | If migration fails |
| `test-string-conversions.js` | Test conversion logic | Before any migration |
| `check-migration-status.js` | Check what needs migration | Before and after migration |
| `migrate-wei-to-string.js` | Run the actual migration | After all testing passes |
| `rollback-wei-migration.js` | Emergency rollback | Only if restore doesn't work |

### Commands

```bash
# Testing
npm run test:conversions       # Test conversion logic

# Database Operations
npm run db:backup             # Create backup
npm run db:restore            # Restore from backup (interactive)

# Migration
npm run migrate:check         # Check migration status (safe, read-only)
npm run migrate:run           # Run migration (creates backup first)
npm run migrate:rollback      # Emergency rollback (causes precision loss!)
```

### Documentation

| File | Purpose |
|------|---------|
| `START-HERE.md` | This file - quick start guide |
| `PRE-MIGRATION-CHECKLIST.md` | Complete testing checklist (13 phases) |
| `MIGRATION-README.md` | Detailed migration documentation |

---

## ⚠️ Common Mistakes to Avoid

### ❌ DON'T:

1. **Run migration on production first** - Always test on staging!
2. **Skip the checklist** - Every item is there for a reason
3. **Assume it will work** - Verify everything explicitly
4. **Forget to backup** - The script does it, but double-check!
5. **Run during peak hours** - Schedule maintenance window
6. **Be alone** - Have at least 2 team members present
7. **Rush the process** - Take your time, this is critical
8. **Skip the 24-hour staging test** - Issues may appear over time

### ✅ DO:

1. **Read all documentation first**
2. **Complete the entire checklist**
3. **Test on staging for 24+ hours**
4. **Have a rollback plan ready**
5. **Schedule off-peak hours**
6. **Have team available during migration**
7. **Monitor closely after migration**
8. **Keep backups for 7+ days**

---

## 🆘 What If Something Goes Wrong?

### During Testing (Staging)

**No problem!** That's what testing is for:

1. Restore from backup: `npm run db:restore`
2. Investigate the issue
3. Fix the code
4. Test again

### During Production Migration

**STOP IMMEDIATELY:**

1. **Do not try to fix it** - Just restore
2. Run: `npm run db:restore [backup-name]`
3. Revert code to previous version (before String changes)
4. Restart application
5. Verify app is working
6. Investigate on staging
7. Fix and re-test before attempting again

### Emergency Contacts

**Add your team contacts:**

- Lead Developer: _________________
- DevOps: _________________
- Database Admin: _________________

---

## 📊 Migration Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Setup & Prerequisites | 1-2 hours | Install tools, read docs |
| Code Review | 2-3 hours | Verify all changes |
| Test Environment Setup | 1-2 hours | Create staging with prod data |
| Test Migration Run | 30 min - 2 hours | Depends on data size |
| Verification Testing | 4-8 hours | Test all features thoroughly |
| Staging Monitoring | 24-48 hours | Let it run, monitor logs |
| Production Planning | 2-4 hours | Schedule, prepare rollback |
| Production Migration | 1-3 hours | Actual migration + verification |
| **TOTAL** | **3-5 days** | Do not rush this! |

---

## 🎯 Success Criteria

**Before declaring migration successful:**

✅ All checklist items completed
✅ Staging ran for 24+ hours without issues
✅ All user flows tested and working
✅ No NaN or Infinity values anywhere
✅ Balances display correctly (dollars, not wei)
✅ Transactions show correct amounts
✅ Analytics display reasonable numbers
✅ No errors in logs
✅ Performance is acceptable
✅ Team is confident in the changes

---

## 📞 Need Help?

### Issue: Tests failing

**Check:**
- Are all model files updated with `String` types?
- Are all controllers converting wei to dollars?
- Is frontend NOT dividing by 1e18 anymore?
- Review the code changes in git

### Issue: Migration fails

**Check:**
- Do you have enough disk space?
- Is mongodump installed correctly?
- Is the database connection working?
- Check error messages carefully

### Issue: Values showing as NaN

**Check:**
- Are API controllers using `ethers.utils.formatUnits()`?
- Are they handling null/undefined values?
- Is frontend expecting numbers, not strings?

### Issue: Restore not working

**Check:**
- Is mongorestore installed?
- Are you using the correct backup path?
- Does the backup directory exist?
- Do you have write permissions?

---

## 🚦 GO/NO-GO Decision

**Before production migration, answer these:**

| Question | Answer | Required |
|----------|--------|----------|
| Did all tests pass on staging? | [ ] Yes / [ ] No | ✅ YES |
| Did staging run 24+ hours without issues? | [ ] Yes / [ ] No | ✅ YES |
| Is the team available during migration? | [ ] Yes / [ ] No | ✅ YES |
| Is this an off-peak time? | [ ] Yes / [ ] No | ✅ YES |
| Is backup process tested and working? | [ ] Yes / [ ] No | ✅ YES |
| Is rollback plan documented? | [ ] Yes / [ ] No | ✅ YES |
| Are all stakeholders informed? | [ ] Yes / [ ] No | ✅ YES |
| Is database size within disk capacity? | [ ] Yes / [ ] No | ✅ YES |
| Do we have emergency contacts ready? | [ ] Yes / [ ] No | ✅ YES |

**If ANY answer is NO: DO NOT PROCEED!**

---

## 📈 After Migration

### Immediate (First Hour)

- [ ] Monitor error logs continuously
- [ ] Test critical user flows
- [ ] Check admin dashboard
- [ ] Verify balances display correctly
- [ ] Check for any user reports

### First 24 Hours

- [ ] Monitor server performance
- [ ] Check for any edge cases
- [ ] Review all transaction logs
- [ ] Verify analytics accuracy
- [ ] Monitor database performance

### First Week

- [ ] Continue monitoring
- [ ] Collect user feedback
- [ ] Verify all calculations correct
- [ ] Check for any delayed issues
- [ ] Document any findings

### After 7 Days

- [ ] If everything is working well, can delete old backup
- [ ] Document lessons learned
- [ ] Update runbooks
- [ ] Celebrate! 🎉

---

## 🎓 Understanding the Changes

### What Changed in the Database?

**Before (Number type):**
```javascript
{
  totalEarnings: 5000000000000000000,    // Might become 5e+18
  currentBalance: 100000000000000000,     // Might lose precision
}
```

**After (String type):**
```javascript
{
  totalEarnings: "5000000000000000000",   // Safe, no precision loss
  currentBalance: "100000000000000000",   // Exactly as stored
}
```

### What Changed in the Code?

**Backend Models:**
- All monetary fields now use `type: String`
- Balance operations use `BigInt` for arithmetic
- API controllers convert wei to dollars before sending to frontend

**Backend APIs:**
- Use `ethers.utils.formatUnits(value, 18)` to convert wei to USDC
- Return dollar amounts (e.g., 5.00) not wei (5000000000000000000)

**Frontend:**
- Removed all `/ 1e18` conversions
- Display values directly from API
- No more scientific notation

---

## 📝 Final Notes

**This migration is serious business.** It's changing how money is stored in your database.

**Take your time. Test thoroughly. Don't skip steps.**

If you're unsure about anything, **stop and ask for help.** It's better to delay than to lose data.

**Good luck! 🚀**

---

## 📄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024 | Initial migration documentation |

---

## ✍️ Sign-off

**I have read and understood this documentation:**

Name: _________________ Date: _______ Signature: _________________

**I have completed the full checklist:**

Name: _________________ Date: _______ Signature: _________________

**I approve production migration:**

Name: _________________ Date: _______ Signature: _________________

