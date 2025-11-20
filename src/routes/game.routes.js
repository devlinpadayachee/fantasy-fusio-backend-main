const express = require("express");
const router = express.Router();
const gameController = require("../controllers/game.controller");
const portfolioController = require("../controllers/portfolio.controller");
const { authenticate } = require("../middleware/auth");

// Public routes
/**
 * @route GET /api/portfolio/dashboard
 * @desc Get user's dashboard data including portfolios and active game
 * @query userId - User ID (optional if wallet provided)
 * @query wallet - User wallet address (optional if userId provided)
 * @query gameType - Filter by game type (DEFI/TRADFI)
 * @access Private
 */
router.get("/dashboard", authenticate, portfolioController.getDashboard);
router.get("/status", gameController.getGameStatus);
router.get("/leaderboard/global", gameController.getGlobalLeaderboard);
router.get("/:gameId/leaderboard", gameController.getLeaderboard);
router.get("/history", authenticate, gameController.getGameHistory);
router.get("/upcoming", gameController.getUpcomingGames);
router.get("/:gameId", gameController.getGameDetails);
router.get("/check/:gameId/:portfolioType", gameController.checkGameStatus);

// router.get('/assets', gameController.getAvailableAssets);

// USDC balance and approval routes
router.get("/usdc-balance", authenticate, gameController.getUSDCBalance);
router.get(
  "/balance/approval/:gameId",
  authenticate,
  gameController.getBalanceApproval
);
router.get("/required-approval/:gameId", authenticate, gameController.getRequiredApproval);

// Protected routes (require authentication)
// router.use(authenticate);
// router.post('/portfolio', gameController.submitPortfolio);
// router.get('/portfolio/current', gameController.getCurrentPortfolio);
// router.get('/portfolio/:portfolioId', gameController.getPortfolioDetails);
// router.get('/portfolio/:portfolioId/history', gameController.getPortfolioHistory);
// router.get('/portfolio/:portfolioId/comparison', gameController.getPortfolioComparison);

module.exports = router;
