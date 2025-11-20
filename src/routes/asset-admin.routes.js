const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const adminController = require('../controllers/admin.controller');
const {
  updateApeAssets,
  getApeAssets,
  getAllGames,
  getAllPortfolios,
  getAllUsers,
  getAllTransactions,
  getGamesByGameCronId,
} = require("../controllers/asset-admin.controller");

router.use(authenticateAdmin);

router.route("/ape").get(getApeAssets).put(updateApeAssets);

router.get("/games", getAllGames);
router.get("/cron-id-games", getGamesByGameCronId);
router.get('/portfolios', getAllPortfolios);
router.get('/users', getAllUsers);
router.get('/transactions', getAllTransactions);

// New route for admin analytics dashboard
router.get('/analytics', adminController.getAnalytics);

module.exports = router;
