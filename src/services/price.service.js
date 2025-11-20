const axios = require('axios');
const Asset = require('../models/Asset');
const config = require('../config');

class PriceService {
    constructor() {
        this.cryptoCompareApiKey = config.apiKeys.cryptoCompare;
        this.alphaVantageApiKey = config.apiKeys.alphaVantage;
        
        // Cache configuration
        this.cache = {
            prices: new Map(),
            lastUpdate: new Map()
        };
        this.CACHE_DURATION = 60 * 1000; 
        
        // Rate limiting
        this.rateLimits = {
            cryptoCompare: {
                lastCall: 0,
                minInterval: 100 
            },
            alphaVantage: {
                lastCall: 0,
                minInterval: 100
            }
        };
    }

    // Rate limiting helper
    async checkRateLimit(api) {
        const now = Date.now();
        const lastCall = this.rateLimits[api].lastCall;
        const minInterval = this.rateLimits[api].minInterval;
        
        if (now - lastCall < minInterval) {
            await new Promise(resolve => 
                setTimeout(resolve, minInterval - (now - lastCall))
            );
        }
        
        this.rateLimits[api].lastCall = Date.now();
    }

    // Cache helpers
    getCachedPrice(symbol) {
        const cached = this.cache.prices.get(symbol);
        const lastUpdate = this.cache.lastUpdate.get(symbol);
        
        if (cached && lastUpdate && Date.now() - lastUpdate < this.CACHE_DURATION) {
            return cached;
        }
        return null;
    }

    setCachedPrice(symbol, price) {
        this.cache.prices.set(symbol, price);
        this.cache.lastUpdate.set(symbol, Date.now());
    }

    // Update all asset prices
    async updateAllPrices() {
        try {
            await Promise.all([
                this.updateDefiPrices(),
                this.updateTradfiPrices()
            ]);
            console.log('All prices updated successfully');
        } catch (error) {
            console.error('Error updating prices:', error);
            throw error;
        }
    }

