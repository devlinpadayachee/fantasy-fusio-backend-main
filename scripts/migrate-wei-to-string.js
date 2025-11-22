/**
 * Migration Script: Convert Wei Values from Number to String
 *
 * This script migrates all monetary fields stored as Numbers to Strings
 * to prevent JavaScript integer overflow issues with wei values.
 *
 * Run with: node scripts/migrate-wei-to-string.js
 */

const mongoose = require("mongoose");
const readline = require("readline");
require("dotenv").config();

// Import models
const User = require("../src/models/User");
const Transaction = require("../src/models/Transaction");
const Game = require("../src/models/Game");
const Portfolio = require("../src/models/Portfolio");

// Import backup utility
const { createBackup } = require("./backup-database");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fantasy-fusion";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function migrateUsers() {
  console.log("\n📊 Migrating Users collection...");

  const users = await User.find({}).lean();
  let updated = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const updates = {};

      // Convert totalEarnings
      if (typeof user.totalEarnings === "number") {
        updates.totalEarnings = user.totalEarnings.toString();
      } else if (!user.totalEarnings) {
        updates.totalEarnings = "0";
      }

      // Convert currentBalance
      if (typeof user.currentBalance === "number") {
        updates.currentBalance = user.currentBalance.toString();
      } else if (!user.currentBalance) {
        updates.currentBalance = "0";
      }

      // Convert lockedBalance
      if (typeof user.lockedBalance === "number") {
        updates.lockedBalance = user.lockedBalance.toString();
      } else if (!user.lockedBalance) {
        updates.lockedBalance = "0";
      }

      if (Object.keys(updates).length > 0) {
        await User.updateOne({ _id: user._id }, { $set: updates });
        updated++;

        if (updated % 100 === 0) {
          console.log(`  ✓ Processed ${updated} users...`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Error updating user ${user._id}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Users migration complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function migrateTransactions() {
  console.log("\n📊 Migrating Transactions collection...");

  const transactions = await Transaction.find({}).lean();
  let updated = 0;
  let errors = 0;

  for (const tx of transactions) {
    try {
      const updates = {};

      // Convert amount
      if (typeof tx.amount === "number") {
        updates.amount = tx.amount.toString();
      } else if (!tx.amount) {
        updates.amount = "0";
      }

      // Convert gasUsed
      if (typeof tx.gasUsed === "number") {
        updates.gasUsed = tx.gasUsed.toString();
      } else if (!tx.gasUsed) {
        updates.gasUsed = "0";
      }

      // Convert gasPrice
      if (typeof tx.gasPrice === "number") {
        updates.gasPrice = tx.gasPrice.toString();
      } else if (!tx.gasPrice) {
        updates.gasPrice = "0";
      }

      // Convert networkFee
      if (typeof tx.networkFee === "number") {
        updates.networkFee = tx.networkFee.toString();
      } else if (!tx.networkFee) {
        updates.networkFee = "0";
      }

      if (Object.keys(updates).length > 0) {
        await Transaction.updateOne({ _id: tx._id }, { $set: updates });
        updated++;

        if (updated % 100 === 0) {
          console.log(`  ✓ Processed ${updated} transactions...`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Error updating transaction ${tx._id}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Transactions migration complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function migrateGames() {
  console.log("\n📊 Migrating Games collection...");

  const games = await Game.find({}).lean();
  let updated = 0;
  let errors = 0;

  for (const game of games) {
    try {
      const updates = {};

      // Convert totalPrizePool
      if (typeof game.totalPrizePool === "number") {
        updates.totalPrizePool = game.totalPrizePool.toString();
      } else if (!game.totalPrizePool) {
        updates.totalPrizePool = "0";
      }

      if (Object.keys(updates).length > 0) {
        await Game.updateOne({ _id: game._id }, { $set: updates });
        updated++;

        if (updated % 50 === 0) {
          console.log(`  ✓ Processed ${updated} games...`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Error updating game ${game._id}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Games migration complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function migratePortfolios() {
  console.log("\n📊 Migrating Portfolios collection...");

  const portfolios = await Portfolio.find({}).lean();
  let updated = 0;
  let errors = 0;

  for (const portfolio of portfolios) {
    try {
      const updates = {};

      // Convert gameOutcome.reward
      if (portfolio.gameOutcome) {
        if (typeof portfolio.gameOutcome.reward === "number") {
          updates["gameOutcome.reward"] = portfolio.gameOutcome.reward.toString();
        } else if (!portfolio.gameOutcome.reward) {
          updates["gameOutcome.reward"] = "0";
        }
      }

      if (Object.keys(updates).length > 0) {
        await Portfolio.updateOne({ _id: portfolio._id }, { $set: updates });
        updated++;

        if (updated % 100 === 0) {
          console.log(`  ✓ Processed ${updated} portfolios...`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Error updating portfolio ${portfolio._id}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Portfolios migration complete: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function runMigration() {
  console.log("🚀 Starting Wei to String Migration");
  console.log("==================================\n");
  console.log(`📍 Database: ${MONGODB_URI}\n`);

  console.log("⚠️  This migration will convert all monetary Number fields to Strings.");
  console.log("⚠️  A backup will be created automatically before migration.\n");

  const answer = await question("Do you want to continue? (yes/no): ");

  if (answer.toLowerCase() !== "yes") {
    console.log("\n❌ Migration cancelled.");
    rl.close();
    process.exit(0);
  }

  console.log("\n💾 Creating database backup first...\n");
  console.log("━".repeat(50) + "\n");

  let backupInfo;
  try {
    backupInfo = await createBackup();
    console.log("━".repeat(50) + "\n");
    console.log("✅ Backup created successfully!");
    console.log(`📦 Backup location: ${backupInfo.path}\n`);
    console.log("💡 If migration fails, restore with:");
    console.log(`   mongorestore --uri="${MONGODB_URI}" --drop "${backupInfo.path}"\n`);
  } catch (error) {
    console.error("❌ Backup failed:", error.message);
    console.error("\nMigration aborted for safety. Please create a manual backup first.\n");
    rl.close();
    process.exit(1);
  }

  const proceed = await question("Backup complete. Proceed with migration? (yes/no): ");

  if (proceed.toLowerCase() !== "yes") {
    console.log("\n❌ Migration cancelled. Backup is saved.");
    rl.close();
    process.exit(0);
  }

  console.log("\n🔄 Starting migration...\n");

  try {
    // Connect to MongoDB
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Get collection counts before migration
    const userCount = await User.countDocuments();
    const txCount = await Transaction.countDocuments();
    const gameCount = await Game.countDocuments();
    const portfolioCount = await Portfolio.countDocuments();

    console.log("📈 Collection Counts:");
    console.log(`  - Users: ${userCount}`);
    console.log(`  - Transactions: ${txCount}`);
    console.log(`  - Games: ${gameCount}`);
    console.log(`  - Portfolios: ${portfolioCount}`);

    // Run migrations
    const results = {
      users: await migrateUsers(),
      transactions: await migrateTransactions(),
      games: await migrateGames(),
      portfolios: await migratePortfolios(),
    };

    // Summary
    console.log("\n\n🎉 Migration Complete!");
    console.log("=====================\n");
    console.log("📊 Summary:");
    console.log(`  Users:        ${results.users.updated} updated, ${results.users.errors} errors`);
    console.log(`  Transactions: ${results.transactions.updated} updated, ${results.transactions.errors} errors`);
    console.log(`  Games:        ${results.games.updated} updated, ${results.games.errors} errors`);
    console.log(`  Portfolios:   ${results.portfolios.updated} updated, ${results.portfolios.errors} errors`);

    const totalUpdated =
      results.users.updated + results.transactions.updated + results.games.updated + results.portfolios.updated;
    const totalErrors =
      results.users.errors + results.transactions.errors + results.games.errors + results.portfolios.errors;

    console.log(`\n  Total: ${totalUpdated} documents updated, ${totalErrors} errors\n`);

    if (totalErrors > 0) {
      console.log("⚠️  Some errors occurred during migration. Please review the logs above.");
      console.log("\n💡 To restore from backup, run:");
      console.log(`   mongorestore --uri="${MONGODB_URI}" --drop "${backupInfo.path}"\n`);
      rl.close();
      process.exit(1);
    } else {
      console.log("✅ All done! No errors.");
      console.log(`\n💾 Backup is saved at: ${backupInfo.path}`);
      console.log("   (You can delete it after verifying the migration)\n");
      rl.close();
      process.exit(0);
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    if (backupInfo) {
      console.log("\n💡 To restore from backup, run:");
      console.log(`   mongorestore --uri="${MONGODB_URI}" --drop "${backupInfo.path}"\n`);
    }
    rl.close();
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Disconnected from MongoDB");
  }
}

// Run the migration
runMigration();
