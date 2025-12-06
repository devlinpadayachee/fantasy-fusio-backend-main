/**
 * EQUAL_DISTRIBUTE Win Condition Calculator
 *
 * In this mode:
 * - Top X% of players share Y% of the prize pool equally
 * - For example: Top 10% of players share 80% of prize equally
 * - Remaining prize can go to platform (100 - Y%)
 */

const Portfolio = require('../../models/Portfolio');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const blockchainService = require('../blockchain.service');

/**
 * Calculate winners for an EQUAL_DISTRIBUTE game
 * @param {Object} game - The game document
 * @returns {Promise<void>}
 */
async function calculateWinners(game) {
  console.log(`\n--- EQUAL_DISTRIBUTE: Top ${game.winCondition.config.topWinnersPercentage}% Win ---`);

  // Get totalPrizePool from blockchain
  const gameDetails = await blockchainService.getGameDetails(game.gameId);
  const totalPrizePool = BigInt(gameDetails.totalPrizePool);
  game.totalPrizePool = totalPrizePool.toString();
  console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

  // Get all locked portfolios sorted by performance
  const lockedPortfolios = await Portfolio.find({
    gameId: game.gameId,
    status: 'LOCKED',
  })
    .populate('userId')
    .lean()
    .sort({ performancePercentage: -1, createdAt: 1 }); // Tie-breaker: earlier entry wins

  const topWinnersPercentage = game.winCondition.config.topWinnersPercentage;
  const rewardPercentage = game.winCondition.config.rewardPercentage;

  // ========================================
  // EDGE CASE: No players
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
    console.log(`⚠️ Game ${game.gameId}: Prize pool is 0 - marking all as participants (no winners/losers)`);
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

  // Calculate number of winners (at least 1 if there are any players)
  const topWinnersCount = Math.max(1, Math.ceil((topWinnersPercentage / 100) * lockedPortfolios.length));

  console.log(`Total Portfolios: ${lockedPortfolios.length}`);
  console.log(`Top ${topWinnersPercentage}% = ${topWinnersCount} winner(s)`);
  console.log(
    `Reward Pool: ${rewardPercentage}% of prize = $${(
      (Number(totalPrizePool) * rewardPercentage) /
      100 /
      1e18
    ).toFixed(2)}`
  );

  const winners = lockedPortfolios.slice(0, topWinnersCount);

  let rewardTotal = 0n;
  let rewardPerWinner = 0n;

  if (topWinnersCount > 0 && rewardPercentage > 0 && totalPrizePool > 0n) {
    rewardTotal = (totalPrizePool * BigInt(rewardPercentage)) / 100n;
    rewardPerWinner = rewardTotal / BigInt(topWinnersCount);
  }

  console.log(`Reward per winner: $${(Number(rewardPerWinner) / 1e18).toFixed(2)}`);

  // Log top 10 standings
  console.log('\n📊 Top 10 Standings:');
  lockedPortfolios.slice(0, 10).forEach((p, i) => {
    const isWinner = i < topWinnersCount ? '✅' : '❌';
    console.log(
      `${i + 1}. ${isWinner} Portfolio ${
        p.portfolioId
      }: $${p.currentValue.toLocaleString()} (${p.performancePercentage.toFixed(2)}%)`
    );
  });

  // Process winners
  for (let i = 0; i < winners.length; i++) {
    const portfolioData = winners[i];
    const rank = i + 1;

    game.winners.push({
      userId: portfolioData.userId,
      portfolioId: portfolioData.portfolioId,
      performancePercentage: portfolioData.performancePercentage,
      isRewardDistributed: false,
    });

    // Since we used lean(), need to get full document for methods
    const portfolio = await Portfolio.findOne({ portfolioId: portfolioData.portfolioId });
    await portfolio.markAsWinner(rewardPerWinner.toString(), rank);

    const previousWins = await Portfolio.countDocuments({
      userId: portfolioData.userId._id,
      'gameOutcome.isWinner': true,
      gameId: game.gameId,
    });

    // Update user statistics
    const user = await User.findById(portfolioData.userId);
    if (user) {
      await user.updateGameStats(
        game.gameId,
        portfolioData.portfolioId,
        portfolioData.performancePercentage,
        parseFloat(rewardPerWinner.toString()),
        rank
      );
    }

    // Create win notification
    await new Notification({
      userId: portfolioData.userId._id,
      type: 'PORTFOLIO_WON',
      message: `Congratulations! Your portfolio "${portfolio.portfolioName}" won!`,
      metadata: {
        previousWins,
        portfolioId: portfolio._id,
        gameId: game.gameId,
      },
    }).save();
  }

  // Mark losing portfolios
  const losingPortfolios = lockedPortfolios.slice(topWinnersCount);

  for (const portfolio of losingPortfolios) {
    await Portfolio.updateOne(
      { portfolioId: portfolio.portfolioId },
      {
        $set: {
          status: 'LOST',
          'gameOutcome.isWinner': false,
          'gameOutcome.reward': '0',
          'gameOutcome.settledAt': new Date(),
          'gameOutcome.rank': topWinnersCount + 1,
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
        topWinnersCount + 1
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

  console.log(`\n✅ EQUAL_DISTRIBUTE Complete:`);
  console.log(`   Winners: ${winners.length}`);
  console.log(`   Losers: ${losingPortfolios.length}`);
  console.log(`========== WINNER CALCULATION END: Game ${game.gameId} ==========\n`);

  game.hasCalculatedWinners = true;
  await game.markWinnerCalculated();
}

module.exports = {
  calculateWinners,
};

