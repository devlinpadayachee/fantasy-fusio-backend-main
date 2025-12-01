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
    return res.status(400).json({ error: "Invalid asset type. Must be DEFI or TRADFI" });
  }

  const assets = await Asset.find({
    type: type.toUpperCase(),
    isActive: true,
  })
    .select("assetId symbol name currentPrice change24h lastUpdated imageUrl ape")
    .sort("assetId");

  res.json(assets);
});

// @desc    Get all games for admin
// @route   GET /api/admin/games
// @access  Admin
exports.getAllGames = asyncHandler(async (req, res) => {
  const ethers = require("ethers");
  const games = await Game.find({}).sort({ createdAt: -1 });

  // Helper function to convert wei to USDC dollars
  const weiToUSDC = (weiValue) => {
    if (!weiValue) return 0;
    const weiStr = String(weiValue);
    return parseFloat(ethers.utils.formatUnits(weiStr, 18));
  };

  const formattedGames = games.map((game, index) => ({
    srNo: index + 1,
    _id: game._id,
    gameTitle: `${game.name} #${game.gameId}`,
    gameMode: game.gameType,
    prizePool: weiToUSDC(game.totalPrizePool), // Convert to dollars
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

  const ethers = require("ethers");
  const games = await Game.find(query).populate("gameCronId", "customGameName creationTime").sort({ createdAt: -1 });

  // Helper function to convert wei to USDC dollars
  const weiToUSDC = (weiValue) => {
    if (!weiValue) return 0;
    const weiStr = String(weiValue);
    return parseFloat(ethers.utils.formatUnits(weiStr, 18));
  };

  const formattedGames = games.map((game, index) => ({
    srNo: index + 1,
    _id: game._id,
    gameId: game.gameId,
    gameTitle: `${game.name} #${game.gameId}`,
    gameName: game.name,
    gameMode: game.gameType,
    prizePool: weiToUSDC(game.totalPrizePool), // Convert to dollars
    totalParticipants: game.participantCount,
    startTime: game.startTime,
    endTime: game.endTime,
    gameStatus: game.status,
    winCondition: game.winCondition?.type,
    gameCronId: game.gameCronId,
    gameCronName: game.gameCronId?.customGameName || "N/A",
  }));

  res.json(formattedGames);
});

// @desc    Get all portfolios for admin with filtering and pagination
// @route   GET /api/admin/portfolios
// @access  Admin
exports.getAllPortfolios = asyncHandler(async (req, res) => {
  const { username, walletAddress, type, status, search, page = 1, limit = 20 } = req.query;

  // Parse pagination params
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  // Build portfolio query
  let portfolioQuery = {};
  if (type) {
    portfolioQuery.gameType = type;
  }
  if (status) {
    portfolioQuery.status = status;
  }

  // Handle search (searches wallet address, username, or portfolio name)
  const searchTerm = search || walletAddress || username;
  let userIds = null;

  if (searchTerm) {
    const User = require("../models/User");
    // Search users by username or wallet address
    const matchingUsers = await User.find({
      $or: [
        { username: { $regex: searchTerm, $options: "i" } },
        { address: { $regex: searchTerm, $options: "i" } },
      ],
    }).select("_id");
    userIds = matchingUsers.map((user) => user._id);

    // Build OR query for portfolio name or matching user IDs
    portfolioQuery.$or = [{ portfolioName: { $regex: searchTerm, $options: "i" } }];
    if (userIds.length > 0) {
      portfolioQuery.$or.push({ userId: { $in: userIds } });
    }
  }

  // Get total count for pagination (efficient with countDocuments)
  const totalCount = await Portfolio.countDocuments(portfolioQuery);

  // Fetch paginated portfolios
  const portfolios = await Portfolio.find(portfolioQuery)
    .populate("userId", "username address")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean(); // Use lean() for better performance

  // Get unique gameIds from this page's portfolios for efficient lookup
  const gameIds = [...new Set(portfolios.map((p) => p.gameId))];
  const games = await Game.find({ gameId: { $in: gameIds } }).lean();
  const gameMap = Object.fromEntries(games.map((g) => [g.gameId, g]));

  // Get unique asset symbols for efficient lookup
  const assetSymbols = [...new Set(portfolios.flatMap((p) => p.assets.map((a) => a.symbol)))];
  const assets = await Asset.find({ symbol: { $in: assetSymbols } }).lean();
  const assetMap = Object.fromEntries(assets.map((a) => [a.symbol, a]));

  // Format portfolios
  const formattedPortfolios = portfolios.map((portfolio, index) => {
    const game = gameMap[portfolio.gameId];
    const gameTitle = game ? `${game.gameType} Game #${game.gameId}` : `Game #${portfolio.gameId}`;

    return {
      srNo: skip + index + 1,
      username: portfolio.userId?.username || "N/A",
      portfolioName: portfolio.portfolioName || "N/A",
      walletAddress: portfolio.userId?.address || "N/A",
      type: portfolio.gameType,
      assets: portfolio.assets.map((asset) => ({
        symbol: asset.symbol,
        allocation: asset.allocation,
        imageUrl: assetMap[asset.symbol]?.imageUrl || null,
      })),
      currentValue: portfolio.currentValue,
      status: portfolio.status,
      createdAt: portfolio.createdAt,
      gameId: portfolio.gameId,
      gameName: gameTitle,
    };
  });

  res.json({
    portfolios: formattedPortfolios,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      hasMore: pageNum * limitNum < totalCount,
    },
  });
});

// @desc    Get all users for admin
// @route   GET /api/admin/users
// @access  Admin
exports.getAllUsers = asyncHandler(async (req, res) => {
  const ethers = require("ethers");
  const users = await User.find({}).sort({ createdAt: -1 });

  // Helper function to convert wei to USDC dollars
  const weiToUSDC = (weiValue) => {
    if (!weiValue) return 0;
    const weiStr = String(weiValue);
    return parseFloat(ethers.utils.formatUnits(weiStr, 18));
  };

  const formattedUsers = users.map((user, index) => ({
    srNo: index + 1,
    username: user.username || "N/A",
    walletAddress: user.address,
    gamesWon: user.gamesWon || 0,
    totalEarnings: weiToUSDC(user.totalEarnings),
    lockedBalance: weiToUSDC(user.lockedBalance),
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
  }));

  res.json(formattedUsers);
});

// @desc    Get all transactions for admin with filtering
// @route   GET /api/admin/transactions
// @access  Admin
exports.getAllTransactions = asyncHandler(async (req, res) => {
  const { transactionHash, type, portfolioId, fromAddress, toAddress, status } = req.query;

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

  const ethers = require("ethers");
  const transactions = await Transaction.find(transactionQuery).sort({
    createdAt: -1,
  });

  // Helper function to convert wei to USDC dollars
  const weiToUSDC = (weiValue) => {
    if (!weiValue) return 0;
    const weiStr = String(weiValue);
    return parseFloat(ethers.utils.formatUnits(weiStr, 18));
  };

  const formattedTransactions = transactions.map((transaction, index) => ({
    id: index + 1,
    transactionHash: transaction.transactionHash,
    type: transaction.type,
    amount: weiToUSDC(transaction.amount), // Convert to dollars
    portfolioId: transaction.portfolioId || "N/A",
    fromAddress: transaction.fromAddress,
    toAddress: transaction.toAddress,
    networkFees: weiToUSDC(transaction.networkFee), // Convert to dollars
    status: transaction.status,
    createdAt: transaction.createdAt,
  }));

  res.json(formattedTransactions);
});
