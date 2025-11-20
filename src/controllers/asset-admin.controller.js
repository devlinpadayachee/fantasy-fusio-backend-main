const { asyncHandler } = require("../middleware/error");
const Asset = require("../models/Asset");
const Game = require("../models/Game");
const Portfolio = require("../models/Portfolio");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

// @desc    Update ape status for multiple assets
// @route   PUT /api/admin/assets/ape
// @access  Admin
exports.updateApeAssets = asyncHandler(async (req, res) => {
  const { assetIds, type } = req.body;

  if (!Array.isArray(assetIds)) {
    res.status(400);
    throw new Error("assetIds must be an array");
  }

  if (assetIds.length < 8) {
    res.status(400);
    throw new Error("Select at least 8 assets!");
  }

  if (!type || (type !== "TRADFI" && type !== "DEFI")) {
    res.status(400);
    throw new Error("type must be either TRADFI or DEFI");
  }

  // Reset all assets' ape status to false for the specified type
  await Asset.updateMany({ type }, { ape: false });

  // Set ape status to true for selected assets of the specified type
  if (assetIds.length > 0) {
    await Asset.updateMany({ assetId: { $in: assetIds }, type }, { ape: true });
  }

  // Get updated assets filtered by type
  const updatedAssets = await Asset.find({ assetId: { $in: assetIds }, type })
    .select("assetId symbol name ape")
    .sort("assetId");

  res.json({
    message: "Ape assets updated successfully",
    assets: updatedAssets,
  });
});

// @desc    Get all ape assets
// @route   GET /api/admin/assets/ape
// @access  Admin
exports.getApeAssets = asyncHandler(async (req, res) => {
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
});

// @desc    Get all games for admin
// @route   GET /api/admin/games
// @access  Admin
exports.getAllGames = asyncHandler(async (req, res) => {
  const games = await Game.find({}).sort({ createdAt: -1 });

  const formattedGames = games.map((game, index) => ({
    srNo: index + 1,
    _id: game._id,
    gameTitle: `${game.name} #${game.gameId}`,
    gameMode: game.gameType,
    prizePool: game.totalPrizePool,
    totalParticipants: game.participantCount,
    startTime: game.startTime,
    endTime: game.endTime,
    gameStatus: game.status,
  }));

  res.json(formattedGames);
});

// @desc    Get all games filtered by gameCronId
// @route   GET /api/admin/assets/games
// @access  Admin
exports.getGamesByGameCronId = asyncHandler(async (req, res) => {
  const { gameCronId } = req.query;

  // Build query
  let query = {};
  if (gameCronId) {
    query.gameCronId = gameCronId;
  }

  const games = await Game.find(query)
    .populate("gameCronId", "customGameName creationTime")
    .sort({ createdAt: -1 });

  const formattedGames = games.map((game, index) => ({
    srNo: index + 1,
    _id: game._id,
    gameTitle: `${game.name} #${game.gameId}`,
    gameMode: game.gameType,
    prizePool: game.totalPrizePool,
    totalParticipants: game.participantCount,
    startTime: game.startTime,
    endTime: game.endTime,
    gameStatus: game.status,
    gameCronId: game.gameCronId,
    gameCronName: game.gameCronId?.customGameName || "N/A",
  }));

  res.json(formattedGames);
});

