/**
 * Discord Notification Service
 *
 * Posts Marlow's AI analysis and game updates to Discord
 */

const axios = require("axios");
const config = require("../config");

class DiscordService {
  constructor() {
    this.webhookUrl = config.discord?.marlowWebhook;
    this.enabled = config.discord?.enabled || false;

    if (this.enabled) {
      console.log("🎮 Discord notifications ENABLED");
    }
  }

  /**
   * Post Marlow's portfolio picks to Discord
   * @param {Object} game - Game object
   * @param {Object} portfolio - Marlow's portfolio
   * @param {Object} aiResult - AI analysis result from marlow-ai.service
   */
  async postMarlowPicks(game, portfolio, aiResult) {
    if (!this.enabled || !this.webhookUrl) {
      console.log("Discord notifications disabled, skipping Marlow announcement");
      return;
    }

    try {
      const strategy = aiResult.strategy || {};
      const assets = aiResult.assets || [];
      const allocations = aiResult.allocations || [];

      // Build the embed
      const embed = {
        title: "🦍🧠 MARLOW BANES - AI PORTFOLIO LOCKED",
        description: `**Game #${game.gameId}** - ${game.name}\n\nMarlow has analyzed the market and locked his picks!`,
        color: this.getRegimeColor(strategy.marketRegime),
        thumbnail: {
          url: "https://fantasyfinance.org/common/marlow-avatar.png", // Replace with actual Marlow avatar
        },
        fields: [
          {
            name: "📊 Market Analysis",
            value: this.formatMarketAnalysis(strategy),
            inline: false,
          },
          {
            name: "🎯 Strategy",
            value: `**${strategy.type || "Adaptive"}**\nConfidence: ${strategy.confidence || "MEDIUM"}`,
            inline: true,
          },
          {
            name: "📈 Market Regime",
            value: `${this.getRegimeEmoji(strategy.marketRegime)} **${strategy.marketRegime || "NEUTRAL"}**\nFear/Greed: ${strategy.fearGreedIndex || 50}`,
            inline: true,
          },
          {
            name: "🪙 Portfolio Picks",
            value: this.formatPicks(assets, allocations),
            inline: false,
          },
        ],
        footer: {
          text: `Game Type: ${game.gameType} | Total: $100,000`,
        },
        timestamp: new Date().toISOString(),
      };

      // Send to Discord
      await axios.post(this.webhookUrl, {
        username: "Marlow Banes",
        avatar_url: "https://fantasyfinance.org/common/marlow-avatar.png",
        embeds: [embed],
      });

      console.log(`🎮 Discord: Marlow picks posted for game ${game.gameId}`);
    } catch (error) {
      console.error("Discord notification failed:", error.message);
      // Don't throw - Discord failures shouldn't break game flow
    }
  }

  /**
   * Post game start notification
   */
  async postGameStarted(game, participantCount) {
    if (!this.enabled || !this.webhookUrl) return;

    try {
      const embed = {
        title: "🎮 GAME STARTED!",
        description: `**${game.name}** is now LIVE!\n\nAll portfolios are locked and the competition begins!`,
        color: 0x00ff00, // Green
        fields: [
          {
            name: "👥 Participants",
            value: `${participantCount} players`,
            inline: true,
          },
          {
            name: "🏆 Win Condition",
            value: game.winCondition?.type || "MARLOW_BANES",
            inline: true,
          },
          {
            name: "⏰ Ends",
            value: `<t:${Math.floor(new Date(game.endTime).getTime() / 1000)}:R>`,
            inline: true,
          },
        ],
        footer: {
          text: `Game #${game.gameId} | ${game.gameType}`,
        },
        timestamp: new Date().toISOString(),
      };

      await axios.post(this.webhookUrl, {
        username: "Fantasy Finance",
        embeds: [embed],
      });

      console.log(`🎮 Discord: Game start posted for game ${game.gameId}`);
    } catch (error) {
      console.error("Discord game start notification failed:", error.message);
    }
  }

  /**
   * Post game results
   */
  async postGameResults(game, winners, marlowWon) {
    if (!this.enabled || !this.webhookUrl) return;

    try {
      const topWinners = winners.slice(0, 5);
      const winnersList = topWinners
        .map((w, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏅";
          return `${medal} **${w.portfolioName || w.username}** - ${w.performancePercentage?.toFixed(2)}%`;
        })
        .join("\n");

      const embed = {
        title: marlowWon ? "🦍👑 MARLOW WINS!" : "🎉 GAME COMPLETED!",
        description: marlowWon
          ? `**Marlow Banes** beat all players in **${game.name}**!\n\nThe prize pool is retained.`
          : `**${game.name}** has ended!\n\nCongratulations to the winners!`,
        color: marlowWon ? 0xff6b00 : 0x00ff00,
        fields: [
          {
            name: "🏆 Top Performers",
            value: winnersList || "No winners",
            inline: false,
          },
        ],
        footer: {
          text: `Game #${game.gameId} | ${game.gameType}`,
        },
        timestamp: new Date().toISOString(),
      };

      await axios.post(this.webhookUrl, {
        username: marlowWon ? "Marlow Banes" : "Fantasy Finance",
        embeds: [embed],
      });

      console.log(`🎮 Discord: Game results posted for game ${game.gameId}`);
    } catch (error) {
      console.error("Discord game results notification failed:", error.message);
    }
  }

  // ═══════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════

  formatMarketAnalysis(strategy) {
    const parts = [];
    if (strategy.bullishPicks > 0) parts.push(`📈 ${strategy.bullishPicks} momentum plays`);
    if (strategy.valuePicks > 0) parts.push(`💎 ${strategy.valuePicks} value picks`);
    if (strategy.highVolatility > 0) parts.push(`⚡ ${strategy.highVolatility} high-vol assets`);
    if (strategy.positiveSentiment > 0) parts.push(`📰 ${strategy.positiveSentiment} +sentiment`);

    return parts.length > 0 ? parts.join(" | ") : "Balanced approach";
  }

  formatPicks(assets, allocations) {
    if (!assets || assets.length === 0) return "No picks available";

    return assets
      .slice(0, 8)
      .map((asset, i) => {
        const alloc = allocations[i] ? `${(allocations[i] / 1000).toFixed(0)}%` : "N/A";
        const score = asset.score ? asset.score.toFixed(0) : "?";
        const reason = asset.reasoning?.[0] || "";
        return `**${i + 1}. ${asset.symbol}** (${alloc}) - Score: ${score} ${reason}`;
      })
      .join("\n");
  }

  getRegimeColor(regime) {
    switch (regime) {
      case "BULL":
        return 0x00ff00; // Green
      case "BEAR":
        return 0xff0000; // Red
      default:
        return 0xffaa00; // Orange/Amber
    }
  }

  getRegimeEmoji(regime) {
    switch (regime) {
      case "BULL":
        return "📈";
      case "BEAR":
        return "📉";
      default:
        return "➡️";
    }
  }
}

module.exports = new DiscordService();

