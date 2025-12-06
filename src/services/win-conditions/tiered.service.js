/**
 * TIERED Win Condition Calculator
 *
 * In this mode, specific positions get specific percentages of the prize pool.
 * Example: 1st = 50%, 2nd = 30%, 3rd = 20%
 *
 * PROPORTIONAL REDISTRIBUTION:
 * When there are fewer players than tiers, the unclaimed percentages are
 * redistributed proportionally among the active tiers.
 *
 * Example with 2 players and 50/30/20 tiers:
 * - Active tiers: 50% + 30% = 80%
 * - 1st gets: (50/80) × 100% = 62.5%
 * - 2nd gets: (30/80) × 100% = 37.5%
 * - Total: 100% (nothing left unclaimed)
 */

const Portfolio = require('../../models/Portfolio');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const blockchainService = require('../blockchain.service');

/**
 * Calculate winners for a TIERED game with proportional redistribution
 * @param {Object} game - The game document
 * @returns {Promise<void>}
 */
async function calculateWinners(game) {
  console.log(`\n--- TIERED: Specific Positions Win (with Proportional Redistribution) ---`);

  // Get totalPrizePool from blockchain
  const gameDetails = await blockchainService.getGameDetails(game.gameId);
  const totalPrizePool = BigInt(gameDetails.totalPrizePool);
  game.totalPrizePool = totalPrizePool.toString();
  console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

  const tiers = game.winCondition.config.tiers;
  console.log(`Configured Tiers: ${tiers.map((t) => `#${t.position}=${t.rewardPercentage}%`).join(', ')}`);

  // Get all locked portfolios sorted by performance
  const lockedPortfolios = await Portfolio.find({
    gameId: game.gameId,
    status: 'LOCKED',
  })
    .populate('userId')
    .lean()
    .sort({ performancePercentage: -1, createdAt: 1 }); // Tie-breaker: earlier entry wins

  // ========================================
  // EDGE CASE: No players at all
  // ========================================
  if (lockedPortfolios.length === 0) {
    console.log(`⚠️ Game ${game.gameId}: No players - nothing to distribute`);
    console.log(`Prize pool of $${(Number(totalPrizePool) / 1e18).toFixed(2)} remains in contract for admin withdrawal`);
    game.hasCalculatedWinners = true;
    await game.markWinnerCalculated();
    return;
  }

  // ========================================
  // EDGE CASE: Prize pool is 0
  // ========================================
  if (totalPrizePool === 0n) {
    console.log(`⚠️ Game ${game.gameId}: Prize pool is 0 - marking all as participants`);
    for (const portfolio of lockedPortfolios) {
      await Portfolio.updateOne(
        { portfolioId: portfolio.portfolioId },
        {
          $set: {
            status: 'LOST',
            'gameOutcome.isWinner': false,
            'gameOutcome.reward': '0',
            'gameOutcome.settledAt': new Date(),
            'gameOutcome.rank': 1,
          },
        }
      );
    }
    game.hasCalculatedWinners = true;
    await game.markWinnerCalculated();
    return;
  }

  // ========================================
  // Calculate active tiers (tiers that have players)
  // ========================================
  const activeTiers = tiers.filter((t) => t.position <= lockedPortfolios.length);

  console.log(`\n📊 Tier Analysis:`);
  console.log(`   Total Players: ${lockedPortfolios.length}`);
  console.log(`   Total Tiers Configured: ${tiers.length}`);
  console.log(`   Active Tiers (with players): ${activeTiers.length}`);

  // ========================================
  // EDGE CASE: No active tiers (misconfigured - all tier positions > player count)
  // ========================================
  if (activeTiers.length === 0) {
    console.error(`❌ Game ${game.gameId}: No active tiers! All tier positions exceed player count.`);
    console.error(`   Tiers: ${tiers.map((t) => `pos ${t.position}`).join(', ')}`);
    console.error(`   Players: ${lockedPortfolios.length}`);
    game.status = 'FAILED';
    game.error = `No valid tiers for ${lockedPortfolios.length} players. Tier positions: ${tiers.map((t) => t.position).join(', ')}`;
    await game.save();
    return;
  }

  // ========================================
  // PROPORTIONAL REDISTRIBUTION CALCULATION
  // ========================================
  const originalTotalPercentage = activeTiers.reduce((sum, t) => sum + t.rewardPercentage, 0);
  const missingPercentage = 100 - originalTotalPercentage;

  console.log(`\n💰 Proportional Redistribution:`);
  console.log(`   Original active tier total: ${originalTotalPercentage}%`);
  console.log(`   Unclaimed (missing tiers): ${missingPercentage}%`);

  if (missingPercentage > 0) {
    console.log(`   Scaling factor: ${(100 / originalTotalPercentage).toFixed(4)}x`);
    console.log(`   ➡️ Redistributing ${missingPercentage}% proportionally among ${activeTiers.length} active tier(s)`);
  } else {
    console.log(`   ✅ All tiers have players - no redistribution needed`);
  }

  // Build winners array with scaled rewards
  const winners = [];
  let totalDistributed = 0n;

  for (let i = 0; i < activeTiers.length; i++) {
    const tier = activeTiers[i];
    const positionIndex = tier.position - 1;
    const portfolioData = lockedPortfolios[positionIndex];

    // Calculate scaled percentage (proportional redistribution)
    const scaledPercentage = (tier.rewardPercentage / originalTotalPercentage) * 100;

    // Use higher precision for BigInt calculation to avoid rounding errors
    // Multiply by 10000 then divide by 10000 for 2 decimal precision
    let rewardAmount;

    // For the last winner, give them the remainder to ensure 100% is distributed
    if (i === activeTiers.length - 1) {
      rewardAmount = totalPrizePool - totalDistributed;
    } else {
      rewardAmount = (totalPrizePool * BigInt(Math.round(scaledPercentage * 100))) / 10000n;
      totalDistributed += rewardAmount;
    }

    console.log(
      `   Position ${tier.position}: ${tier.rewardPercentage}% → ${scaledPercentage.toFixed(2)}% = $${(
        Number(rewardAmount) / 1e18
      ).toFixed(2)}`
    );

    winners.push({
      portfolioData,
      rewardAmount,
      rank: tier.position,
      originalPercentage: tier.rewardPercentage,
      scaledPercentage,
    });
  }

  // Log final standings
  console.log('\n📊 Final Standings:');
  const displayCount = Math.min(lockedPortfolios.length, Math.max(...activeTiers.map((t) => t.position)) + 5);
  for (let i = 0; i < displayCount; i++) {
    const p = lockedPortfolios[i];
    const winner = winners.find((w) => w.portfolioData.portfolioId === p.portfolioId);
    const status = winner
      ? `✅ Wins ${winner.scaledPercentage.toFixed(1)}% ($${(Number(winner.rewardAmount) / 1e18).toFixed(2)})`
      : '❌';
    console.log(
      `${i + 1}. ${status} Portfolio ${p.portfolioId}: $${p.currentValue.toLocaleString()} (${p.performancePercentage.toFixed(2)}%)`
    );
  }

  // ========================================
  // Process Winners
  // ========================================
  for (const { portfolioData, rewardAmount, rank, scaledPercentage } of winners) {
    game.winners.push({
      userId: portfolioData.userId,
      portfolioId: portfolioData.portfolioId,
      performancePercentage: portfolioData.performancePercentage,
      isRewardDistributed: false,
    });

    // Since we used lean(), need to get full document for methods
    const portfolio = await Portfolio.findOne({ portfolioId: portfolioData.portfolioId });
    await portfolio.markAsWinner(rewardAmount.toString(), rank);

    const previousWins = await Portfolio.countDocuments({
      userId: portfolio.userId._id,
      'gameOutcome.isWinner': true,
      gameId: game.gameId,
    });

    const user = await User.findById(portfolio.userId);
    if (user) {
      await user.updateGameStats(
        game.gameId,
        portfolio.portfolioId,
        portfolio.performancePercentage,
        parseFloat(rewardAmount.toString()),
        rank
      );
    }

    await new Notification({
      userId: portfolio.userId._id,
      type: 'PORTFOLIO_WON',
      message: `Congratulations! Your portfolio "${portfolio.portfolioName}" won! (${scaledPercentage.toFixed(1)}% of prize pool)`,
      metadata: {
        previousWins,
        portfolioId: portfolio._id,
        gameId: game.gameId,
        rewardPercentage: scaledPercentage,
      },
    }).save();
  }

  // ========================================
  // Process Losers
  // ========================================
  const winnerPortfolioIds = winners.map((w) => w.portfolioData.portfolioId);
  const losingPortfolios = lockedPortfolios.filter(
    (portfolio) => !winnerPortfolioIds.includes(portfolio.portfolioId)
  );

  for (const portfolio of losingPortfolios) {
    await Portfolio.updateOne(
      { portfolioId: portfolio.portfolioId },
      {
        $set: {
          status: 'LOST',
          'gameOutcome.isWinner': false,
          'gameOutcome.reward': '0',
          'gameOutcome.settledAt': new Date(),
          'gameOutcome.rank': activeTiers.length + 1,
        },
      }
    );

    // Update user statistics for loser
    const user = await User.findById(portfolio.userId._id);
    if (user) {
      await user.updateGameStats(
        game.gameId,
        portfolio.portfolioId,
        portfolio.performancePercentage,
        0,
        activeTiers.length + 1
      );
    }

    const previousWins = await Portfolio.countDocuments({
      userId: portfolio.userId._id,
      'gameOutcome.isWinner': true,
      gameId: { $ne: game.gameId },
    });

    await new Notification({
      userId: portfolio.userId._id,
      type: 'PORTFOLIO_LOST',
      message: `Your portfolio "${portfolio.portfolioName}" did not win this round.`,
      metadata: {
        previousWins,
        portfolioId: portfolio._id,
        gameId: game.gameId,
      },
    }).save();
  }

  console.log(`\n✅ TIERED Complete (with Proportional Redistribution):`);
  console.log(`   Winners: ${winners.length}`);
  console.log(`   Losers: ${losingPortfolios.length}`);
  console.log(`   Prize Pool Distributed: 100%`);
  console.log(`========== WINNER CALCULATION END: Game ${game.gameId} ==========\n`);

  game.hasCalculatedWinners = true;
  await game.markWinnerCalculated();
}

module.exports = {
  calculateWinners,
};