    // Update DeFi asset prices from CryptoCompare with retry mechanism
    async updateDefiPrices(retryCount = 3) {
        try {
            const defiAssets = await Asset.find({ type: 'DEFI', isActive: true });
            if (!defiAssets.length) return;

            const symbols = defiAssets.map(asset => asset.symbol).join(',');
            await this.checkRateLimit('cryptoCompare');

            // Check cache first
            // const cachedPrices = this.getCachedPrice(symbols);
            // if (cachedPrices) {
            //     return cachedPrices;
            // }

            const response = await axios.get(
                'https://min-api.cryptocompare.com/data/pricemultifull',
                {
                    params: {
                        fsyms: symbols,
                        tsyms: 'USD'
                    },
                    headers: {
                        'Authorization': `Apikey ${this.cryptoCompareApiKey}`
                    }
                }
            );

            if (!response.data.RAW) {
                throw new Error('Invalid response from CryptoCompare');
            }

            // this.setCachedPrice(symbols, response.data);
            const updates = [];

            for (const asset of defiAssets) {
                const data = response.data.RAW[asset.symbol]?.USD;
                if (data) {
                    updates.push(
                        Asset.findOneAndUpdate(
                            { _id: asset._id },
                            {
                                $set: {
                                    currentPrice: data.PRICE,
                                    change24h: data.CHANGEPCT24HOUR,
                                    lastUpdated: new Date()
                                },
                                $push: {
                                    priceHistory: {
                                        $each: [{
                                            price: data.PRICE,
                                            timestamp: new Date()
                                        }],
                                        $slice: -168 // Keep last 7 days (24 * 7 = 168 hourly records)
                                    }
                                }
                            },
                            { new: true }
                        )
                    );
                }
            }

            await Promise.all(updates);
            console.log('DeFi prices updated successfully');
        } catch (error) {
            console.error('Error updating DeFi prices:', error);
            if (retryCount > 0) {
                console.log(`Retrying DeFi price update. Attempts remaining: ${retryCount - 1}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.updateDefiPrices(retryCount - 1);
            }
            throw error;
        }
    }

    // Update TradFi asset prices from Alpha Vantage with retry mechanism
    async updateTradfiPrices(retryCount = 3) {
        try {
            const tradfiAssets = await Asset.find({ type: 'TRADFI', isActive: true });
            
            if (!tradfiAssets.length) return;

            const updates = [];
            const failedUpdates = [];
            const batchSize = 75;

            for (let i = 0; i < tradfiAssets.length; i += batchSize) {
                const batch = tradfiAssets.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (asset) => {
                    try {
                        await this.checkRateLimit('alphaVantage');

                        // Check cache first
                        // const cachedPrice = this.getCachedPrice(asset.symbol);
                        // console.log("cachedPrice",cachedPrice);
                        // if (cachedPrice) {
                        //     return cachedPrice;
                        // }

                        const response = await axios.get(
                          "https://www.alphavantage.co/query",
                          {
                            params: {
                              function: "GLOBAL_QUOTE",
                              entitlement: "delayed",
                              symbol: asset.symbol,
                              apikey: this.alphaVantageApiKey,
                            },
                          }
                        );

                        const quote =
                          response.data[
                            "Global Quote - DATA DELAYED BY 15 MINUTES"
                          ];
                        if (quote) {
                            // this.setCachedPrice(asset.symbol, response.data);
                            
                            const currentPrice = parseFloat(quote['05. price']);
                            updates.push(
                                Asset.findOneAndUpdate(
                                    { _id: asset._id },
                                    {
                                        $set: {
                                            currentPrice: currentPrice,
                                            change24h: parseFloat(quote['10. change percent'].replace('%', '')),
                                            lastUpdated: new Date()
                                        },
                                        $push: {
                                            priceHistory: {
                                                $each: [{
                                                    price: currentPrice,
                                                    timestamp: new Date()
                                                }],
                                                $slice: -168
                                            }
                                        }
                                    },
                                    { new: true }
                                )
                            );
                        }
                    } catch (error) {
                        console.error(`Error updating price for ${asset.symbol}:`, error);
                        failedUpdates.push(asset);
                    }
                }));

                // Wait between batches to respect rate limits
                if (i + batchSize < tradfiAssets.length) {
                    await new Promise(resolve => setTimeout(resolve, 12000));
                }
            }

            await Promise.all(updates);

            // Retry failed updates
            if (failedUpdates.length > 0 && retryCount > 0) {
                console.log(`Retrying ${failedUpdates.length} failed updates. Attempts remaining: ${retryCount - 1}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                await this.retryFailedUpdates(failedUpdates, retryCount - 1);
            }

            console.log('TradFi prices updated successfully');
        } catch (error) {
            console.error('Error updating TradFi prices:', error);
            throw error;
        }
    }

    // Retry mechanism for failed updates
    async retryFailedUpdates(assets, retryCount) {
        for (const asset of assets) {
            try {
                await this.checkRateLimit('alphaVantage');
                const response = await axios.get(
                    'https://www.alphavantage.co/query',
                    {
                        params: {
                            function: 'GLOBAL_QUOTE',
                            symbol: asset.symbol,
                            apikey: this.alphaVantageApiKey
                        }
                    }
                );

                const quote = response.data['Global Quote'];
                if (quote) {
                    this.setCachedPrice(asset.symbol, response.data);
                    
                    asset.currentPrice = parseFloat(quote['05. price']);
                    asset.change24h = parseFloat(quote['10. change percent'].replace('%', ''));
                    asset.lastUpdated = new Date();
                    
                    await asset.save();
                    console.log(`Successfully retried update for ${asset.symbol}`);
                }
            } catch (error) {
                console.error(`Retry failed for ${asset.symbol}:`, error);
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await this.retryFailedUpdates([asset], retryCount - 1);
                }
            }
        }
    }

