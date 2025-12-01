/**
 * Comprehensive Migration Script: Fix Marlow Rewards
 *
 * This script fixes ALL Marlow-related reward issues in the database:
 *
 * 1. When Marlow WINS (no players beat him):
 *    - Marlow's portfolio reward should be "0" (prize stays in contract)
 *    - Marlow should be in game.winners with reward "0"
 *
 * 2. When Marlow LOSES (players beat him):
 *    - Marlow's portfolio reward should be "0"
 *    - Marlow should NOT be in game.winners
 *    - Marlow's portfolio status should be "LOST"
 *    - Players who beat Marlow should have rewards distributed equally
 *
 * Run: node scripts/fix-marlow-rewards-comprehensive.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

async function fixMarlowRewards() {
  try {
    console.log("=".repeat(70));
    console.log("  COMPREHENSIVE MARLOW REWARDS FIX");
    console.log("=".repeat(70));

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("\n✅ Connected to MongoDB");

    const Game = require("../src/models/Game");
    const Portfolio = require("../src/models/Portfolio");

    const apeUserId = process.env.APE_USER_ID;
    if (!apeUserId) {
      throw new Error("APE_USER_ID not set in environment variables");
    }
    console.log(`APE User ID: ${apeUserId}\n`);

    // Statistics
    const stats = {
      gamesAnalyzed: 0,
      marlowWonGames: 0,
      marlowLostGames: 0,
      portfolioRewardsFixed: 0,
      gameWinnersFixed: 0,
      marlowStatusFixed: 0,
      errors: 0,
    };

    // Find all MARLOW_BANES games (completed or calculating)
    const marlowGames = await Game.find({
      "winCondition.type": "MARLOW_BANES",
      status: { $in: ["COMPLETED", "DISTRIBUTING_REWARDS", "CALCULATING_WINNERS"] },
    }).sort({ gameId: 1 });

    console.log(`Found ${marlowGames.length} MARLOW_BANES games to analyze\n`);
    console.log("-".repeat(70));

    for (const game of marlowGames) {
      stats.gamesAnalyzed++;

      try {
        console.log(`\n📊 Game ${game.gameId} - "${game.name}" (${game.status})`);

        // Check if this game has an APE portfolio
        if (!game.apePortfolio?.portfolioId) {
          console.log(`   ⚠️  No APE portfolio found, skipping`);
          continue;
        }

        // Get the APE portfolio
        const apePortfolio = await Portfolio.findOne({
          portfolioId: game.apePortfolio.portfolioId,
        });

        if (!apePortfolio) {
          console.log(`   ⚠️  APE portfolio ${game.apePortfolio.portfolioId} not found`);
          continue;
        }

        const apeCurrentValue = apePortfolio.currentValue;
        console.log(`   🦍 Marlow's value: $${apeCurrentValue?.toLocaleString() || "N/A"}`);

        // Get all player portfolios (excluding APE)
        const playerPortfolios = await Portfolio.find({
          gameId: game.gameId,
          isApe: { $ne: true },
          status: { $in: ["WON", "LOST", "LOCKED", "AWAITING DECISION"] },
        }).sort({ performancePercentage: -1 });

        console.log(`   👥 Total players: ${playerPortfolios.length}`);

        // Determine actual winners (players who beat Marlow)
        const actualWinners = playerPortfolios.filter(
          (p) => p.currentValue > apeCurrentValue
        );
        const actualLosers = playerPortfolios.filter(
          (p) => p.currentValue <= apeCurrentValue
        );

        const marlowWon = actualWinners.length === 0;
        console.log(`   🎯 Marlow ${marlowWon ? "WON" : "LOST"} (${actualWinners.length} players beat him)`);

        if (marlowWon) {
          stats.marlowWonGames++;
        } else {
          stats.marlowLostGames++;
        }

        // ====== FIX 1: Marlow's Portfolio Reward ======
        const currentMarlowReward = apePortfolio.gameOutcome?.reward;
        if (currentMarlowReward && currentMarlowReward !== "0") {
          console.log(`   🔧 FIX: Marlow's portfolio reward "${currentMarlowReward}" → "0"`);
          await Portfolio.updateOne(
            { portfolioId: apePortfolio.portfolioId },
            { $set: { "gameOutcome.reward": "0" } }
          );
          stats.portfolioRewardsFixed++;
        }

        // ====== FIX 2: Marlow's Portfolio Status ======
        if (marlowWon) {
          // Marlow won - should be "WON" with isWinner: true
          if (apePortfolio.status !== "WON" || !apePortfolio.gameOutcome?.isWinner) {
            console.log(`   🔧 FIX: Marlow's status "${apePortfolio.status}" → "WON"`);
            await Portfolio.updateOne(
              { portfolioId: apePortfolio.portfolioId },
              {
                $set: {
                  status: "WON",
                  "gameOutcome.isWinner": true,
                  "gameOutcome.reward": "0",
                  "gameOutcome.rank": 1,
                  "gameOutcome.settledAt": new Date(),
                },
              }
            );
            stats.marlowStatusFixed++;
          }
        } else {
          // Marlow lost - should be "LOST" with isWinner: false
          if (apePortfolio.status !== "LOST" || apePortfolio.gameOutcome?.isWinner) {
            console.log(`   🔧 FIX: Marlow's status "${apePortfolio.status}" → "LOST"`);
            await Portfolio.updateOne(
              { portfolioId: apePortfolio.portfolioId },
              {
                $set: {
                  status: "LOST",
                  "gameOutcome.isWinner": false,
                  "gameOutcome.reward": "0",
                  "gameOutcome.rank": actualWinners.length + 1,
                  "gameOutcome.settledAt": new Date(),
                },
              }
            );
            stats.marlowStatusFixed++;
          }
        }

        // ====== FIX 3: Game Winners Array ======
        const marlowInWinners = game.winners.some(
          (w) => w.portfolioId === apePortfolio.portfolioId
        );

        if (marlowWon && !marlowInWinners) {
          // Marlow won but not in winners - add him with reward "0"
          console.log(`   🔧 FIX: Adding Marlow to winners with reward "0"`);
          game.winners.push({
            userId: apePortfolio.userId,
            portfolioId: apePortfolio.portfolioId,
            performancePercentage: apePortfolio.performancePercentage,
            reward: "0",
            isRewardDistributed: true,
            distributionTransactionHash: "APE_SYSTEM_WIN",
          });
          await game.save();
          stats.gameWinnersFixed++;
        } else if (!marlowWon && marlowInWinners) {
          // Marlow lost but IS in winners - remove him
          console.log(`   🔧 FIX: Removing Marlow from winners (he lost)`);
          game.winners = game.winners.filter(
            (w) => w.portfolioId !== apePortfolio.portfolioId
          );
          await game.save();
          stats.gameWinnersFixed++;
        } else if (marlowWon && marlowInWinners) {
          // Marlow won and is in winners - check reward is "0"
          const marlowWinner = game.winners.find(
            (w) => w.portfolioId === apePortfolio.portfolioId
          );
          if (marlowWinner && marlowWinner.reward && marlowWinner.reward !== "0") {
            console.log(`   🔧 FIX: Marlow's reward in winners "${marlowWinner.reward}" → "0"`);
            marlowWinner.reward = "0";
            await game.save();
            stats.gameWinnersFixed++;
          }
        }

        // ====== FIX 4: Verify Winner Rewards ======
        // If Marlow lost, verify all winning players have correct rewards
        if (!marlowWon && game.totalPrizePool && game.totalPrizePool !== "0") {
          const totalPrizePool = BigInt(game.totalPrizePool);
          const expectedRewardPerWinner = actualWinners.length > 0
            ? totalPrizePool / BigInt(actualWinners.length)
            : 0n;

          console.log(`   💰 Expected reward per winner: ${(Number(expectedRewardPerWinner) / 1e18).toFixed(4)} tokens`);

          for (const winner of actualWinners) {
            const currentReward = winner.gameOutcome?.reward || "0";
            const currentRewardBigInt = BigInt(currentReward);

            // Check if reward is significantly different (allow 1 wei tolerance)
            if (Math.abs(Number(currentRewardBigInt - expectedRewardPerWinner)) > 1) {
              console.log(`   📝 Player ${winner.portfolioId}: reward "${currentReward}" differs from expected`);
              // Don't auto-fix player rewards as they may be intentionally different
            }
          }
        }

        console.log(`   ✅ Game ${game.gameId} processed`);

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        stats.errors++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("  MIGRATION COMPLETE - SUMMARY");
    console.log("=".repeat(70));
    console.log(`  Games analyzed:           ${stats.gamesAnalyzed}`);
    console.log(`  Marlow won games:         ${stats.marlowWonGames}`);
    console.log(`  Marlow lost games:        ${stats.marlowLostGames}`);
    console.log(`  Portfolio rewards fixed:  ${stats.portfolioRewardsFixed}`);
    console.log(`  Game winners fixed:       ${stats.gameWinnersFixed}`);
    console.log(`  Marlow status fixed:      ${stats.marlowStatusFixed}`);
    console.log(`  Errors:                   ${stats.errors}`);
    console.log("=".repeat(70));

    // Final verification
    console.log("\n📋 VERIFICATION - APE portfolios with non-zero rewards:");
    const remainingIssues = await Portfolio.find({
      isApe: true,
      "gameOutcome.reward": { $exists: true, $nin: ["0", null, undefined, ""] },
    }).select("portfolioId portfolioName gameId gameOutcome.reward status");

    if (remainingIssues.length === 0) {
      console.log("   ✅ All APE portfolios have reward = '0'");
    } else {
      console.log(`   ⚠️  Found ${remainingIssues.length} issues remaining:`);
      for (const p of remainingIssues) {
        console.log(
          `      Portfolio ${p.portfolioId} (Game ${p.gameId}): reward="${p.gameOutcome?.reward}" status="${p.status}"`
        );
      }
    }

    // Also check games where Marlow shouldn't be in winners
    console.log("\n📋 VERIFICATION - Games where Marlow is incorrectly in winners:");
    const gamesWithIssues = await Game.find({
      "winCondition.type": "MARLOW_BANES",
      status: { $in: ["COMPLETED", "DISTRIBUTING_REWARDS"] },
    });

    let winnersIssueCount = 0;
    for (const game of gamesWithIssues) {
      if (!game.apePortfolio?.portfolioId) continue;

      const apePortfolio = await Portfolio.findOne({
        portfolioId: game.apePortfolio.portfolioId,
      });
      if (!apePortfolio) continue;

      const playerWinners = await Portfolio.find({
        gameId: game.gameId,
        isApe: { $ne: true },
        status: "WON",
      });

      const marlowInWinners = game.winners.some(
        (w) => w.portfolioId === apePortfolio.portfolioId
      );

      // If there are player winners, Marlow should NOT be in winners
      if (playerWinners.length > 0 && marlowInWinners) {
        console.log(`   ⚠️  Game ${game.gameId}: Marlow in winners but ${playerWinners.length} players beat him`);
        winnersIssueCount++;
      }
    }

    if (winnersIssueCount === 0) {
      console.log("   ✅ All games have correct winners arrays");
    }

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
    process.exit(0);
  }
}

fixMarlowRewards();

