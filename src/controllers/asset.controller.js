const { asyncHandler } = require("../middleware/error");
const Asset = require("../models/Asset");

const assetController = {
  // Get assets by type (DEFI or TRADFI)
  getAssetsByType: asyncHandler(async (req, res) => {
    const { type } = req.params;

    if (!["DEFI", "TRADFI"].includes(type.toUpperCase())) {
      return res
        .status(400)
        .json({ error: "Invalid asset type. Must be DEFI or TRADFI" });
    }

    const assets = await Asset.find({
      type: type.toUpperCase(),
      isActive: true,
    })
      .select(
        "assetId symbol name currentPrice change24h lastUpdated imageUrl ape"
      )
      .sort("assetId");
    res.json(assets);
  }),

  // Get all assets with current prices and 24h changes
  getAllAssets: asyncHandler(async (req, res) => {
    const assets = await Asset.find({ isActive: true }).select(
      "assetId symbol name type currentPrice change24h lastUpdated"
    );

    const response = {
      defi: assets.filter((a) => a.type === "DEFI"),
      tradfi: assets.filter((a) => a.type === "TRADFI"),
    };

    res.json(response);
  }),

  // Get specific asset details with price history
  getAssetDetails: asyncHandler(async (req, res) => {
    const { assetId } = req.params;

    const asset = await Asset.findOne({ assetId, isActive: true });
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    res.json({
      assetId: asset.assetId,
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type,
      currentPrice: asset.currentPrice,
      change24h: asset.change24h,
      priceHistory: asset.priceHistory,
      lastUpdated: asset.lastUpdated,
      imageUrl: asset.imageUrl,
    });
  }),

  // Get price history for multiple assets
  getPriceHistory: asyncHandler(async (req, res) => {
    const { assetIds, type } = req.body;

    if (!Array.isArray(assetIds)) {
      return res.status(400).json({ error: "Asset IDs must be an array" });
    }

    const query = {
      assetId: { $in: assetIds },
      isActive: true,
    };

    // Add type filter if provided
    if (type && ["DEFI", "TRADFI"].includes(type.toUpperCase())) {
      query.type = type.toUpperCase();
    }

    const assets = await Asset.find(query);

    const priceHistory = {};
    assets.forEach((asset) => {
      priceHistory[asset.symbol] = {
        currentPrice: asset.currentPrice,
        change24h: asset.change24h,
        type: asset.type,
        history: asset.priceHistory,
      };
    });

    res.json(priceHistory);
  }),

  // Get 24h price changes by type
  get24hChangesByType: asyncHandler(async (req, res) => {
    const { type } = req.params;

    if (!["DEFI", "TRADFI"].includes(type.toUpperCase())) {
      return res
        .status(400)
        .json({ error: "Invalid asset type. Must be DEFI or TRADFI" });
    }

    const assets = await Asset.find({
      type: type.toUpperCase(),
      isActive: true,
    }).select("symbol currentPrice change24h");

    const changes = assets.map((asset) => ({
      symbol: asset.symbol,
      currentPrice: asset.currentPrice,
      change24h: asset.change24h,
    }));

    res.json(changes);
  }),

  // Get 24h price changes for all assets
  get24hChanges: asyncHandler(async (req, res) => {
    const assets = await Asset.find({ isActive: true }).select(
      "symbol type currentPrice change24h"
    );

    const changes = {
      defi: assets
        .filter((a) => a.type === "DEFI")
        .map((a) => ({
          symbol: a.symbol,
          currentPrice: a.currentPrice,
          change24h: a.change24h,
        })),
      tradfi: assets
        .filter((a) => a.type === "TRADFI")
        .map((a) => ({
          symbol: a.symbol,
          currentPrice: a.currentPrice,
          change24h: a.change24h,
        })),
    };

    res.json(changes);
  }),
};

module.exports = assetController;
