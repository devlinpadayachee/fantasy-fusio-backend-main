const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const Asset = require('../models/Asset');
const Game = require('../models/Game');
const blockchainService = require('./blockchain.service');
const priceService = require('./price.service');

class PortfolioService {
    constructor() {
        this.INITIAL_PORTFOLIO_VALUE = 100000; // $100,000
        this.MAX_ASSETS = 8;
    }

    // Create a new portfolio
    async createPortfolio(userId, assets) {
        try {
            // Validate input
            if (!assets || assets.length !== this.MAX_ASSETS) {
                throw new Error(`Portfolio must contain exactly ${this.MAX_ASSETS} assets`);
            }

            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get current game
            const gameType = assets[0].type; // All assets should be of same type
            const game = await Game.getCurrentGame(gameType);
            if (!game || game.status !== 'PENDING') {
                throw new Error('No active game available for portfolio creation');
            }

            // Validate assets and calculate allocations
            const assetDetails = await this.validateAndProcessAssets(assets);

            // Check if user already has a portfolio for this game
            const existingPortfolio = await Portfolio.findOne({
                userId,
                gameId: game.gameId
            });
            if (existingPortfolio) {
                throw new Error('User already has a portfolio for this game');
            }

            // Create portfolio on blockchain
            const portfolioId = await blockchainService.createAndLockPortfolio(
                userId,
                user.address,
                assetDetails.symbols,
                assetDetails.allocations,
                assetDetails.tokenQtys,
                gameType
            );

            // Create portfolio in database
            const portfolio = await Portfolio.create({
                portfolioId,
                userId,
                gameId: game.gameId,
                assets: assetDetails.assets,
                initialValue: this.INITIAL_PORTFOLIO_VALUE,
                currentValue: this.INITIAL_PORTFOLIO_VALUE,
                status: 'PENDING'
            });

            return portfolio;
        } catch (error) {
            console.error('Error creating portfolio:', error);
            throw error;
        }
    }

    // Validate and process assets for portfolio creation
    async validateAndProcessAssets(assets) {
        try {
            // Verify all assets exist and are active
            const assetIds = assets.map(a => a.assetId);
            const dbAssets = await Asset.find({
                assetId: { $in: assetIds },
                isActive: true
            });

            if (dbAssets.length !== this.MAX_ASSETS) {
                throw new Error('One or more assets are invalid or inactive');
            }

            // Verify total allocation is 100%
            const totalAllocation = assets.reduce((sum, a) => sum + a.allocation, 0);
            if (Math.abs(totalAllocation - 100) > 0.01) {
                throw new Error('Total allocation must equal 100%');
            }

            // Get current prices
            const prices = await priceService.getCurrentPrices(dbAssets);

            // Calculate token quantities based on allocations and prices
            const processedAssets = assets.map(asset => {
                const dbAsset = dbAssets.find(a => a.assetId === asset.assetId);
                const price = prices[dbAsset.symbol].price;
                const tokenQty = (this.INITIAL_PORTFOLIO_VALUE * (asset.allocation / 100)) / price;

                return {
                    assetId: asset.assetId,
                    symbol: dbAsset.symbol,
                    tokenQty,
                    allocation: asset.allocation
                };
            });

            return {
                assets: processedAssets,
                symbols: processedAssets.map(a => a.symbol),
                allocations: processedAssets.map(a => a.allocation),
                tokenQtys: processedAssets.map(a => a.tokenQty)
            };
        } catch (error) {
            console.error('Error processing assets:', error);
            throw error;
        }
    }

    // Get current portfolio for user
    async getCurrentPortfolio(userId) {
        try {
            const portfolio = await Portfolio.findOne({
                userId,
                status: { $in: ['PENDING', 'ACTIVE'] }
            }).populate('userId');

            if (!portfolio) {
                return null;
            }

            // Get current asset prices and update portfolio value
            const assets = await Asset.find({
                assetId: { $in: portfolio.assets.map(a => a.assetId) }
            });
            const prices = await priceService.getCurrentPrices(assets);
            await portfolio.calculateValue(prices);

            return portfolio;
        } catch (error) {
            console.error('Error getting current portfolio:', error);
            throw error;
        }
    }

    // Get portfolio details
    async getPortfolioDetails(portfolioId) {
        try {
            const portfolio = await Portfolio.findOne({
                portfolioId
            }).populate('userId');

            if (!portfolio) {
                throw new Error('Portfolio not found');
            }

            // Get current asset prices and update portfolio value
            const assets = await Asset.find({
                assetId: { $in: portfolio.assets.map(a => a.assetId) }
            });
            const prices = await priceService.getCurrentPrices(assets);
            await portfolio.calculateValue(prices);

            // Get game details
            const game = await Game.findOne({ gameId: portfolio.gameId });

            return {
                portfolio,
                game,
                assets: await Promise.all(assets.map(async (asset) => ({
                    ...asset.toObject(),
                    price: prices[asset.symbol].price,
                    change24h: prices[asset.symbol].change24h
                })))
            };
        } catch (error) {
            console.error('Error getting portfolio details:', error);
            throw error;
        }
    }

    // Get portfolio history
    async getPortfolioHistory(portfolioId) {
        try {
            const portfolio = await Portfolio.findOne({ portfolioId });
            if (!portfolio) {
                throw new Error('Portfolio not found');
            }

            return {
                valueHistory: portfolio.valueHistory,
                initialValue: portfolio.initialValue,
                currentValue: portfolio.currentValue,
                performancePercentage: portfolio.performancePercentage
            };
        } catch (error) {
            console.error('Error getting portfolio history:', error);
            throw error;
        }
    }

    // Compare portfolio against Ape
    async getPortfolioComparison(portfolioId) {
        try {
            const portfolio = await Portfolio.findOne({ portfolioId });
            if (!portfolio) {
                throw new Error('Portfolio not found');
            }

            const game = await Game.findOne({ gameId: portfolio.gameId });
            if (!game) {
                throw new Error('Game not found');
            }

            // Get current values
            const assets = await Asset.find({
                assetId: { $in: portfolio.assets.map(a => a.assetId) }
            });
            const prices = await priceService.getCurrentPrices(assets);
            await portfolio.calculateValue(prices);

            return {
                portfolio: {
                    initialValue: portfolio.initialValue,
                    currentValue: portfolio.currentValue,
                    performancePercentage: portfolio.performancePercentage
                },
                ape: {
                    initialValue: game.apePortfolio.initialValue,
                    currentValue: game.apePortfolio.currentValue,
                    performancePercentage: game.apePortfolio.performancePercentage
                },
                difference: portfolio.performancePercentage - game.apePortfolio.performancePercentage
            };
        } catch (error) {
            console.error('Error getting portfolio comparison:', error);
            throw error;
        }
    }
}

module.exports = new PortfolioService();
