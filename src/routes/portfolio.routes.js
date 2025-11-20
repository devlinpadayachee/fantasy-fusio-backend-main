const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolio.controller');
const { authenticate } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

/**
 * @route GET /api/portfolio/pending-count
 * @desc Get count of user's pending portfolios and allowed count based on locked balance
 * @access Private
 */
router.get('/pending-count', portfolioController.getPendingPortfoliosCount);


/**
 * @route POST /api/portfolio/submit
 * @desc Submit new portfolio request
 * @access Private
 */
router.post('/submit', portfolioController.submitPortfolio);

/**
 * @route POST /api/portfolio/submit-pending
 * @desc Submit new portfolio request without blockchain validation
 * @access Private
 */
router.post('/submit-pending', portfolioController.submitPendingPortfolio);

/**
 * @route POST /api/portfolio/store-hash/:portfolioId
 * @desc Store transaction hash for a pending portfolio
 * @access Private
 */
router.post('/store-hash/:portfolioId', portfolioController.storeTransactionHash);

/**
 * @route GET /api/portfolio/check-transaction/:portfolioId
 * @desc Check transaction status for a portfolio
 * @access Private
 */
router.get('/check-transaction/:portfolioId', portfolioController.checkTransactionStatus);

/**
 * @route GET /api/portfolio/user
 * @desc Get user's portfolios with optional filters
 * @query gameType - Filter by game type (DEFI/TRADFI)
 * @query status - Filter by status (PENDING/ACTIVE/COMPLETED)
 * @query sort - Sort by (createdAt/performance/value)
 * @access Private
 */
router.get('/user', portfolioController.getUserPortfolios);

/**
 * @route GET /api/portfolio/game/:gameId
 * @desc Get all portfolios for a specific game by gameId
 * @param gameId - Game ID (number)
 * @query status - Filter by status (optional)
 * @access Private
 */
router.get('/game/:gameId', portfolioController.getPortfoliosByGameType);

/**
 * @route GET /api/portfolio/:portfolioId
 * @desc Get specific portfolio details with enhanced game information
 * @param portfolioId - Portfolio ID
 * @access Private
 */
router.get('/:portfolioId', portfolioController.getPortfolioDetails);

/**
 * @route GET /api/portfolio/:portfolioId/history
 * @desc Get portfolio performance history
 * @param portfolioId - Portfolio ID
 * @access Private
 */
router.get('/:portfolioId/history', portfolioController.getPortfolioHistory);

/**
 * @route GET /api/portfolio/:portfolioId/compare
 * @desc Get portfolio comparison with Ape
 * @param portfolioId - Portfolio ID
 * @access Private
 */
router.put('/compare', portfolioController.getPortfolioComparison);

/**
 * @route PUT /api/portfolio/:portfolioId
 * @desc Edit portfolio name and assets if not locked
 * @param portfolioId - Portfolio ID
 * @access Private
 */
router.put('/', portfolioController.editPortfolio);

module.exports = router;
