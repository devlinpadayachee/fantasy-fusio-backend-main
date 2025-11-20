const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Asset = require('../models/Asset');
const config = require('../config');

class AssetService {
    constructor() {
        this.cryptoCompareApiKey = config.apiKeys.cryptoCompare;
        this.alphaVantageApiKey = config.apiKeys.alphaVantage;
    }

    // Initialize assets from both sources
    async initializeAssets() {
        try {
            await Promise.all([
                this.initializeDefiAssets(),
                this.initializeTradfiAssets()
            ]);
            console.log('Assets initialized successfully');
        } catch (error) {
            console.error('Error initializing assets:', error);
            throw error;
        }
    }

    // Initialize DeFi assets from CryptoCompare
    async initializeDefiAssets() {
        try {
            const response = await axios.get(
                'https://min-api.cryptocompare.com/data/top/mktcapfull',
                {
                    params: {
                        limit: 25,
                        tsym: 'USD'
                    },
                    headers: {
                        'Authorization': `Apikey ${this.cryptoCompareApiKey}`
                    }
                }
            );

            const cryptoAssets = response.data.Data;
            let assetId = 1;

            for (const crypto of cryptoAssets) {
                const coinInfo = crypto.CoinInfo;
                await Asset.findOneAndUpdate(
                    { symbol: coinInfo.Name },
                    {
                        assetId: assetId++,
                        symbol: coinInfo.Name,
                        name: coinInfo.FullName,
                        type: 'DEFI',
                        isActive: true,
                        metadata: {
                            algorithm: coinInfo.Algorithm,
                            proofType: coinInfo.ProofType,
                            totalSupply: coinInfo.MaxSupply || 0
                        }
                    },
                    { upsert: true, new: true }
                );
            }

            console.log('DeFi assets initialized successfully');
        } catch (error) {
            console.error('Error initializing DeFi assets:', error);
            throw error;
        }
    }

    // Initialize TradFi assets from JSON file
    async initializeTradfiAssets() {
        try {
            const filePath = path.join(__dirname, '../data/tradfi-assets.json');
            const fileContent = await fs.readFile(filePath, 'utf8');
            const tradfiData = JSON.parse(fileContent);

            for (const asset of tradfiData.assets) {
                await Asset.findOneAndUpdate(
                    { symbol: asset.symbol },
                    {
                        assetId: asset.id,
                        symbol: asset.symbol,
                        name: asset.name,
                        type: 'TRADFI',
                        isActive: true,
                        metadata: {
                            sector: asset.sector,
                            exchange: asset.exchange
                        }
                    },
                    { upsert: true, new: true }
                );
            }

            console.log('TradFi assets initialized successfully');
        } catch (error) {
            console.error('Error initializing TradFi assets:', error);
            throw error;
        }
    }

    // Get all active assets
    async getAllAssets() {
        return Asset.find({ isActive: true }).sort('assetId');
    }

    // Get assets by type
    async getAssetsByType(type) {
        if (!['DEFI', 'TRADFI'].includes(type)) {
            throw new Error('Invalid asset type');
        }
        return Asset.find({ type, isActive: true }).sort('assetId');
    }

    // Get asset by ID
    async getAssetById(assetId) {
        return Asset.findOne({ assetId, isActive: true });
    }

    // Get assets by IDs
    async getAssetsByIds(assetIds) {
        return Asset.find({
            assetId: { $in: assetIds },
            isActive: true
        }).sort('assetId');
    }

    // Update asset status
    async updateAssetStatus(assetId, isActive) {
        return Asset.findOneAndUpdate(
            { assetId },
            { isActive },
            { new: true }
        );
    }

    // Validate asset selection for portfolio
    async validateAssetSelection(assetIds) {
        const assets = await this.getAssetsByIds(assetIds);
        
        if (assets.length !== assetIds.length) {
            throw new Error('One or more assets not found');
        }

        const defiCount = assets.filter(a => a.type === 'DEFI').length;
        const tradfiCount = assets.filter(a => a.type === 'TRADFI').length;

        // Add any specific validation rules here
        // For example, requiring a minimum number of each type
        
        return {
            valid: true,
            assets,
            counts: {
                defi: defiCount,
                tradfi: tradfiCount
            }
        };
    }
}

module.exports = new AssetService();
