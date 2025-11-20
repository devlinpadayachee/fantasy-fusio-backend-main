const express = require('express');
const router = express.Router();
const assetController = require('../controllers/asset.controller');

// Get all assets
router.get('/', assetController.getAllAssets);

// Get assets by type (DEFI or TRADFI)
router.get('/type/:type', assetController.getAssetsByType);

// Get 24h changes by type
router.get('/changes/type/:type', assetController.get24hChangesByType);

// Get 24h changes for all assets
router.get('/changes/24h', assetController.get24hChanges);

// Get specific asset details
router.get('/:assetId', assetController.getAssetDetails);

// Get price history for multiple assets
// Can include type in request body to filter by type
router.post('/price-history', assetController.getPriceHistory);

module.exports = router;
