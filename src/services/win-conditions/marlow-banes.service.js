/**
 * MARLOW_BANES Win Condition Calculator
 *
 * In this mode, players compete against Marlow Banes (the AI/Ape).
 * - All players who beat Marlow's portfolio share the prize pool equally
 * - If no one beats Marlow, the prize stays in the contract (Marlow wins)
 * - Marlow doesn't receive actual blockchain rewards (system account)
 */

const Portfolio = require('../../models/Portfolio');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const blockchainService = require('../blockchain.service');

/**
 * Calculate winners for a MARLOW_BANES game
 * @param {Object} game - The game document
 * @returns {Promise<void>}
 */
async function calculateWinners(game) {
  console.log(`\n--- MARLOW_BANES: Beat the Ape ---`);

  // Get prize pool from blockchain
  const gameDetails = await blockchainService.getGameDetails(game.gameId);
  const totalPrizePool = BigInt(gameDetails.totalPrizePool);
  game.totalPrizePool = totalPrizePool.toString();
  console.log(`Prize Pool: $${(Number(totalPrizePool) / 1e18).toFixed(2)}`);

  // Fetch ape portfolio
  const apePortfolio = await Portfolio.findOne({
    portfolioId: game.apePortfolio.portfolioId,
  }).populate('userId');

  if (!apePortfolio) {
    game.status = 'FAILED';
    game.error = `Ape portfolio not found for game ${game.gameId}`;
    await game.save();
    return;
  }

  const apeValue = apePortfolio.currentValue;
  console.log(`Ape Portfolio: $${apeValue.toLocaleString()} (${apePortfolio.performancePercentage.toFixed(2)}%)`);

  // Get all player portfolios sorted by performance
  const playerPortfolios = await Portfolio.find({
    gameId: game.gameId,
    status: 'LOCKED',
    portfolioId: { $ne: game.apePortfolio.portfolioId },
  })
    .populate('userId')
    .sort({ performancePercentage: -1, createdAt: 1 });

  // ========================================
  // EDGE CASE: No players
  // ========================================
  if (playerPortfolios.length === 0) {
    console.log(`⚠️ Game ${game.gameId}: No players - Marlow wins by default`);

    // Mark Marlow as winner
    await Portfolio.updateOne(
      { portfolioId: apePortfolio.portfolioId },
      {
        $set: {
          status: 'WON',
          'gameOutcome.isWinner': true,
          'gameOutcome.reward': '0',
          'gameOutcome.rank': 1,
          'gameOutcome.settledAt': new Date(),
        },
      }
    );

    game.winners.push({
      userId: apePortfolio.userId?._id || apePortfolio.userId,
      portfolioId: apePortfolio.portfolioId,
      performancePercentage: apePortfolio.performancePercentage,
      reward: '0',
      isRewardDistributed: true,
      distributionTransactionHash: 'APE_SYSTEM_WIN_NO_PLAYERS',
    });

    game.hasCalculatedWinners = true;
    await game.markWinnerCalculated();
    return;
  }

  // Split into winners (beat ape) and losers
  const winners = playerPortfolios.filter((p) => p.currentValue > apeValue);
  const losers = playerPortfolios.filter((p) => p.currentValue <= apeValue);
  const marlowWins = winners.length === 0;

  // Log standings
  console.log('\n📊 Top 10 Standings:');
  playerPortfolios.slice(0, 10).forEach((p, i) => {
    const icon = p.currentValue > apeValue ? '✅' : '❌';
    console.log(`${i + 1}. ${icon} Portfolio ${p.portfolioId}: $${p.currentValue.toLocaleString()}`);
  });

  // Helper: Process a loser portfolio
  const processLoser = async (portfolio, rank) => {
    const userId = portfolio.userId?._id || portfolio.userId;
    await Portfolio.updateOne(
      { portfolioId: portfolio.portfolioId },
      {
        $set: {
          status: 'LOST',
          'gameOutcome.isWinner': false,
          'gameOutcome.reward': '0',
          'gameOutcome.rank': rank,
          'gameOutcome.settledAt': new Date(),
        },
      }
    );
    const user = await User.findById(userId);
    if (user)
      await user.updateGameStats(game.gameId, portfolio.portfolioId, portfolio.performancePercentage, 0, rank);
    await new Notification({
      userId,
      type: 'PORTFOLIO_LOST',
      message: `Your portfolio "${portfolio.portfolioName}" did not beat Marlow Banes this round.`,
      metadata: { portfolioId: portfolio._id, gameId: game.gameId },
    }).save();
  };

  if (marlowWins) {
    // ============================================================
    // MARLOW WINS - Prize stays in contract
    // ============================================================
    console.log(`\n🎯 Marlow wins! Prize pool stays in contract.`);

    // Mark Marlow as winner
    await Portfolio.updateOne(
      { portfolioId: apePortfolio.portfolioId },
      {
        $set: {
          status: 'WON',
          'gameOutcome.isWinner': true,
          'gameOutcome.reward': '0',
          'gameOutcome.rank': 1,
          'gameOutcome.settledAt': new Date(),
        },
      }
    );
    game.winners.push({
      userId: apePortfolio.userId?._id || apePortfolio.userId,
      portfolioId: apePortfolio.portfolioId,
      performancePercentage: apePortfolio.performancePercentage,
      reward: '0',
      isRewardDistributed: true,
      distributionTransactionHash: 'APE_SYSTEM_WIN',
    });

    // Mark all players as losers
    await Promise.all(playerPortfolios.map((p) => processLoser(p, 2)));

    console.log(`✅ Complete: Marlow wins, ${playerPortfolios.length} players lost`);
  } else {
    // ============================================================
    // PLAYERS WIN - Distribute rewards equally among winners
    // ============================================================
    const rewardPerWinner = totalPrizePool / BigInt(winners.length);
    console.log(
      `\n🎯 ${winners.length} players beat the ape! Reward: $${(Number(rewardPerWinner) / 1e18).toFixed(2)} each`
    );

    // Process winners
    for (let i = 0; i < winners.length; i++) {
      const portfolio = winners[i];
      const userId = portfolio.userId?._id || portfolio.userId;
      const rank = i + 1;

      game.winners.push({
        userId,
        portfolioId: portfolio.portfolioId,
        performancePercentage: portfolio.performancePercentage,
        isRewardDistributed: false,
      });
      await portfolio.markAsWinner(rewardPerWinner.toString(), rank);

      const user = await User.findById(userId);
      if (user)
        await user.updateGameStats(
          game.gameId,
          portfolio.portfolioId,
          portfolio.performancePercentage,
          parseFloat(rewardPerWinner.toString()),
          rank
        );

      await new Notification({
        userId,
        type: 'PORTFOLIO_WON',
        message: `Congratulations! Your portfolio "${portfolio.portfolioName}" beat Marlow Banes!`,
        metadata: { portfolioId: portfolio._id, gameId: game.gameId },
      }).save();
    }

    // Mark Marlow as loser
    const marlowRank = winners.length + 1;
    await Portfolio.updateOne(
      { portfolioId: apePortfolio.portfolioId },
      {
        $set: {
          status: 'LOST',
          'gameOutcome.isWinner': false,
          'gameOutcome.reward': '0',
          'gameOutcome.rank': marlowRank,
          'gameOutcome.settledAt': new Date(),
        },
      }
    );
    console.log(`🦍 Marlow LOST - ranked #${marlowRank}`);

    // Mark losing players
    await Promise.all(losers.map((p) => processLoser(p, marlowRank)));

    console.log(`✅ Complete: ${winners.length} winners, ${losers.length} losers`);
  }

  game.hasCalculatedWinners = true;
  await game.markWinnerCalculated();
}

module.exports = {
  calculateWinners,
};

