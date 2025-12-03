/**
 * Migration Script: Fix Marlow Rewards
 *
 * This script fixes the database where Marlow's reward was incorrectly saved
 * with an actual value instead of "0" when he won.
 *
 * When Marlow wins (no players beat him), his reward in the database should be "0"
 * because the prize pool stays in the contract (admin can withdraw it via the admin panel).
 *
 * Run: node scripts/fix-marlow-rewards.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

async function fixMarlowRewards() {
  try {
    console.log("=".repeat(60));
    console.log("  FIX MARLOW REWARDS MIGRATION");
    console.log("=".repeat(60));

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("\n✅ Connected to MongoDB");

    const Game = require("../src/models/Game");
    const Portfolio = require("../src/models/Portfolio");

    const apeUserId = process.env.APE_USER_ID;
    if (!apeUserId) {
      throw new Error("APE_USER_ID not set in environment variables");
    }
    console.log(`APE User ID: ${apeUserId}`);

    // Find all completed MARLOW_BANES games
    const marlowGames = await Game.find({
      "winCondition.type": "MARLOW_BANES",
      status: "COMPLETED",
    });

    console.log(`\nFound ${marlowGames.length} completed MARLOW_BANES games`);

    let fixedCount = 0;
    let alreadyCorrectCount = 0;
    let errorCount = 0;

    for (const game of marlowGames) {
      try {
        // Check if this game has an APE portfolio
        if (!game.apePortfolio?.portfolioId) {
          console.log(`  ⚠️  Game ${game.gameId} (${game.name}): No APE portfolio`);
          continue;
        }

        // Get the APE portfolio
        const apePortfolio = await Portfolio.findOne({
          portfolioId: game.apePortfolio.portfolioId,
        });

        if (!apePortfolio) {
          console.log(`  ⚠️  Game ${game.gameId} (${game.name}): APE portfolio not found`);
          continue;
        }

        // Check if Marlow won this game (APE is in winners list)
        const marlowWon = game.winners.some(
          (w) => w.portfolioId === game.apePortfolio.portfolioId
        );

        if (!marlowWon) {
          // Marlow didn't win, check if reward needs to be 0
          if (apePortfolio.gameOutcome?.reward && apePortfolio.gameOutcome.reward !== "0") {
            console.log(
              `  📝 Game ${game.gameId} (${game.name}): Marlow LOST but has reward "${apePortfolio.gameOutcome.reward}" - fixing to "0"`
            );

            await Portfolio.updateOne(
              { portfolioId: game.apePortfolio.portfolioId },
              { $set: { "gameOutcome.reward": "0" } }
            );
            fixedCount++;
          } else {
            alreadyCorrectCount++;
          }
          continue;
        }

        // Marlow won - check if reward is incorrectly set to non-zero
        const currentReward = apePortfolio.gameOutcome?.reward;

        if (currentReward && currentReward !== "0") {
          console.log(
            `  🔧 Game ${game.gameId} (${game.name}): Marlow WON with incorrect reward "${currentReward}" - fixing to "0"`
          );

          await Portfolio.updateOne(
            { portfolioId: game.apePortfolio.portfolioId },
            { $set: { "gameOutcome.reward": "0" } }
          );
          fixedCount++;
        } else {
          alreadyCorrectCount++;
        }
      } catch (error) {
        console.log(`  ❌ Game ${game.gameId}: Error - ${error.message}`);
        errorCount++;
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("  MIGRATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Fixed:           ${fixedCount} portfolios`);
    console.log(`  Already correct: ${alreadyCorrectCount} portfolios`);
    console.log(`  Errors:          ${errorCount}`);
    console.log("=".repeat(60));

    // Verification - show all APE portfolios with non-zero rewards
    console.log("\n📋 Verification - APE portfolios with non-zero rewards:");
    const remainingIssues = await Portfolio.find({
      userId: apeUserId,
      "gameOutcome.reward": { $nin: ["0", null, undefined] },
    }).select("portfolioId portfolioName gameId gameOutcome.reward status");

    if (remainingIssues.length === 0) {
      console.log("  ✅ None found - all APE rewards are correctly set to '0'");
    } else {
      console.log(`  ⚠️  Found ${remainingIssues.length} APE portfolios with non-zero rewards:`);
      for (const p of remainingIssues) {
        console.log(
          `     Portfolio ${p.portfolioId} (Game ${p.gameId}): reward="${p.gameOutcome?.reward}" status="${p.status}"`
        );
      }
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
    process.exit(0);
  }
}

fixMarlowRewards();