    // Get historical prices for an asset with caching
    async getHistoricalPrices(symbol, type, days = 7) {
        try {
            const cacheKey = `${symbol}_historical_${days}`;
            const cachedData = this.getCachedPrice(cacheKey);
            if (cachedData) {
                return cachedData;
            }

            if (type === 'DEFI') {
                await this.checkRateLimit('cryptoCompare');
                const response = await axios.get(
                    'https://min-api.cryptocompare.com/data/v2/histoday',
                    {
                        params: {
                            fsym: symbol,
                            tsym: 'USD',
                            limit: days,
                            toTs: Math.floor(Date.now() / 1000)
                        },
                        headers: {
                            'Authorization': `Apikey ${this.cryptoCompareApiKey}`
                        }
                    }
                );

                const historicalData = response.data.Data.Data.map(item => ({
                    timestamp: item.time * 1000,
                    price: item.close
                }));

                this.setCachedPrice(cacheKey, historicalData);
                return historicalData;
            } else {
                await this.checkRateLimit('alphaVantage');
                const response = await axios.get(
                    'https://www.alphavantage.co/query',
                    {
                        params: {
                            function: 'TIME_SERIES_DAILY',
                            symbol: symbol,
                            apikey: this.alphaVantageApiKey
                        }
                    }
                );

                const timeSeries = response.data['Time Series (Daily)'];
                const historicalData = Object.entries(timeSeries)
                    .slice(0, days)
                    .map(([date, data]) => ({
                        timestamp: new Date(date).getTime(),
                        price: parseFloat(data['4. close'])
                    }));

                this.setCachedPrice(cacheKey, historicalData);
                return historicalData;
            }
        } catch (error) {
            console.error(`Error getting historical prices for ${symbol}:`, error);
            throw error;
        }
    }

    // Get current prices for multiple assets
    async getCurrentPrices(assets) {
        const defiAssets = assets.filter(a => a.type === 'DEFI');
        const tradfiAssets = assets.filter(a => a.type === 'TRADFI');
        const result = {};

        try {
            if (defiAssets.length > 0) {
                await this.checkRateLimit('cryptoCompare');
                const defiSymbols = defiAssets.map(a => a.symbol).join(',');
                const cachedPrices = this.getCachedPrice(defiSymbols);

                if (cachedPrices) {
                    Object.assign(result, cachedPrices);
                } else {
                    const response = await axios.get(
                        'https://min-api.cryptocompare.com/data/pricemultifull',
                        {
                            params: {
                                fsyms: defiSymbols,
                                tsyms: 'USD'
                            },
                            headers: {
                                'Authorization': `Apikey ${this.cryptoCompareApiKey}`
                            }
                        }
                    );

                    if (response.data.RAW) {
                        const prices = {};
                        for (const symbol in response.data.RAW) {
                            const data = response.data.RAW[symbol].USD;
                            prices[symbol] = {
                                price: data.PRICE,
                                change24h: data.CHANGEPCT24HOUR
                            };
                        }
                        this.setCachedPrice(defiSymbols, prices);
                        Object.assign(result, prices);
                    }
                }
            }

            if (tradfiAssets.length > 0) {
                const batchSize = 5;
                for (let i = 0; i < tradfiAssets.length; i += batchSize) {
                    const batch = tradfiAssets.slice(i, i + batchSize);
                    
                    await Promise.all(batch.map(async (asset) => {
                        try {
                            await this.checkRateLimit('alphaVantage');
                            const cachedPrice = this.getCachedPrice(asset.symbol);

                            if (cachedPrice) {
                                result[asset.symbol] = cachedPrice;
                                return;
                            }

                            const response = await axios.get(
                                'https://www.alphavantage.co/query',
                                {
                                    params: {
                                        function: 'GLOBAL_QUOTE',
                                        symbol: asset.symbol,
                                        apikey: this.alphaVantageApiKey
                                    }
                                }
                            );

                            const quote = response.data['Global Quote'];
                            if (quote) {
                                const price = {
                                    price: parseFloat(quote['05. price']),
                                    change24h: parseFloat(quote['10. change percent'].replace('%', ''))
                                };
                                this.setCachedPrice(asset.symbol, price);
                                result[asset.symbol] = price;
                            }
                        } catch (error) {
                            console.error(`Error getting price for ${asset.symbol}:`, error);
                        }
                    }));

                    if (i + batchSize < tradfiAssets.length) {
                        await new Promise(resolve => setTimeout(resolve, 12000));
                    }
                }
            }

            return result;
        } catch (error) {
            console.error('Error getting current prices:', error);
            throw error;
        }
    }
}

module.exports = new PriceService();
