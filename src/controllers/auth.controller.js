const { asyncHandler } = require("../middleware/error");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const ethers = require("ethers");
const config = require("../config");
const blockchainService = require("../services/blockchain.service");

const authController = {
  // Generate nonce for wallet connection
  getNonce: asyncHandler(async (req, res) => {
    const { address } = req.body;

    // Check if address is provided
    if (!address) {
      return res.status(400).json({ error: "Wallet address is required" });
    }

    // Validate address format
    if (!ethers.utils.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const normalizedAddress = address.toLowerCase();
    let user = await User.findByAddress(normalizedAddress);
    if (!user) {
      // Create new user if not exists
      try {
        user = await User.create({
          address: normalizedAddress,
          nonce: Math.floor(Math.random() * 1000000).toString(),
        });
      } catch (error) {
        console.error("Error creating user:", error);
        return res.status(500).json({ error: "Failed to create user" });
      }
    } else {
      // Generate new nonce for existing user
      await user.generateNonce();
    }

    res.json({
      nonce: user.nonce,
      message: `Welcome to Portfolio Competition Game!\n\nPlease sign this message to verify your wallet ownership.\n\nNonce: ${user.nonce}`,
    });
  }),

  // Verify signature and generate JWT token
  verifySignature: asyncHandler(async (req, res) => {
    const { address, signature } = req.body;

    // Check if required fields are provided
    if (!address || !signature) {
      return res.status(400).json({ error: "Wallet address and signature are required" });
    }

    if (!ethers.utils.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address format" });
    }

    const normalizedAddress = address.toLowerCase();
    const user = await User.findByAddress(normalizedAddress);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Construct the message that was signed
    const message = `Welcome to Portfolio Competition Game!\n\nPlease sign this message to verify your wallet ownership.\n\nNonce: ${user.nonce}`;

    // Recover the address from the signature
    try {
      const recoveredAddress = ethers.utils.verifyMessage(message, signature);

      if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Generate new nonce for security
      await user.generateNonce();

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user._id,
          address: user.address,
        },
        config.jwt.secret,
        {
          expiresIn: config.jwt.expiresIn,
        }
      );

      // Helper function to convert wei to USDC dollars
      const weiToUSDC = (weiValue) => {
        if (!weiValue) return 0;
        const weiStr = String(weiValue);
        return parseFloat(ethers.utils.formatUnits(weiStr, 18));
      };

      // Fetch withdrawable balance from smart contract (source of truth)
      // This ensures the balance shown matches the withdraw page
      let currentBalance = 0;
      let lockedBalance = 0;
      try {
        const [withdrawableBalanceWei, lockedBalanceWei] = await Promise.all([
          blockchainService.getUserBalances(user.address),
          blockchainService.getUserLockedBalance(user.address),
        ]);
        currentBalance = weiToUSDC(withdrawableBalanceWei);
        lockedBalance = weiToUSDC(lockedBalanceWei);
      } catch (error) {
        console.error("Error fetching on-chain balances:", error);
        // Return 0 if blockchain call fails - no DB fallback
        currentBalance = 0;
        lockedBalance = 0;
      }

      res.json({
        token,
        user: {
          id: user._id,
          address: user.address,
          username: user.username,
          profileImage: user.profileImage,
          totalGamesPlayed: user.totalGamesPlayed,
          totalPortfoliosCreated: user.totalPortfoliosCreated,
          gamesWon: user.gamesWon,
          uniqueGamesWon: user.uniqueGamesWon,
          totalEarnings: weiToUSDC(user.totalEarnings),
          currentBalance: currentBalance, // From blockchain (source of truth)
          lockedBalance: lockedBalance, // From blockchain (source of truth)
        },
      });
    } catch (error) {
      console.error("Signature verification error:", error);
      return res.status(401).json({ error: "Invalid signature" });
    }
  }),

  // Update user profile
  updateProfile: asyncHandler(async (req, res) => {
    const { username } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Validate username if provided
    if (username) {
      if (username.length < 3 || username.length > 50) {
        return res.status(400).json({ error: "Username must be between 3 and 50 characters" });
      }

      // Check if username is already taken
      const existingUser = await User.findOne({
        username: username.toLowerCase(),
        _id: { $ne: userId },
      });
      if (existingUser) {
        return res.status(400).json({ error: "Username is already taken" });
      }

      user.username = username;
    }

    // Handle profile image upload
    if (req.file) {
      try {
        const awsService = require("../services/aws.service");
        // Delete old profile image if exists
        if (user.profileImage) {
          try {
            await awsService.deleteFile(user.profileImage);
          } catch (error) {
            console.error("Error deleting old profile image:", error);
          }
        }

        // Upload new profile image
        const imageUrl = await awsService.uploadFile(req.file, "profiles");
        user.profileImage = imageUrl;
      } catch (error) {
        console.error("Error uploading profile image:", error);
        return res.status(500).json({ error: "Failed to upload profile image" });
      }
    }

    await user.save();

    // Helper function to convert wei to USDC dollars
    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    res.json({
      user: {
        id: user._id,
        address: user.address,
        username: user.username,
        profileImage: user.profileImage,
        totalGamesPlayed: user.totalGamesPlayed,
        totalPortfoliosCreated: user.totalPortfoliosCreated,
        gamesWon: user.gamesWon,
        uniqueGamesWon: user.uniqueGamesWon,
        totalEarnings: weiToUSDC(user.totalEarnings),
      },
    });
  }),

  // Get user profile
  getProfile: asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Helper function to convert wei to USDC dollars
    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    // Fetch balances from smart contract (source of truth)
    // This ensures consistency with the withdraw page
    let currentBalance = 0;
    let lockedBalance = 0;
    try {
      const [withdrawableBalanceWei, lockedBalanceWei] = await Promise.all([
        blockchainService.getUserBalances(user.address),
        blockchainService.getUserLockedBalance(user.address),
      ]);
      currentBalance = weiToUSDC(withdrawableBalanceWei);
      lockedBalance = weiToUSDC(lockedBalanceWei);
    } catch (error) {
      console.error("Error fetching on-chain balances:", error);
      // Return 0 if blockchain call fails - no DB fallback
      currentBalance = 0;
      lockedBalance = 0;
    }

    res.json({
      user: {
        id: user._id,
        address: user.address,
        username: user.username,
        profileImage: user.profileImage,
        totalGamesPlayed: user.totalGamesPlayed,
        totalPortfoliosCreated: user.totalPortfoliosCreated,
        gamesWon: user.gamesWon,
        uniqueGamesWon: user.uniqueGamesWon,
        totalEarnings: weiToUSDC(user.totalEarnings), // Convert to dollars
        currentBalance: currentBalance, // From blockchain (source of truth)
        lockedBalance: lockedBalance, // From blockchain (source of truth)
      },
    });
  }),

  // Get user's transaction history
  getTransactionHistory: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 50, type } = req.query;

    const transactions = await transactionService.getUserTransactions(userId, {
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
      type,
    });

    res.json(transactions);
  }),

  // Check username availability
  checkUsername: asyncHandler(async (req, res) => {
    const { username } = req.query;

    const existingUser = await User.findOne({
      username: username.toLowerCase(),
    });

    res.json({
      available: !existingUser,
      username,
    });
  }),
};

module.exports = authController;