// @desc    Get all portfolios for admin with filtering
// @route   GET /api/admin/portfolios
// @access  Admin
exports.getAllPortfolios = asyncHandler(async (req, res) => {
  const { username, walletAddress, type, status } = req.query;

  // Build portfolio query
  let portfolioQuery = {};
  if (type) {
    portfolioQuery.gameType = type;
  }
  if (status) {
    portfolioQuery.status = status;
  }

  // Build user query for filtering
  let userQuery = {};
  if (username) {
    userQuery.username = { $regex: username, $options: "i" };
  }
  if (walletAddress) {
    userQuery.address = { $regex: walletAddress, $options: "i" };
  }

  // First get users that match the criteria if user filters are applied
  let userIds = null;
  if (username || walletAddress) {
    const User = require("../models/User");
    const matchingUsers = await User.find(userQuery).select("_id");
    userIds = matchingUsers.map((user) => user._id);

    // If no users match the criteria, return empty result
    if (userIds.length === 0) {
      return res.json([]);
    }

    portfolioQuery.userId = { $in: userIds };
  }

  const portfolios = await Portfolio.find(portfolioQuery)
    .populate("userId", "username address")
    .sort({ createdAt: -1 });

  // Get all games to create a lookup map
  const games = await Game.find({});
  const gameMap = {};
  games.forEach((game) => {
    gameMap[game.gameId] = game;
  });

  // Create a map of asset symbol to asset details for quick lookup
  const allAssets = await Asset.find({});
  const assetMap = {};
  allAssets.forEach((asset) => {
    assetMap[asset.symbol] = asset;
  });

  const formattedPortfolios = portfolios.map((portfolio, index) => {
    const game = gameMap[portfolio.gameId];
    const gameTitle = game
      ? `${game.gameType} Game #${game.gameId}`
      : `Game #${portfolio.gameId}`;

    // Format assets as an array of objects with symbol, allocation, and imageUrl
    const assetsArray = portfolio.assets.map((asset) => ({
      symbol: asset.symbol,
      allocation: asset.allocation,
      imageUrl: assetMap[asset.symbol]?.imageUrl || null,
    }));

    return {
      srNo: index + 1,
      username: portfolio.portfolioName?.username || "N/A",
      portfolioName: portfolio.portfolioName || "N/A",
      walletAddress: portfolio.userId?.address || "N/A",
      type: portfolio.gameType,
      assets: assetsArray,
      currentValue: portfolio.currentValue,
      status: portfolio.status,
      createdAt: portfolio.createdAt,
      gameId: portfolio.gameId,
      gameName: gameTitle,
    };
  });

  res.json(formattedPortfolios);
});

// @desc    Get all users for admin
// @route   GET /api/admin/users
// @access  Admin
exports.getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({}).sort({ createdAt: -1 });

  const formattedUsers = users.map((user, index) => ({
    srNo: index + 1,
    username: user.username || "N/A",
    walletAddress: user.address,
    gamesWon: user.gamesWon || 0,
    earnings: user.totalEarnings || 0,
    lockedAmount: user.lockedBalance || 0,
    createdAt: user.createdAt,
  }));

  res.json(formattedUsers);
});

// @desc    Get all transactions for admin with filtering
// @route   GET /api/admin/transactions
// @access  Admin
exports.getAllTransactions = asyncHandler(async (req, res) => {
  const { transactionHash, type, portfolioId, fromAddress, toAddress, status } =
    req.query;

  // Build transaction query
  let transactionQuery = {};

  if (transactionHash) {
    transactionQuery.transactionHash = {
      $regex: transactionHash,
      $options: "i",
    };
  }
  if (type) {
    transactionQuery.type = type;
  }
  if (portfolioId) {
    transactionQuery.portfolioId = parseInt(portfolioId);
  }
  if (fromAddress) {
    transactionQuery.fromAddress = { $regex: fromAddress, $options: "i" };
  }
  if (toAddress) {
    transactionQuery.toAddress = { $regex: toAddress, $options: "i" };
  }
  if (status) {
    transactionQuery.status = status;
  }

  const transactions = await Transaction.find(transactionQuery).sort({
    createdAt: -1,
  });

  const formattedTransactions = transactions.map((transaction, index) => ({
    srNo: index + 1,
    transactionHash: transaction.transactionHash,
    type: transaction.type,
    amount: transaction.amount,
    portfolioId: transaction.portfolioId || "N/A",
    fromAddress: transaction.fromAddress,
    toAddress: transaction.toAddress,
    networkFees: transaction.networkFee,
    status: transaction.status,
  }));

  res.json(formattedTransactions);
});
