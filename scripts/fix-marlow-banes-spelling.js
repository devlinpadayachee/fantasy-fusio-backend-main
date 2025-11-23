/**
 * Migration Script: Fix Marlow Banes Spelling
 *
 * This script corrects the misspelling of "Marlow Banes" throughout the database.
 * Changes: MARLOWE_BAINES → MARLOW_BANES
 *
 * Collections affected:
 * - games (winCondition.type field)
 * - gamecrons (winCondition.type field)
 * - portfolios (portfolioName field for ape portfolios)
 */

require("dotenv").config({ path: ".env.local" });
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGODB_URI) {
  console.error("❌ ERROR: MONGODB_URI not found in environment variables");
  console.error("Make sure .env.local exists with MONGODB_URI");
  process.exit(1);
}

async function fixMarlowBanesSpelling() {
  try {
    console.log("\n========================================");
    console.log("  FIX MARLOW BANES SPELLING MIGRATION");
    console.log("========================================\n");

    // Connect to MongoDB
    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    const db = mongoose.connection.db;

    // ========================================
    // 1. FIX GAMES COLLECTION
    // ========================================
    console.log("📋 Checking games collection...");
    const gamesCollection = db.collection("games");

    const gamesToFix = await gamesCollection.countDocuments({
      "winCondition.type": "MARLOWE_BAINES",
    });

    console.log(`   Found ${gamesToFix} games with incorrect spelling`);

    if (gamesToFix > 0) {
      const gamesResult = await gamesCollection.updateMany(
        { "winCondition.type": "MARLOWE_BAINES" },
        { $set: { "winCondition.type": "MARLOW_BANES" } }
      );
      console.log(`   ✅ Updated ${gamesResult.modifiedCount} games`);
    } else {
      console.log("   ✅ No games need updating");
    }

    // ========================================
    // 2. FIX GAMECRONS COLLECTION
    // ========================================
    console.log("\n📋 Checking gamecrons collection...");
    const gameCronsCollection = db.collection("gamecrons");

    const cronJobsToFix = await gameCronsCollection.countDocuments({
      "winCondition.type": "MARLOWE_BAINES",
    });

    console.log(`   Found ${cronJobsToFix} cron jobs with incorrect spelling`);

    if (cronJobsToFix > 0) {
      const cronsResult = await gameCronsCollection.updateMany(
        { "winCondition.type": "MARLOWE_BAINES" },
        { $set: { "winCondition.type": "MARLOW_BANES" } }
      );
      console.log(`   ✅ Updated ${cronsResult.modifiedCount} cron jobs`);
    } else {
      console.log("   ✅ No cron jobs need updating");
    }

    // ========================================
    // 3. FIX PORTFOLIOS COLLECTION (Ape Portfolio Names)
    // ========================================
    console.log("\n📋 Checking portfolios collection...");
    const portfoliosCollection = db.collection("portfolios");

    // Fix various misspellings in portfolio names
    const misspellings = [
      "MARLOWE BAINE",
      "MARLOWE BAINES",
      "Marlowe Baine",
      "Marlowe Baines",
      "MARLOW BAINE", // singular
    ];

    let totalPortfoliosFixed = 0;

    for (const misspelling of misspellings) {
      const portfoliosToFix = await portfoliosCollection.countDocuments({
        portfolioName: misspelling,
      });

      if (portfoliosToFix > 0) {
        console.log(`   Found ${portfoliosToFix} portfolios named "${misspelling}"`);
        const portfoliosResult = await portfoliosCollection.updateMany(
          { portfolioName: misspelling },
          { $set: { portfolioName: "MARLOW BANES" } }
        );
        console.log(`   ✅ Updated ${portfoliosResult.modifiedCount} portfolios`);
        totalPortfoliosFixed += portfoliosResult.modifiedCount;
      }
    }

    if (totalPortfoliosFixed === 0) {
      console.log("   ✅ No portfolios need updating");
    }

    // ========================================
    // VERIFICATION
    // ========================================
    console.log("\n========================================");
    console.log("  VERIFICATION");
    console.log("========================================\n");

    // Verify no old spellings remain
    const remainingGames = await gamesCollection.countDocuments({
      "winCondition.type": "MARLOWE_BAINES",
    });

    const remainingCrons = await gameCronsCollection.countDocuments({
      "winCondition.type": "MARLOWE_BAINES",
    });

    const remainingPortfolios = await portfoliosCollection.countDocuments({
      portfolioName: { $in: misspellings },
    });

    console.log("Remaining incorrect spellings:");
    console.log(`   Games: ${remainingGames}`);
    console.log(`   Cron Jobs: ${remainingCrons}`);
    console.log(`   Portfolios: ${remainingPortfolios}`);

    if (remainingGames === 0 && remainingCrons === 0 && remainingPortfolios === 0) {
      console.log("\n✅ ✅ ✅ ALL SPELLINGS CORRECTED! ✅ ✅ ✅");
    } else {
      console.log("\n⚠️  WARNING: Some incorrect spellings still remain");
    }

    // Count correct spellings
    const correctGames = await gamesCollection.countDocuments({
      "winCondition.type": "MARLOW_BANES",
    });

    const correctCrons = await gameCronsCollection.countDocuments({
      "winCondition.type": "MARLOW_BANES",
    });

    const correctPortfolios = await portfoliosCollection.countDocuments({
      portfolioName: "MARLOW BANES",
    });

    console.log("\nCorrect spellings (MARLOW_BANES):");
    console.log(`   Games: ${correctGames}`);
    console.log(`   Cron Jobs: ${correctCrons}`);
    console.log(`   Portfolios (Ape): ${correctPortfolios}`);

    console.log("\n========================================");
    console.log("  MIGRATION COMPLETE");
    console.log("========================================\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log("📡 Disconnected from MongoDB\n");
  }
}

// Run migration
fixMarlowBanesSpelling()
  .then(() => {
    console.log("✅ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  });
