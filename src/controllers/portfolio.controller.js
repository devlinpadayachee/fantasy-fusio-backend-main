const { asyncHandler } = require("../middleware/error");
const Portfolio = require("../models/Portfolio");
const Game = require("../models/Game");
const User = require("../models/User");
const Asset = require("../models/Asset");
const Notification = require("../models/Notification");
const GamePopupTracker = require("../models/GamePopupTracker");
const Transaction = require("../models/Transaction");
const priceService = require("../services/price.service");
const blockchainService = require("../services/blockchain.service");
const config = require("../config");
const { ethers } = require("ethers");

const portfolioController = {
  getPendingPortfoliosCount: asyncHandler(async (req, res) => {
    const pendingCount = await Portfolio.countDocuments({
      userId: req.user._id,
      status: "PENDING",
    });

    // Get user's locked balance from blockchain
    const lockedBalanceStr = await blockchainService.getUserLockedBalance(
      req.user.address
    );
    const lockedBalance = ethers.BigNumber.from(lockedBalanceStr);
    const allowedPortfoliosCount = lockedBalance
      .div(ethers.utils.parseUnits("4.5", 18))
      .toNumber();

    res.json({
      pendingCount,
      allowedCount: allowedPortfoliosCount,
      remainingCount: Math.max(0, allowedPortfoliosCount - pendingCount),
    });
  }),

  getDashboard: asyncHandler(async (req, res) => {
    const { gameId } = req.query;
    const userId = req.user._id;

    if (!gameId || isNaN(Number(gameId))) {
      return res
        .status(400)
        .json({ error: "Invalid or missing gameId parameter" });
    }

    const game = await Game.findOne({ gameId: Number(gameId) });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    const allPortfolios = await Portfolio.find({
      gameId: Number(gameId),
      status: {
        $in: [
          "PENDING",
          "LOCKING",
          "AWAITING DECISION",
          "LOCKED",
          "COMPLETED",
          "WON",
          "LOST",
        ],
      },
    })
      .populate("userId", "username profileImage")
      .sort({ performancePercentage: -1 });

    let userPortfolios = [];
    if (userId) {
      userPortfolios = await Portfolio.find({
        gameId: Number(gameId),
        userId: userId,
        status: {
          $nin: [
            "PENDING_LOCK_BALANCE",
            "FAILED",
          ],
        },
      }).sort({ performancePercentage: -1 });
    }

    const enrichedPortfolios = await Promise.all(
      userPortfolios.map(async (portfolio) => {
        const enrichedAssets = await Promise.all(
          portfolio.assets.map(async (asset) => {
            const assetData = await Asset.findOne(
              { assetId: asset.assetId },
              "imageUrl"
            );
            return {
              ...asset.toJSON(),
              imageUrl: assetData ? assetData.imageUrl : "",
            };
          })
        );
        return {
          ...portfolio.toJSON(),
          assets: enrichedAssets,
        };
      })
    );

    // Helper function to convert wei to USDC dollars
    const weiToUSDC = (weiValue) => {
      if (!weiValue) return 0;
      const weiStr = String(weiValue);
      return parseFloat(ethers.utils.formatUnits(weiStr, 18));
    };

    // Convert wei values in game object
    const gameObj = game.toObject();
    gameObj.totalPrizePool = weiToUSDC(gameObj.totalPrizePool);

    // Convert wei values in all portfolios
    const convertedAllPortfolios = allPortfolios.map(p => {
      const portfolioObj = p.toObject ? p.toObject() : p;
      return {
        ...portfolioObj,
        gameOutcome: portfolioObj.gameOutcome ? {
          ...portfolioObj.gameOutcome,
          reward: weiToUSDC(portfolioObj.gameOutcome.reward),
        } : undefined,
      };
    });

    // Convert wei values in user portfolios
    const convertedUserPortfolios = enrichedPortfolios.map(p => ({
      ...p,
      gameOutcome: p.gameOutcome ? {
        ...p.gameOutcome,
        reward: weiToUSDC(p.gameOutcome.reward),
      } : undefined,
    }));

    res.json({
      game: gameObj,
      portfolios: convertedAllPortfolios,
      userPortfolios: userId ? convertedUserPortfolios : [],
    });
  }),

  submitPortfolio: asyncHandler(async (req, res) => {
    const { transactionHash } = req.body;
    if (!transactionHash) {
      return res.status(400).json({
        error: "Transaction hash is required",
      });
    }

    const { assets, gameType, portfolioName } = req.body;

    const formattedAssets = assets.map((asset) => asset.symbol);
    if (
      !formattedAssets ||
      !Array.isArray(formattedAssets) ||
      formattedAssets.length !== 8
    ) {
      return res.status(400).json({ error: "Must provide exactly 8 assets" });
    }

    if (!gameType || !["DEFI", "TRADFI"].includes(gameType)) {
      return res
        .status(400)
        .json({ error: "Invalid game type. Must be either DEFI or TRADFI" });
    }

    // Check for unique assets
    const uniqueAssets = new Set(formattedAssets);
    if (uniqueAssets.size !== formattedAssets.length) {
      return res.status(400).json({ error: "All assets must be unique" });
    }

    // Verify assets in database
    const dbAssets = await Asset.find({
      symbol: { $in: formattedAssets },
      type: gameType,
      isActive: true,
    });

    if (dbAssets.length !== formattedAssets.length) {
      const foundSymbols = dbAssets.map((a) => a.symbol);
      const missingAssets = formattedAssets.filter(
        (a) => !foundSymbols.includes(a)
      );
      return res.status(400).json({
        error: `Some assets were not found or are inactive: ${missingAssets.join(
          ", "
        )}`,
      });
    }

    // Predefined allocation values
    const allocations = [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000];

    // Map assets to allocations
    const portfolioAssets = formattedAssets.map((symbol, index) => {
      const dbAsset = dbAssets.find((a) => a.symbol === symbol);
      return {
        assetId: dbAsset.assetId,
        symbol: symbol,
        allocation: allocations[index],
        tokenQty: 0, // Initial token quantities will be calculated by smart contract
      };
    });

    // Validate user wallet
    if (!req.user.address) {
      return res.status(400).json({
        error:
          "User wallet address not found. Please connect your wallet first.",
      });
    }

    try {
      // Check if transaction hash is already used
      const existingPortfolio = await Portfolio.findOne({ transactionHash });
      if (existingPortfolio) {
        return res.status(400).json({
          error: "Transaction hash already used",
        });
      }

      // Get transaction receipt from blockchain
      const receipt = await blockchainService.provider.getTransactionReceipt(
        transactionHash
      );
      if (!receipt) {
        return res.status(400).json({
          error: "Transaction not found on blockchain",
        });
      }

      // Create transaction record
      await Transaction.create({
        transactionHash: transactionHash,
        userId: req.user._id,
        type: "ENTRY_FEE",
        amount: ethers.utils.parseUnits("4.5", 18).toString(),
        status: "COMPLETED",
        blockNumber: receipt.blockNumber,
        blockTimestamp: new Date(),
        fromAddress: req.user.address,
        toAddress: config.blockchain.contractAddress,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.effectiveGasPrice.toString(),
        networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
      });

      // Get user's locked balance from blockchain
      const lockedBalanceStr = await blockchainService.getUserLockedBalance(
        req.user.address
      );
      const lockedBalance = ethers.BigNumber.from(lockedBalanceStr);
      const allowedPortfoliosCount = lockedBalance
        .div(ethers.utils.parseUnits("4.5", 18))
        .toNumber();

      // Get count of user's pending portfolios
      const pendingPortfoliosCount = await Portfolio.countDocuments({
        userId: req.user._id,
        status: "PENDING",
        gameType,
      });

      if (allowedPortfoliosCount <= pendingPortfoliosCount) {
        return res.status(400).json({
          error: "Portfolio limit reached based on your locked balance",
        });
      }

      // Create notification for balance lock
      await new Notification({
        userId: req.user._id,
        type: "BALANCE_LOCKED",
        message: "Balance locked successfully for portfolio creation",
      }).save();

      // Get next portfolioId dynamically
      const maxPortfolio = await Portfolio.findOne()
        .sort({ portfolioId: -1 })
        .select("portfolioId");
      const nextPortfolioId = maxPortfolio ? maxPortfolio.portfolioId + 1 : 1;

      // Create portfolio in database
      const portfolio = new Portfolio({
        userId: req.user._id,
        portfolioName: portfolioName,
        gameId: 0,
        gameType: gameType,
        portfolioId: nextPortfolioId,
        assets: portfolioAssets,
        status: "PENDING",
        isLocked: false,
        lockedAt: null,
        transactionHash: transactionHash,
      });

      await portfolio.save();

      // Create notification for portfolio creation
      await new Notification({
        userId: req.user._id,
        type: "PORTFOLIO_CREATED",
        message: `Portfolio ${portfolioName} created successfully`,
      }).save();

      res.json({
        message: "Portfolio submitted successfully",
        portfolio: portfolio.toJSON(),
        transaction: transactionHash,
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to submit portfolio",
        details: error.message,
      });
    }
  }),

  // Get user's portfolios with optional game type filter
  getUserPortfolios: asyncHandler(async (req, res) => {
    const { gameType, status, sort = "createdAt" } = req.query;

    // Get portfolios with optional filters
    const portfolios = await Portfolio.getUserPortfolios(
      req.user._id,
      gameType
    ).populate({
      path: "gameId",
      select: "status startTime endTime totalPrizePool participantCount",
    });

    // Filter by status if provided
    let filteredPortfolios = portfolios;
    if (status) {
      filteredPortfolios = portfolios.filter((p) => p.status === status);
    }

    // Get blockchain portfolio data
    const blockchainPortfolios = await Promise.all(
      filteredPortfolios.map(async (portfolio) => {
        try {
          const blockchainData = await blockchainService.getPortfolio(
            req.user.walletAddress,
            portfolio.smartContractId
          );

          // Get portfolio rank if active
          let rank = null;
          if (portfolio.status === "ACTIVE") {
            rank = await Portfolio.getPortfolioRank(
              portfolio._id,
              portfolio.gameType
            );
          }

          return {
            ...portfolio.toJSON(),
            rank,
            blockchain: blockchainData,
          };
        } catch (error) {
          console.error(
            `Failed to fetch blockchain data for portfolio ${portfolio._id}:`,
            error
          );
          return portfolio.toJSON();
        }
      })
    );

    // Get current prices for active portfolios
    const activePortfolios = blockchainPortfolios.filter(
      (p) => p.status === "ACTIVE"
    );
    if (activePortfolios.length > 0) {
      const prices = await priceService.getAllPrices();

      await Promise.all(
        activePortfolios.map(async (portfolio) => {
          await Portfolio.findById(portfolio._id).then((p) =>
            p.calculateValue(prices)
          );
        })
      );
    }

    // Sort portfolios
    const sortedPortfolios = blockchainPortfolios.sort((a, b) => {
      switch (sort) {
        case "performance":
          return b.performancePercentage - a.performancePercentage;
        case "value":
          return b.currentValue - a.currentValue;
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    res.json({
      portfolios: sortedPortfolios,
      total: sortedPortfolios.length,
      activeCount: activePortfolios.length,
    });
  }),

  // Get specific portfolio details with enhanced game information
  getPortfolioDetails: asyncHandler(async (req, res) => {
    const portfolio = await Portfolio.findOne({
      _id: req.params.portfolioId,
      userId: req.user._id,
    });

    if (!portfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    // Enrich portfolio assets with current prices and images
    const enrichedAssets = await Promise.all(
      portfolio.assets.map(async (asset) => {
        const assetData = await Asset.findOne(
          { assetId: asset.assetId },
          "currentPrice imageUrl"
        );
        return {
          ...asset.toJSON(),
          currentPrice: assetData ? assetData.currentPrice : 0,
          imageUrl: assetData ? assetData.imageUrl : "",
        };
      })
    );

    const enrichedPortfolio = {
      ...portfolio.toJSON(),
      assets: enrichedAssets,
    };

    res.json({
      portfolio: enrichedPortfolio,
    });
  }),

  // Get portfolio performance history
  getPortfolioHistory: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const { days = 7 } = req.query;

    const portfolio = await Portfolio.findOne({
      _id: portfolioId,
      userId: req.user._id,
    });

    if (!portfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    const historicalData = await Promise.all(
      portfolio.assets.map(async (asset) => {
        const prices = await priceService.getHistoricalPrices(
          asset.symbol,
          asset.type,
          parseInt(days)
        );

        return {
          symbol: asset.symbol,
          allocation: asset.allocation,
          type: asset.type,
          prices,
        };
      })
    );

    res.json(historicalData);
  }),

  // Get portfolio comparison with Ape
  getPortfolioComparison: asyncHandler(async (req, res) => {
    const { portfolioId } = req.body;
    // Get user portfolio
    const userPortfolio = await Portfolio.findOne({
      portfolioId: portfolioId,
    });

    if (!userPortfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    // Get game details
    const game = await Game.findOne({
      gameId: userPortfolio.gameId,
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    if (game.winCondition.type !== "MARLOW_BANES") {
      const user = await User.findById(
        userPortfolio.userId,
        "username profileImage"
      );

      const enrichPortfolioAssets = async (portfolio) => {
        const enrichedAssets = await Promise.all(
          portfolio.assets.map(async (asset) => {
            const assetData = await Asset.findOne(
              { assetId: asset.assetId },
              "currentPrice imageUrl"
            );
            return {
              ...asset.toJSON(),
              currentPrice: assetData ? assetData.currentPrice : 0,
              imageUrl: assetData ? assetData.imageUrl : "",
            };
          })
        );
        return {
          ...portfolio.toJSON(),
          assets: enrichedAssets,
        };
      };

      const enrichedUserPortfolio = await enrichPortfolioAssets(userPortfolio);
      enrichedUserPortfolio.user = user;

      return res.json({
        userPortfolio: enrichedUserPortfolio,
        user: user,
        apePortfolio: {},
        game: game,
      });
    }

    // Get ape portfolio
    const apePortfolio = await Portfolio.findOne({
      portfolioId: game.apePortfolio.portfolioId,
    });

    if (!apePortfolio) {
      return res.status(404).json({ error: "Ape portfolio not found" });
    }

    // Get user profile
    const user = await User.findById(
      userPortfolio.userId,
      "username profileImage"
    );

    // Function to enrich portfolio assets with current prices and images
    const enrichPortfolioAssets = async (portfolio) => {
      const enrichedAssets = await Promise.all(
        portfolio.assets.map(async (asset) => {
          const assetData = await Asset.findOne(
            { assetId: asset.assetId },
            "currentPrice imageUrl"
          );
          return {
            ...asset.toJSON(),
            currentPrice: assetData ? assetData.currentPrice : 0,
            imageUrl: assetData ? assetData.imageUrl : "",
          };
        })
      );
      return {
        ...portfolio.toJSON(),
        assets: enrichedAssets,
      };
    };

    // Enrich both portfolios
    const [enrichedUserPortfolio, enrichedApePortfolio] = await Promise.all([
      enrichPortfolioAssets(userPortfolio),
      enrichPortfolioAssets(apePortfolio),
    ]);

    // Add user details to the response
    enrichedUserPortfolio.user = user;

    res.json({
      userPortfolio: enrichedUserPortfolio,
      user: user,
      apePortfolio: enrichedApePortfolio,
      game: game,
    });
  }),

  checkTransactionStatus: asyncHandler(async (req, res) => {
    let { portfolioId } = req.params;
    portfolioId = Number(portfolioId);

    if (isNaN(portfolioId)) {
      return res.status(400).json({
        error: "Invalid portfolioId parameter. Must be a number.",
      });
    }

    // Find the portfolio
    const portfolio = await Portfolio.findOne({
      portfolioId: portfolioId,
      userId: req.user._id,
      status: "PENDING_LOCK_BALANCE",
    }).populate("userId");

    if (!portfolio) {
      return res.status(404).json({
        error: "Portfolio not found.",
      });
    }

    if (!portfolio.transactionHash) {
      return res.status(400).json({
        error: "No transaction hash found for this portfolio",
      });
    }

    try {
      const receipt = await blockchainService.provider.getTransactionReceipt(
        portfolio.transactionHash
      );
      console.log(
        `Checking transaction status for ${portfolio.transactionHash}`,
        receipt
      );
      if (!receipt) {
        return res.json({
          status: "PENDING",
          message: "Transaction not yet mined",
        });
      }
      // Decode logs into events
      const decodedEvents = receipt.logs
        .map((log) => {
          try {
            return blockchainService.contract.interface.parseLog(log);
          } catch (err) {
            return null;
          }
        })
        .filter((event) => event !== null);

      const portfolioCreatedEvent = decodedEvents.find(
        (e) => e.name === "PortfolioCreated"
      );
      const portfolioEntryFeePaidEvent = decodedEvents.find(
        (e) => e.name === "PortfolioEntryFeePaid"
      );

      if (!portfolioCreatedEvent) {
        return res.status(400).json({
          error: "PortfolioCreated event not found in transaction",
        });
      }

      if (receipt.status) {
        // Validate event data matches portfolio data
        if (
          portfolioCreatedEvent.args.portfolioId.toNumber() !==
            portfolio.portfolioId ||
          portfolioCreatedEvent.args.gameId.toNumber() !== portfolio.gameId ||
          portfolio.userId.address.toLowerCase() !==
            portfolioCreatedEvent.args.owner.toLowerCase()
        ) {
          return res.status(400).json({
            error: "PortfolioCreated event data does not match portfolio",
          });
        }

        await Transaction.create({
          transactionHash: portfolio.transactionHash,
          userId: portfolio.userId,
          type: "ENTRY_FEE",
          amount: portfolioEntryFeePaidEvent
            ? portfolioEntryFeePaidEvent.args.entryFee.toString()
            : "0",
          adminFee: portfolioEntryFeePaidEvent
            ? portfolioEntryFeePaidEvent.args.adminFee.toString()
            : "0",
          gameId: portfolioCreatedEvent.args.gameId.toNumber(),
          portfolioId: portfolioEntryFeePaidEvent
            ? portfolioEntryFeePaidEvent.args.portfolioId.toNumber()
            : portfolio.portfolioId,
          status: "COMPLETED",
          blockNumber: receipt.blockNumber,
          blockTimestamp: new Date(),
          fromAddress: portfolioEntryFeePaidEvent
            ? portfolioEntryFeePaidEvent.args.payer
            : null,
          toAddress: config.blockchain.contractAddress,
          gasUsed: receipt.gasUsed.toString(),
          gasPrice: receipt.effectiveGasPrice.toString(),
          networkFee: receipt.gasUsed.mul(receipt.effectiveGasPrice).toString(),
        });

        // New code to update game participantCount and totalPrizePool
        const gameId = portfolioCreatedEvent.args.gameId.toNumber();
        const gameEntryCount = portfolioCreatedEvent.args.entryCount
          ? parseInt(portfolioCreatedEvent.args.entryCount.toString())
          : 0;

        console.log(
          "portfolioCreatedEvent.args:",
          portfolioCreatedEvent.args.entryCount
        );

        const prizePool = portfolioCreatedEvent.args.prizePool
          ? parseInt(portfolioCreatedEvent.args.prizePool.toString())
          : 0;

        const game = await Game.findOne({ gameId: gameId });
        if (game) {
          game.participantCount = Math.max(
            game.participantCount || 0,
            gameEntryCount
          );
          game.totalPrizePool = Math.max(game.totalPrizePool || 0, prizePool);
          await game.save();
        }

        portfolio.status = "PENDING";
        await portfolio.save();

        await new Notification({
          userId: portfolio.userId,
          type: "PORTFOLIO_CREATED",
          message: `Portfolio ${portfolio.portfolioName} created successfully`,
        }).save();
        return res.json({
          status: "SUCCESS",
          message: `Portfolio ${portfolio.portfolioName} created successfully`,
          portfolio: portfolio.toJSON(),
        });
      } else {
        portfolio.status = "FAILED";
        portfolio.error = "Transaction failed on blockchain";
        await portfolio.save();

        await new Notification({
          userId: portfolio.userId,
          type: "TRANSACTION_FAILED",
          message: `Transaction failed for portfolio ${portfolio.portfolioName}`,
        }).save();
        return res.json({
          status: "FAILED",
          message: "Transaction failed",
          portfolio: portfolio.toJSON(),
        });
      }
    } catch (error) {
      return res.status(500).json({
        error: "Failed to check transaction status",
        details: error.message,
      });
    }
  }),

  storeTransactionHash: asyncHandler(async (req, res) => {
    const { portfolioId } = req.params;
    const { transactionHash } = req.body;

    if (!transactionHash) {
      return res.status(400).json({
        error: "Transaction hash is required",
      });
    }

      const portfolio = await Portfolio.findOne({
        portfolioId: portfolioId,
        userId: req.user._id,
        status: { $in: ["PENDING_LOCK_BALANCE", "Failed"] },
      });

    if (!portfolio) {
      return res.status(404).json({
        error: "Pending portfolio not found",
      });
    }

    const existingPortfolio = await Portfolio.findOne({ transactionHash });
    if (existingPortfolio) {
      return res.status(400).json({
        error: "Transaction hash already used",
      });
    }

    try {
      portfolio.transactionHash = transactionHash;
      await portfolio.save();
      res.json({
        message: "Transaction hash stored successfully",
        portfolio: portfolio.toJSON(),
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to store transaction hash",
        details: error.message,
      });
    }
  }),

  submitPendingPortfolio: asyncHandler(async (req, res) => {
    const { gameId, assets, gameType, portfolioName } = req.body;

    const game = await Game.findOne({
      gameId: Number(gameId),
      gameType: gameType,
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    if (game.participantCount >= game.entryCap) {
      return res.status(400).json({
        error: "Oops! This game is already full. Please join the next one!",
      });
    }

    if (game.status !== "UPCOMING") {
      return res.status(400).json({ error: "Game not found" });
    }

    const nowPlusOneMinute = new Date(Date.now() + 120 * 1000);
    if (!(game.startTime > nowPlusOneMinute)) {
      return res.status(400).json({ error: "Game already started." });
    }

    const formattedAssets = assets.map((asset) => asset.symbol);
    if (
      !formattedAssets ||
      !Array.isArray(formattedAssets) ||
      formattedAssets.length !== 8
    ) {
      return res.status(400).json({ error: "Must provide exactly 8 assets" });
    }

    if (!gameType || !["DEFI", "TRADFI"].includes(gameType)) {
      return res
        .status(400)
        .json({ error: "Invalid game type. Must be either DEFI or TRADFI" });
    }

    // Check for unique assets
    const uniqueAssets = new Set(formattedAssets);
    if (uniqueAssets.size !== formattedAssets.length) {
      return res.status(400).json({ error: "All assets must be unique" });
    }

    // Verify assets in database
    const dbAssets = await Asset.find({
      symbol: { $in: formattedAssets },
      type: gameType,
      isActive: true,
    });

    if (dbAssets.length !== formattedAssets.length) {
      const foundSymbols = dbAssets.map((a) => a.symbol);
      const missingAssets = formattedAssets.filter(
        (a) => !foundSymbols.includes(a)
      );
      return res.status(400).json({
        error: `Some assets were not found or are inactive: ${missingAssets.join(
          ", "
        )}`,
      });
    }

    // Predefined allocation values
    const allocations = [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000];

    // Map assets to allocations
    const portfolioAssets = formattedAssets.map((symbol, index) => {
      const dbAsset = dbAssets.find((a) => a.symbol === symbol);
      return {
        assetId: dbAsset.assetId,
        symbol: symbol,
        allocation: allocations[index],
        tokenQty: 0,
      };
    });

    try {
      // Get next portfolioId dynamically
      const maxPortfolio = await Portfolio.findOne()
        .sort({ portfolioId: -1 })
        .select("portfolioId");
      const nextPortfolioId = maxPortfolio ? maxPortfolio.portfolioId + 1 : 1;

      // Create portfolio in database
      const portfolio = new Portfolio({
        userId: req.user._id,
        portfolioName: portfolioName,
        gameId: gameId,
        gameType: gameType,
        portfolioId: nextPortfolioId,
        assets: portfolioAssets,
        status: "PENDING_LOCK_BALANCE",
        isLocked: false,
        lockedAt: null,
      });
      await portfolio.save();

      res.json({
        message: "Portfolio submitted successfully",
        portfolio: portfolio.toJSON(),
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to submit portfolio",
        details: error.message,
      });
    }
  }),

  editPortfolio: asyncHandler(async (req, res) => {
    const { portfolioId, portfolioName, assets } = req.body;

    const portfolio = await Portfolio.findOne({
      portfolioId: Number(portfolioId),
      userId: req.user._id,
    });

    if (!portfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    // Check if portfolio is locked
    if (portfolio.isLocked) {
      return res.status(400).json({ error: "Cannot edit a locked portfolio" });
    }

    // Update portfolio name if provided
    if (portfolioName) {
      portfolio.portfolioName = portfolioName;
    }

    // Update assets if provided
    if (assets) {
      const formattedAssets = assets.map((asset) => asset.symbol);

      // Validate assets array length
      if (formattedAssets.length !== 8) {
        return res.status(400).json({ error: "Must provide exactly 8 assets" });
      }

      // Check for unique assets
      const uniqueAssets = new Set(formattedAssets);
      if (uniqueAssets.size !== formattedAssets.length) {
        return res.status(400).json({ error: "All assets must be unique" });
      }

      // Verify assets in database
      const dbAssets = await Asset.find({
        symbol: { $in: formattedAssets },
        type: portfolio.gameType,
        isActive: true,
      });

      if (dbAssets.length !== formattedAssets.length) {
        const foundSymbols = dbAssets.map((a) => a.symbol);
        const missingAssets = formattedAssets.filter(
          (a) => !foundSymbols.includes(a)
        );
        return res.status(400).json({
          error: `Some assets were not found or are inactive: ${missingAssets.join(
            ", "
          )}`,
        });
      }

      // Predefined allocation values
      const allocations = [
        20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000,
      ];

      // Map assets to allocations
      portfolio.assets = formattedAssets.map((symbol, index) => {
        const dbAsset = dbAssets.find((a) => a.symbol === symbol);
        return {
          assetId: dbAsset.assetId,
          symbol: symbol,
          allocation: allocations[index],
          tokenQty: 0, // Reset token quantities as they will be recalculated
        };
      });
    }

    // Save the updated portfolio
    await portfolio.save();

    // Enrich assets with imageUrl and currentPrice
    const enrichedAssets = await Promise.all(
      portfolio.assets.map(async (asset) => {
        const assetData = await Asset.findOne(
          { assetId: asset.assetId },
          "currentPrice imageUrl"
        );
        return {
          ...asset.toJSON(),
          currentPrice: assetData ? assetData.currentPrice : 0,
          imageUrl: assetData ? assetData.imageUrl : "",
        };
      })
    );

    // Add imageUrl to portfolio.assets without replacing the whole array
    const portfolioObj = portfolio.toObject();
    portfolioObj.assets = portfolioObj.assets.map((asset, index) => ({
      ...asset,
      imageUrl: enrichedAssets[index].imageUrl,
      currentPrice: enrichedAssets[index].currentPrice,
    }));

    res.json({
      message: "Portfolio updated successfully",
      portfolio: portfolioObj,
    });
  }),

  // Get portfolios by game type
  getPortfoliosByGameType: asyncHandler(async (req, res) => {
    const { gameType } = req.params;
    const { status } = req.query;

    console.log(`Fetching portfolios for game type: ${gameType}`);

    const portfolios = await Portfolio.find({
      $or: [{ userId: req.user._id }],
      status: { $ne: "PENDING_LOCK_BALANCE" },
    })
      .populate("userId", "username profileImage")
      .sort({ createdAt: -1 });

    // Update values and add asset prices
    const enrichedPortfolios = await Promise.all(
      portfolios.map(async (portfolio) => {
        // Get current prices for each asset
        const enrichedAssets = await Promise.all(
          portfolio.assets.map(async (asset) => {
            const assetData = await Asset.findOne(
              { assetId: asset.assetId },
              "currentPrice imageUrl"
            );
            return {
              ...asset.toJSON(),
              currentPrice: assetData ? assetData.currentPrice : 0,
              imageUrl: assetData ? assetData.imageUrl : "",
            };
          })
        );
        return {
          ...portfolio.toJSON(),
          assets: enrichedAssets,
        };
      })
    );

    // Get game type statistics
    const gameTypeStats = await Portfolio.aggregate([
      {
        $match: {
          gameType,
          status: "ACTIVE",
        },
      },
      {
        $group: {
          _id: null,
          avgPerformance: { $avg: "$performancePercentage" },
          maxPerformance: { $max: "$performancePercentage" },
          minPerformance: { $min: "$performancePercentage" },
          totalPortfolios: { $sum: 1 },
        },
      },
    ]);

    // Get current game information
    const currentGame = await Game.getCurrentGame(gameType);

    res.json({
      portfolios: enrichedPortfolios,
      stats: gameTypeStats[0] || null,
      currentGame: currentGame
        ? {
            startTime: currentGame.startTime,
            endTime: currentGame.endTime,
            totalPrizePool: currentGame.totalPrizePool,
            participantCount: currentGame.participantCount,
            apePortfolio: currentGame.apePortfolio,
          }
        : null,
      total: enrichedPortfolios.length,
      activeCount: enrichedPortfolios.filter((p) => p.status === "ACTIVE")
        .length,
    });
  }),
};

module.exports = portfolioController;
