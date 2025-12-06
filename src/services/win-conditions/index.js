/**
 * Win Condition Calculators
 *
 * Each game type has its own calculator module that handles:
 * - Winner determination based on the specific win condition rules
 * - Reward calculation and distribution logic
 * - Edge case handling (missing tiers, no players, etc.)
 */

const marlowBanesCalculator = require("./marlow-banes.service");
const equalDistributeCalculator = require("./equal-distribute.service");
const tieredCalculator = require("./tiered.service");

module.exports = {
  marlowBanesCalculator,
  equalDistributeCalculator,
  tieredCalculator,

  /**
   * Get the appropriate calculator for a win condition type
   * @param {string} type - The win condition type (MARLOW_BANES, EQUAL_DISTRIBUTE, TIERED)
   * @returns {Object} The calculator module for that type
   */
  getCalculator(type) {
    switch (type) {
      case "MARLOW_BANES":
        return marlowBanesCalculator;
      case "EQUAL_DISTRIBUTE":
        return equalDistributeCalculator;
      case "TIERED":
        return tieredCalculator;
      default:
        throw new Error(`Unknown win condition type: ${type}`);
    }
  },
};
