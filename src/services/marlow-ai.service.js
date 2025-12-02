/**
 * Marlow AI Service - The Best Trader Alive
 *
 * Makes Marlow Banes an elite AI trader using:
 * - Technical Analysis (RSI, MACD, momentum, volatility)
 * - Market Data (volume, price trends, order flow)
 * - News & Sentiment Analysis (crypto news, fear/greed index)
 * - GPT-4 Final Decision Making (optional)
 * - Multiple quantitative strategies combined
 *
 * Strategy Modes:
 * - AGGRESSIVE: High risk, momentum-focused
 * - CONSERVATIVE: Low risk, value-focused
 * - ADAPTIVE: Adjusts based on market conditions
 */

const Asset = require("../models/Asset");
const axios = require("axios");
const config = require("../config");

class MarlowAIService {
  constructor() {
    // Strategy weights - can be adjusted based on market conditions
    this.strategies = {
      MOMENTUM: 0.25, // Ride trends
      MEAN_REVERSION: 0.2, // Buy oversold
      VOLATILITY: 0.15, // Risk-adjusted
      VOLUME: 0.15, // Follow smart money
      SENTIMENT: 0.15, // News & social sentiment
      DIVERSIFICATION: 0.1, // Sector balance
    };

    // Market regime thresholds
    this.regimes = {
      BULL: { fearGreed: 60, btcChange7d: 5 },
      BEAR: { fearGreed: 40, btcChange7d: -5 },
    };

    this.openaiEnabled = !!config.apiKeys.openai;
    if (this.openaiEnabled) {
      console.log("🦍🧠 Marlow AI: GPT-4 enhancement ENABLED");
    }
  }

  /**
   * Generate Marlow's intelligent portfolio picks
   * @param {string} gameType - CRYPTO, TRADFI, or HYBRID
   * @param {number} numAssets - Number of assets to pick (default 8)
   * @returns {Object} { assets: [...], allocations: [...], strategy: {...} }
   */
  async generateSmartPortfolio(gameType, numAssets = 8) {
    console.log(`🦍🧠 Marlow AI analyzing market for ${gameType} portfolio...`);

    // Initialize diagnostics to track each step
    const diagnostics = {
      startTime: new Date().toISOString(),
      gameType,
      numAssets,
      steps: [],
      apiCalls: [],
      errors: [],
      timing: {},
    };

    const startTotal = Date.now();

    try {
      // 1. Get all eligible assets
      const stepStart1 = Date.now();
      const assets = await Asset.find({
        type: gameType,
        isActive: true,
        ape: true,
      });
      diagnostics.timing.assetQuery = Date.now() - stepStart1;
      diagnostics.steps.push({
        step: 1,
        name: "Asset Query",
        status: "success",
        duration: diagnostics.timing.assetQuery,
        details: {
          query: { type: gameType, isActive: true, ape: true },
          assetsFound: assets.length,
          assetSymbols: assets.map((a) => a.symbol),
        },
      });

      if (assets.length < numAssets) {
        throw new Error(`Not enough active ${gameType} assets available (found ${assets.length}, need ${numAssets})`);
      }

      // 2. Get market regime (bull/bear/neutral)
      const stepStart2 = Date.now();
      const marketRegime = await this.detectMarketRegime(gameType, diagnostics);
      diagnostics.timing.marketRegime = Date.now() - stepStart2;
      diagnostics.steps.push({
        step: 2,
        name: "Market Regime Detection",
        status: "success",
        duration: diagnostics.timing.marketRegime,
        details: {
          regime: marketRegime.regime,
          fearGreedIndex: marketRegime.fearGreedIndex,
          btcChange24h: marketRegime.btcChange24h,
          confidence: marketRegime.confidence,
        },
      });
      console.log(`🦍 Market Regime: ${marketRegime.regime} (Fear/Greed: ${marketRegime.fearGreedIndex})`);

      // 3. Adjust strategy weights based on regime
      this.adjustStrategyForRegime(marketRegime);
      diagnostics.steps.push({
        step: 3,
        name: "Strategy Adjustment",
        status: "success",
        duration: 0,
        details: {
          adjustedWeights: { ...this.strategyWeights },
        },
      });

      // 4. Fetch market data for all assets (parallel for speed)
      const stepStart4 = Date.now();
      const assetData = await this.fetchMarketData(assets, gameType, diagnostics);
      diagnostics.timing.marketData = Date.now() - stepStart4;
      diagnostics.steps.push({
        step: 4,
        name: "Market Data Fetch",
        status: "success",
        duration: diagnostics.timing.marketData,
        details: {
          assetsProcessed: assetData.length,
          assetsWithData: assetData.filter((a) => a.marketData).length,
          sampleData: assetData.slice(0, 3).map((a) => ({
            symbol: a.symbol,
            hasMarketData: !!a.marketData,
            price: a.marketData?.currentPrice,
            change24h: a.marketData?.change24h,
          })),
        },
      });

      // 5. Fetch sentiment data for crypto assets
      const stepStart5 = Date.now();
      if (gameType === "CRYPTO" || gameType === "DEFI") {
        await this.enrichWithSentiment(assetData, diagnostics);
        diagnostics.timing.sentiment = Date.now() - stepStart5;
        diagnostics.steps.push({
          step: 5,
          name: "Sentiment Analysis",
          status: "success",
          duration: diagnostics.timing.sentiment,
          details: {
            assetsWithSentiment: assetData.filter((a) => a.sentiment).length,
            sampleSentiment: assetData.slice(0, 3).map((a) => ({
              symbol: a.symbol,
              sentiment: a.sentiment,
              newsCount: a.newsCount || 0,
            })),
          },
        });
      } else {
        diagnostics.steps.push({
          step: 5,
          name: "Sentiment Analysis",
          status: "skipped",
          duration: 0,
          details: { reason: `Skipped for ${gameType} - only applies to CRYPTO/DEFI` },
        });
      }

      // 6. Score each asset using multiple strategies
      const stepStart6 = Date.now();
      const scoredAssets = this.scoreAssets(assetData, marketRegime);
      diagnostics.timing.scoring = Date.now() - stepStart6;
      diagnostics.steps.push({
        step: 6,
        name: "Asset Scoring",
        status: "success",
        duration: diagnostics.timing.scoring,
        details: {
          scoredCount: scoredAssets.length,
          topScores: scoredAssets
            .sort((a, b) => b.totalScore - a.totalScore)
            .slice(0, 5)
            .map((a) => ({
              symbol: a.symbol,
              totalScore: a.totalScore,
              scores: a.scores,
            })),
          bottomScores: scoredAssets
            .sort((a, b) => a.totalScore - b.totalScore)
            .slice(0, 3)
            .map((a) => ({
              symbol: a.symbol,
              totalScore: a.totalScore,
            })),
        },
      });

      // 7. Select top assets based on combined score
      const stepStart7 = Date.now();
      let selectedAssets = this.selectTopAssets(scoredAssets, numAssets);
      diagnostics.timing.selection = Date.now() - stepStart7;
      diagnostics.steps.push({
        step: 7,
        name: "Asset Selection",
        status: "success",
        duration: diagnostics.timing.selection,
        details: {
          selectedCount: selectedAssets.length,
          selected: selectedAssets.map((a) => ({
            symbol: a.symbol,
            totalScore: a.totalScore,
            reasoning: a.reasoning,
          })),
        },
      });

      // 8. Optional: Use GPT-4 for final optimization
      const stepStart8 = Date.now();
      let gptUsed = false;
      if (this.openaiEnabled && (gameType === "CRYPTO" || gameType === "DEFI")) {
        try {
          selectedAssets = await this.gptOptimize(selectedAssets, marketRegime, diagnostics);
          gptUsed = true;
          diagnostics.timing.gptOptimization = Date.now() - stepStart8;
          diagnostics.steps.push({
            step: 8,
            name: "GPT-4 Optimization",
            status: "success",
            duration: diagnostics.timing.gptOptimization,
            details: {
              enabled: true,
              used: true,
              optimizedPicks: selectedAssets.map((a) => a.symbol),
            },
          });
        } catch (gptError) {
          diagnostics.timing.gptOptimization = Date.now() - stepStart8;
          diagnostics.steps.push({
            step: 8,
            name: "GPT-4 Optimization",
            status: "error",
            duration: diagnostics.timing.gptOptimization,
            details: {
              enabled: true,
              used: false,
              error: gptError.message,
            },
          });
          diagnostics.errors.push({ step: 8, error: gptError.message });
        }
      } else {
        diagnostics.steps.push({
          step: 8,
          name: "GPT-4 Optimization",
          status: "skipped",
          duration: 0,
          details: {
            enabled: this.openaiEnabled,
            reason: this.openaiEnabled ? `Skipped for ${gameType}` : "OpenAI API key not configured",
          },
        });
      }

      // 9. Calculate optimal allocations
      const allocations = this.calculateAllocations(selectedAssets, marketRegime);
      diagnostics.steps.push({
        step: 9,
        name: "Allocation Calculation",
        status: "success",
        duration: 0,
        details: {
          allocations: selectedAssets.map((a, i) => ({
            symbol: a.symbol,
            allocation: allocations[i],
            percentage: `${(allocations[i] / 1000).toFixed(1)}%`,
          })),
          totalAllocation: allocations.reduce((sum, a) => sum + a, 0),
        },
      });

      // 10. Log Marlow's reasoning
      this.logMarlowsThinking(selectedAssets, allocations, marketRegime);

      // Finalize diagnostics
      diagnostics.timing.total = Date.now() - startTotal;
      diagnostics.endTime = new Date().toISOString();
      diagnostics.success = true;

      return {
        assets: selectedAssets.map((a) => ({
          symbol: a.symbol,
          assetId: a.assetId,
          score: a.totalScore,
          reasoning: a.reasoning,
        })),
        allocations,
        strategy: this.getStrategyExplanation(selectedAssets, marketRegime),
        diagnostics, // Include full diagnostics in response
      };
    } catch (error) {
      console.error("🦍❌ Marlow AI error, falling back to smart random:", error.message);
      diagnostics.timing.total = Date.now() - startTotal;
      diagnostics.endTime = new Date().toISOString();
      diagnostics.success = false;
      diagnostics.errors.push({ step: "main", error: error.message, stack: error.stack?.split("\n").slice(0, 3) });

      const fallbackResult = await this.fallbackStrategy(gameType, numAssets);
      fallbackResult.diagnostics = {
        ...diagnostics,
        fallbackUsed: true,
        fallbackReason: error.message,
      };
      return fallbackResult;
    }
  }

  /**
   * Detect current market regime using Fear & Greed Index and BTC performance
   */
  async detectMarketRegime(gameType, diagnostics = null) {
    const apiCalls = [];
    try {
      // Get Fear & Greed Index (crypto-specific)
      let fearGreedIndex = 50; // Neutral default
      let fgApiResult = { success: false, source: "alternative.me/fng" };

      if (gameType === "CRYPTO" || gameType === "DEFI") {
        try {
          const fgStart = Date.now();
          const fgResponse = await axios.get("https://api.alternative.me/fng/", { timeout: 5000 });
          fearGreedIndex = parseInt(fgResponse.data?.data?.[0]?.value) || 50;
          fgApiResult = {
            success: true,
            source: "alternative.me/fng",
            duration: Date.now() - fgStart,
            response: {
              value: fearGreedIndex,
              classification: fgResponse.data?.data?.[0]?.value_classification,
              timestamp: fgResponse.data?.data?.[0]?.timestamp,
            },
          };
        } catch (e) {
          console.warn("Could not fetch Fear & Greed index:", e.message);
          fgApiResult = { success: false, source: "alternative.me/fng", error: e.message };
        }
      } else {
        fgApiResult = { success: false, source: "alternative.me/fng", skipped: true, reason: "Not crypto/defi" };
      }
      apiCalls.push(fgApiResult);

      // Get BTC 7-day performance as market proxy
      let btcChange7d = 0;
      let btcApiResult = { success: false, source: "cryptocompare.com" };
      try {
        const btcStart = Date.now();
        const btcResponse = await axios.get("https://min-api.cryptocompare.com/data/v2/histoday", {
          params: { fsym: "BTC", tsym: "USD", limit: 7, api_key: config.apiKeys.cryptoCompare },
          timeout: 5000,
        });
        const prices = btcResponse.data.Data?.Data?.map((d) => d.close) || [];
        if (prices.length >= 7) {
          btcChange7d = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
        }
        btcApiResult = {
          success: true,
          source: "cryptocompare.com",
          duration: Date.now() - btcStart,
          response: {
            pricesCount: prices.length,
            firstPrice: prices[0],
            lastPrice: prices[prices.length - 1],
            change7d: btcChange7d.toFixed(2) + "%",
          },
        };
      } catch (e) {
        console.warn("Could not fetch BTC data:", e.message);
        btcApiResult = { success: false, source: "cryptocompare.com", error: e.message };
      }
      apiCalls.push(btcApiResult);

      // Determine regime
      let regime = "NEUTRAL";
      let confidence = "LOW";
      const bullThreshold = { fearGreed: this.regimes.BULL.fearGreed, btcChange: this.regimes.BULL.btcChange7d };
      const bearThreshold = { fearGreed: this.regimes.BEAR.fearGreed, btcChange: this.regimes.BEAR.btcChange7d };

      if (fearGreedIndex >= bullThreshold.fearGreed && btcChange7d >= bullThreshold.btcChange) {
        regime = "BULL";
        confidence = "HIGH";
      } else if (fearGreedIndex <= bearThreshold.fearGreed && btcChange7d <= bearThreshold.btcChange) {
        regime = "BEAR";
        confidence = "HIGH";
      } else if (fearGreedIndex >= 55 || btcChange7d >= 3) {
        confidence = "MEDIUM"; // Leaning bullish
      } else if (fearGreedIndex <= 45 || btcChange7d <= -3) {
        confidence = "MEDIUM"; // Leaning bearish
      }

      // Add to diagnostics if provided
      if (diagnostics) {
        diagnostics.apiCalls.push(...apiCalls);
      }

      return {
        regime,
        fearGreedIndex,
        btcChange7d,
        confidence,
        thresholds: { bull: bullThreshold, bear: bearThreshold },
        timestamp: new Date(),
        apiCalls, // Include API call details in return
      };
    } catch (error) {
      console.warn("Market regime detection failed:", error.message);
      if (diagnostics) {
        diagnostics.apiCalls.push(...apiCalls);
        diagnostics.errors.push({ step: "marketRegime", error: error.message });
      }
      return { regime: "NEUTRAL", fearGreedIndex: 50, btcChange7d: 0, confidence: "NONE", error: error.message };
    }
  }

  /**
   * Adjust strategy weights based on market regime
   */
  adjustStrategyForRegime(regime) {
    if (regime.regime === "BULL") {
      // In bull market: favor momentum, reduce mean reversion
      this.strategies.MOMENTUM = 0.35;
      this.strategies.MEAN_REVERSION = 0.1;
      this.strategies.VOLATILITY = 0.15;
      this.strategies.VOLUME = 0.2;
      this.strategies.SENTIMENT = 0.15;
      this.strategies.DIVERSIFICATION = 0.05;
      console.log("🦍📈 Bull market detected - favoring momentum plays");
    } else if (regime.regime === "BEAR") {
      // In bear market: favor value/oversold, reduce momentum
      this.strategies.MOMENTUM = 0.1;
      this.strategies.MEAN_REVERSION = 0.3;
      this.strategies.VOLATILITY = 0.2;
      this.strategies.VOLUME = 0.15;
      this.strategies.SENTIMENT = 0.15;
      this.strategies.DIVERSIFICATION = 0.1;
      console.log("🦍📉 Bear market detected - favoring value plays");
    } else {
      // Neutral: balanced approach
      this.strategies.MOMENTUM = 0.25;
      this.strategies.MEAN_REVERSION = 0.2;
      this.strategies.VOLATILITY = 0.15;
      this.strategies.VOLUME = 0.15;
      this.strategies.SENTIMENT = 0.15;
      this.strategies.DIVERSIFICATION = 0.1;
    }
  }

  /**
   * Enrich asset data with sentiment from news
   */
  async enrichWithSentiment(assetData, diagnostics = null) {
    const apiResult = { source: "cryptocompare.com/news", success: false };
    const sentimentResults = [];

    // Fetch trending topics / sentiment from CryptoCompare News API
    try {
      const newsStart = Date.now();
      const categories = assetData
        .slice(0, 5)
        .map((a) => a.symbol)
        .join(",");

      const newsResponse = await axios.get("https://min-api.cryptocompare.com/data/v2/news/", {
        params: {
          categories,
          api_key: config.apiKeys.cryptoCompare,
        },
        timeout: 5000,
      });

      const articles = newsResponse.data?.Data || [];
      apiResult.success = true;
      apiResult.duration = Date.now() - newsStart;
      apiResult.response = {
        articlesFound: articles.length,
        categoriesQueried: categories,
        sampleTitles: articles.slice(0, 3).map((a) => a.title?.substring(0, 60)),
      };

      // Count positive/negative mentions per asset
      for (const asset of assetData) {
        const mentions = articles.filter(
          (a) =>
            a.title?.toLowerCase().includes(asset.symbol.toLowerCase()) ||
            a.body?.toLowerCase().includes(asset.symbol.toLowerCase())
        );

        let sentimentScore = 50; // Neutral
        let sentimentDetails = { mentions: mentions.length, positiveHits: [], negativeHits: [] };

        if (mentions.length > 0) {
          // Simple sentiment: more mentions = positive (assumes coverage is good)
          sentimentScore = Math.min(80, 50 + mentions.length * 5);

          // Check for negative keywords
          const negativeWords = ["crash", "scam", "hack", "bear", "dump", "sell", "warning"];
          const hasNegative = mentions.some((m) => {
            const found = negativeWords.filter((w) => m.title?.toLowerCase().includes(w));
            if (found.length) sentimentDetails.negativeHits.push(...found);
            return found.length > 0;
          });
          if (hasNegative) sentimentScore -= 20;

          // Check for positive keywords
          const positiveWords = ["surge", "rally", "bull", "growth", "partnership", "adoption"];
          const hasPositive = mentions.some((m) => {
            const found = positiveWords.filter((w) => m.title?.toLowerCase().includes(w));
            if (found.length) sentimentDetails.positiveHits.push(...found);
            return found.length > 0;
          });
          if (hasPositive) sentimentScore += 15;
        }

        const finalScore = Math.max(0, Math.min(100, sentimentScore));
        asset.marketData.sentimentScore = finalScore;
        asset.marketData.newsMentions = mentions.length;

        sentimentResults.push({
          symbol: asset.symbol,
          score: finalScore,
          mentions: mentions.length,
          details: sentimentDetails,
        });
      }

      apiResult.sentimentResults = sentimentResults.slice(0, 5); // Top 5 for diagnostics
    } catch (error) {
      console.warn("Sentiment enrichment failed:", error.message);
      apiResult.error = error.message;

      // Set neutral sentiment if failed
      for (const asset of assetData) {
        if (asset.marketData) {
          asset.marketData.sentimentScore = 50;
          asset.marketData.newsMentions = 0;
        }
      }
    }

    if (diagnostics) {
      diagnostics.apiCalls.push(apiResult);
    }
  }

  /**
   * Use GPT-4 for final portfolio optimization (optional)
   */
  async gptOptimize(selectedAssets, marketRegime, diagnostics = null) {
    if (!this.openaiEnabled) return selectedAssets;

    const apiResult = {
      source: "openai/gpt-4o-mini",
      success: false,
      enabled: true,
    };

    try {
      const gptStart = Date.now();
      const OpenAI = require("openai");
      const openai = new OpenAI({ apiKey: config.apiKeys.openai });

      const assetSummary = selectedAssets.map((a) => ({
        symbol: a.symbol,
        score: a.totalScore.toFixed(1),
        momentum: a.marketData?.priceChange7d?.toFixed(1) + "%",
        rsi: a.marketData?.rsi?.toFixed(0),
        reasoning: a.reasoning.join(", "),
      }));

      const prompt = `You are Marlow Banes, the world's best crypto trader.

Market Regime: ${marketRegime.regime} (Fear & Greed: ${marketRegime.fearGreedIndex})

I've selected these 8 assets based on technical analysis:
${JSON.stringify(assetSummary, null, 2)}

Review my picks and suggest any swaps. Return ONLY a JSON array of the final 8 symbols you'd pick, in order of conviction (highest first).
Example: ["BTC", "ETH", "SOL", ...]

Consider:
- Risk-adjusted returns
- Correlation between assets
- Current market conditions
- Potential catalysts

Your picks:`;

      apiResult.request = {
        model: "gpt-4o-mini",
        promptLength: prompt.length,
        inputAssets: assetSummary.map((a) => a.symbol),
        temperature: 0.3,
      };

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      });

      const response = completion.choices[0]?.message?.content || "";
      apiResult.duration = Date.now() - gptStart;
      apiResult.response = {
        rawResponse: response,
        tokensUsed: completion.usage,
        finishReason: completion.choices[0]?.finish_reason,
      };

      // Parse GPT response
      const match = response.match(/\[[\s\S]*\]/);
      if (match) {
        const gptPicks = JSON.parse(match[0]);
        console.log("🦍🤖 GPT-4 optimized picks:", gptPicks);

        apiResult.success = true;
        apiResult.parsedPicks = gptPicks;

        // Reorder assets based on GPT suggestion
        const reordered = [];
        for (const symbol of gptPicks) {
          const asset = selectedAssets.find((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
          if (asset) {
            asset.reasoning.push("GPT-4 confirmed");
            reordered.push(asset);
          }
        }

        // Add any missing assets from original selection
        const added = [];
        for (const asset of selectedAssets) {
          if (!reordered.find((a) => a.symbol === asset.symbol)) {
            added.push(asset.symbol);
            reordered.push(asset);
          }
        }

        apiResult.reorderingDetails = {
          gptRecommended: gptPicks,
          addedFromOriginal: added,
          finalOrder: reordered.slice(0, 8).map((a) => a.symbol),
        };

        if (diagnostics) {
          diagnostics.apiCalls.push(apiResult);
        }

        return reordered.slice(0, 8);
      } else {
        apiResult.parseError = "Could not find JSON array in response";
      }
    } catch (error) {
      console.warn("GPT optimization failed:", error.message);
      apiResult.error = error.message;
    }

    if (diagnostics) {
      diagnostics.apiCalls.push(apiResult);
    }

    return selectedAssets;
  }

  /**
   * Fetch market data from CryptoCompare/AlphaVantage
   */
  async fetchMarketData(assets, gameType, diagnostics = null) {
    const assetData = [];
    const marketDataResults = {
      source: gameType === "TRADFI" ? "alphavantage.co" : "cryptocompare.com",
      assetsQueried: assets.length,
      successful: 0,
      failed: 0,
      failedAssets: [],
    };

    const fetchStart = Date.now();

    for (const asset of assets) {
      try {
        let data;
        if (gameType === "CRYPTO" || gameType === "DEFI") {
          data = await this.fetchCryptoData(asset.symbol);
        } else {
          data = await this.fetchTradFiData(asset.symbol);
        }

        assetData.push({
          ...asset.toObject(),
          marketData: data,
        });
        marketDataResults.successful++;
      } catch (error) {
        console.warn(`⚠️ Could not fetch data for ${asset.symbol}:`, error.message);
        marketDataResults.failed++;
        marketDataResults.failedAssets.push({ symbol: asset.symbol, error: error.message });

        // Include asset with neutral scores if data unavailable
        assetData.push({
          ...asset.toObject(),
          marketData: this.getNeutralMarketData(),
        });
      }
    }

    marketDataResults.duration = Date.now() - fetchStart;

    if (diagnostics) {
      diagnostics.apiCalls.push(marketDataResults);
    }

    return assetData;
  }

  /**
   * Fetch crypto market data from CryptoCompare
   */
  async fetchCryptoData(symbol) {
    try {
      // Get daily OHLCV data for last 14 days
      const response = await axios.get(`https://min-api.cryptocompare.com/data/v2/histoday`, {
        params: {
          fsym: symbol,
          tsym: "USD",
          limit: 14,
          api_key: config.apiKeys.cryptoCompare,
        },
        timeout: 5000,
      });

      const data = response.data.Data?.Data || [];
      if (data.length < 7) {
        return this.getNeutralMarketData();
      }

      // Calculate indicators
      const prices = data.map((d) => d.close);
      const volumes = data.map((d) => d.volumeto);
      const highs = data.map((d) => d.high);
      const lows = data.map((d) => d.low);

      return {
        currentPrice: prices[prices.length - 1],
        priceChange24h: this.calculateChange(prices, 1),
        priceChange7d: this.calculateChange(prices, 7),
        priceChange14d: this.calculateChange(prices, 14),
        avgVolume: this.average(volumes),
        volumeChange: this.calculateChange(volumes, 7),
        rsi: this.calculateRSI(prices),
        volatility: this.calculateVolatility(prices),
        momentum: this.calculateMomentum(prices),
        highLowRatio: this.calculateHighLowPosition(prices[prices.length - 1], highs, lows),
      };
    } catch (error) {
      console.warn(`Crypto data fetch failed for ${symbol}:`, error.message);
      return this.getNeutralMarketData();
    }
  }

  /**
   * Fetch TradFi data from AlphaVantage
   */
  async fetchTradFiData(symbol) {
    try {
      const response = await axios.get(`https://www.alphavantage.co/query`, {
        params: {
          function: "TIME_SERIES_DAILY",
          symbol: symbol,
          apikey: config.apiKeys.alphaVantage,
        },
        timeout: 10000,
      });

      const timeSeries = response.data["Time Series (Daily)"];
      if (!timeSeries) {
        return this.getNeutralMarketData();
      }

      const dates = Object.keys(timeSeries).slice(0, 14);
      const prices = dates.map((d) => parseFloat(timeSeries[d]["4. close"]));
      const volumes = dates.map((d) => parseFloat(timeSeries[d]["5. volume"]));
      const highs = dates.map((d) => parseFloat(timeSeries[d]["2. high"]));
      const lows = dates.map((d) => parseFloat(timeSeries[d]["3. low"]));

      // Reverse to chronological order
      prices.reverse();
      volumes.reverse();
      highs.reverse();
      lows.reverse();

      return {
        currentPrice: prices[prices.length - 1],
        priceChange24h: this.calculateChange(prices, 1),
        priceChange7d: this.calculateChange(prices, 7),
        priceChange14d: this.calculateChange(prices, 14),
        avgVolume: this.average(volumes),
        volumeChange: this.calculateChange(volumes, 7),
        rsi: this.calculateRSI(prices),
        volatility: this.calculateVolatility(prices),
        momentum: this.calculateMomentum(prices),
        highLowRatio: this.calculateHighLowPosition(prices[prices.length - 1], highs, lows),
      };
    } catch (error) {
      console.warn(`TradFi data fetch failed for ${symbol}:`, error.message);
      return this.getNeutralMarketData();
    }
  }

  /**
   * Score each asset using multiple strategies
   */
  scoreAssets(assetData, marketRegime = {}) {
    return assetData.map((asset) => {
      const md = asset.marketData;
      const scores = {};
      const reasoning = [];

      // 1. MOMENTUM SCORE (0-100)
      // Positive price momentum = good (weighted by recency)
      const momentumRaw = md.priceChange24h * 0.2 + md.priceChange7d * 0.5 + md.priceChange14d * 0.3;
      scores.momentum = this.normalizeScore(momentumRaw, -30, 30);

      if (md.priceChange7d > 10) {
        reasoning.push(`🚀 Strong momentum (+${md.priceChange7d.toFixed(1)}%)`);
      } else if (md.priceChange7d > 5) {
        reasoning.push(`📈 Good momentum (+${md.priceChange7d.toFixed(1)}%)`);
      } else if (md.priceChange7d < -10) {
        reasoning.push(`📉 Weak momentum (${md.priceChange7d.toFixed(1)}%)`);
      }

      // 2. MEAN REVERSION SCORE (0-100)
      // Oversold (low RSI) = potential bounce
      const oversoldBonus = md.rsi < 25 ? 40 : md.rsi < 30 ? 30 : md.rsi < 40 ? 15 : 0;
      const overboughtPenalty = md.rsi > 75 ? -25 : md.rsi > 70 ? -15 : md.rsi > 65 ? -5 : 0;
      scores.meanReversion = Math.max(0, Math.min(100, 50 + oversoldBonus + overboughtPenalty + (50 - md.rsi) * 0.6));

      if (md.rsi < 30) {
        reasoning.push(`💎 Deeply oversold (RSI: ${md.rsi.toFixed(0)})`);
      } else if (md.rsi < 40) {
        reasoning.push(`📊 Oversold (RSI: ${md.rsi.toFixed(0)})`);
      } else if (md.rsi > 70) {
        reasoning.push(`⚠️ Overbought (RSI: ${md.rsi.toFixed(0)})`);
      }

      // 3. VOLATILITY SCORE (0-100)
      // In bull market: prefer higher vol, in bear: prefer lower
      let optimalVol = 20; // Default
      if (marketRegime.regime === "BULL") optimalVol = 30; // Accept more risk
      if (marketRegime.regime === "BEAR") optimalVol = 12; // Play safe

      const volDiff = Math.abs(md.volatility - optimalVol);
      scores.volatility = Math.max(0, 100 - volDiff * 2.5);

      if (md.volatility > 40) {
        reasoning.push(`🎢 Very high volatility (${md.volatility.toFixed(0)}%)`);
      } else if (md.volatility > 25) {
        reasoning.push(`⚡ High volatility (${md.volatility.toFixed(0)}%)`);
      }

      // 4. VOLUME SCORE (0-100)
      // Rising volume = smart money interest
      let volumeScore = 50;
      if (md.volumeChange > 50) {
        volumeScore = 90;
        reasoning.push(`🔥 Volume explosion (+${md.volumeChange.toFixed(0)}%)`);
      } else if (md.volumeChange > 20) {
        volumeScore = 75;
        reasoning.push(`📊 Volume surge (+${md.volumeChange.toFixed(0)}%)`);
      } else if (md.volumeChange > 0) {
        volumeScore = 60 + md.volumeChange;
      } else {
        volumeScore = 40 + md.volumeChange * 0.5;
      }
      scores.volume = Math.max(0, Math.min(100, volumeScore));

      // 5. SENTIMENT SCORE (0-100) - from news analysis
      scores.sentiment = md.sentimentScore || 50;
      if (md.newsMentions > 3 && md.sentimentScore > 60) {
        reasoning.push(`📰 Positive news buzz (${md.newsMentions} articles)`);
      } else if (md.sentimentScore < 40) {
        reasoning.push(`📰 Negative sentiment`);
      }

      // 6. DIVERSIFICATION SCORE (0-100)
      // Base score, adjusted in selection phase
      scores.diversification = 50;

      // 7. BONUS FACTORS
      let bonus = 0;

      // Near recent lows = potential value (contrarian)
      if (md.highLowRatio < 0.2) {
        bonus += 20;
        reasoning.push(`💰 Near 14-day low - value play`);
      } else if (md.highLowRatio < 0.3) {
        bonus += 10;
        reasoning.push(`📉 Near support levels`);
      } else if (md.highLowRatio > 0.9) {
        bonus -= 10;
        reasoning.push(`⚠️ Near 14-day high`);
      }

      // MACD-like momentum confirmation
      const shortMomentum = md.priceChange7d;
      const longMomentum = md.priceChange14d / 2; // Normalized
      if (shortMomentum > longMomentum + 5) {
        bonus += 10;
        reasoning.push(`✅ Momentum accelerating`);
      }

      // Calculate weighted total score
      const totalScore =
        scores.momentum * this.strategies.MOMENTUM +
        scores.meanReversion * this.strategies.MEAN_REVERSION +
        scores.volatility * this.strategies.VOLATILITY +
        scores.volume * this.strategies.VOLUME +
        scores.sentiment * this.strategies.SENTIMENT +
        scores.diversification * this.strategies.DIVERSIFICATION +
        bonus;

      return {
        ...asset,
        scores,
        totalScore,
        reasoning: reasoning.length > 0 ? reasoning : ["📊 Neutral outlook"],
      };
    });
  }

  /**
   * Select top assets with diversification
   */
  selectTopAssets(scoredAssets, numAssets) {
    // Sort by total score
    const sorted = [...scoredAssets].sort((a, b) => b.totalScore - a.totalScore);

    // Select ensuring some diversification
    const selected = [];
    const categories = new Set();

    for (const asset of sorted) {
      if (selected.length >= numAssets) break;

      // Allow max 3 from same category for diversification
      const category = asset.category || "other";
      const categoryCount = selected.filter((a) => (a.category || "other") === category).length;

      if (categoryCount < 3) {
        selected.push(asset);
        categories.add(category);
      }
    }

    // If not enough, fill with remaining top scores
    if (selected.length < numAssets) {
      for (const asset of sorted) {
        if (selected.length >= numAssets) break;
        if (!selected.find((a) => a.symbol === asset.symbol)) {
          selected.push(asset);
        }
      }
    }

    return selected;
  }

  /**
   * Calculate allocations using FIXED amounts (same as player portfolios)
   * Assets are already sorted by score, so higher scored assets get larger allocations
   * This matches exactly what players use: [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000]
   */
  calculateAllocations(selectedAssets, marketRegime = {}) {
    // FIXED allocations - must match player portfolio allocations exactly
    // Total = $100,000: 20% + 20% + 15% + 15% + 10% + 10% + 5% + 5%
    const FIXED_ALLOCATIONS = [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000];

    // Take only as many allocations as we have assets
    const numAssets = selectedAssets.length;
    let allocations = FIXED_ALLOCATIONS.slice(0, numAssets);

    // If we have fewer than 8 assets, normalize to $100,000
    if (numAssets < 8) {
      const currentTotal = allocations.reduce((sum, a) => sum + a, 0);
      const ratio = 100000 / currentTotal;
      allocations = allocations.map((a) => Math.round(a * ratio));

      // Fix any rounding errors
      const diff = 100000 - allocations.reduce((sum, a) => sum + a, 0);
      if (diff !== 0) {
        allocations[0] += diff;
      }
    }

    return allocations;
  }

  /**
   * Log Marlow's thinking process
   */
  logMarlowsThinking(assets, allocations, marketRegime = {}) {
    console.log("\n");
    console.log("🦍🧠 ╔═══════════════════════════════════════════════════════════════╗");
    console.log("   ║           MARLOW BANES - AI PORTFOLIO ANALYSIS               ║");
    console.log("   ╠═══════════════════════════════════════════════════════════════╣");

    if (marketRegime.regime) {
      const regimeEmoji = marketRegime.regime === "BULL" ? "📈" : marketRegime.regime === "BEAR" ? "📉" : "➡️";
      console.log(
        `   ║  Market Regime: ${regimeEmoji} ${marketRegime.regime.padEnd(8)} | Fear/Greed: ${String(
          marketRegime.fearGreedIndex
        ).padStart(3)} | BTC 7d: ${(marketRegime.btcChange7d > 0 ? "+" : "") + marketRegime.btcChange7d.toFixed(1)}%`
      );
      console.log("   ╠═══════════════════════════════════════════════════════════════╣");
    }

    console.log("   ║  #  ASSET    │ SCORE │ ALLOC │ REASONING");
    console.log("   ╠═══════════════════════════════════════════════════════════════╣");

    assets.forEach((asset, i) => {
      const alloc = (allocations[i] / 1000).toFixed(0) + "%";
      const score = asset.totalScore.toFixed(1);
      const reasons = asset.reasoning.slice(0, 2).join(" | ");
      console.log(
        `   ║  ${(i + 1).toString().padStart(2)}. ${asset.symbol.padEnd(8)} │ ${score.padStart(5)} │ ${alloc.padStart(
          4
        )}  │ ${reasons}`
      );
    });

    console.log("   ╠═══════════════════════════════════════════════════════════════╣");
    console.log(`   ║  💰 Total Allocation: $${allocations.reduce((a, b) => a + b, 0).toLocaleString()}`);
    console.log("   ╚═══════════════════════════════════════════════════════════════╝\n");
  }

  /**
   * Get strategy explanation for UI
   */
  getStrategyExplanation(assets, marketRegime = {}) {
    const bullish = assets.filter((a) => a.scores?.momentum > 60).length;
    const oversold = assets.filter((a) => a.scores?.meanReversion > 70).length;
    const highVol = assets.filter((a) => a.marketData?.volatility > 20).length;
    const highSentiment = assets.filter((a) => a.scores?.sentiment > 65).length;

    let strategy = "Balanced";
    let confidence = "MEDIUM";

    if (marketRegime.regime === "BULL" && bullish >= 4) {
      strategy = "Aggressive Momentum";
      confidence = "HIGH";
    } else if (marketRegime.regime === "BEAR" && oversold >= 3) {
      strategy = "Contrarian Value";
      confidence = "MEDIUM";
    } else if (bullish >= 5) {
      strategy = "Momentum-Heavy";
      confidence = "HIGH";
    } else if (oversold >= 3) {
      strategy = "Value/Contrarian";
      confidence = "MEDIUM";
    } else if (highVol >= 4) {
      strategy = "High-Risk/High-Reward";
      confidence = "LOW";
    } else if (highSentiment >= 4) {
      strategy = "News-Driven";
      confidence = "MEDIUM";
    }

    return {
      type: strategy,
      confidence,
      marketRegime: marketRegime.regime || "NEUTRAL",
      fearGreedIndex: marketRegime.fearGreedIndex || 50,
      bullishPicks: bullish,
      valuePicks: oversold,
      highVolatility: highVol,
      positiveSentiment: highSentiment,
    };
  }

  /**
   * Fallback to smart random if AI fails
   * This mimics the original random selection behavior
   */
  async fallbackStrategy(gameType, numAssets) {
    console.log("🦍 Using smart random fallback strategy...");

    try {
      // First try with ape: true (preferred for Marlow games)
      let assets = await Asset.find({
        type: gameType,
        isActive: true,
        ape: true,
      });

      // If no ape assets, fall back to any active assets
      if (assets.length < numAssets) {
        console.warn(`🦍 Only ${assets.length} APE assets found, using all active ${gameType} assets`);
        assets = await Asset.find({
          type: gameType,
          isActive: true,
        });
      }

      if (assets.length === 0) {
        throw new Error(`No active ${gameType} assets found for fallback!`);
      }

      if (assets.length < numAssets) {
        console.warn(`🦍 Only ${assets.length} assets available, using all of them`);
      }

      // Fisher-Yates shuffle for proper randomization
      const shuffled = [...assets];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Select up to numAssets
      const selected = shuffled.slice(0, Math.min(numAssets, shuffled.length));

      // Standard tiered allocations (same as original implementation)
      // Total = 100,000 when 8 assets
      const baseAllocations = [20000, 20000, 15000, 15000, 10000, 10000, 5000, 5000];
      let allocations = baseAllocations.slice(0, selected.length);

      // Normalize to exactly $100,000 if we have fewer assets
      const currentTotal = allocations.reduce((sum, a) => sum + a, 0);
      if (currentTotal !== 100000) {
        const ratio = 100000 / currentTotal;
        allocations = allocations.map((a) => Math.round(a * ratio));
        // Fix rounding errors
        const diff = 100000 - allocations.reduce((sum, a) => sum + a, 0);
        if (diff !== 0) {
          allocations[0] += diff;
        }
      }

      console.log(`🦍 Fallback selected ${selected.length} assets: ${selected.map((a) => a.symbol).join(", ")}`);

      return {
        assets: selected.map((a) => ({
          symbol: a.symbol,
          assetId: a.assetId,
          score: 50,
          reasoning: ["Fallback: Random selection"],
        })),
        allocations,
        strategy: {
          type: "Random Fallback",
          confidence: "LOW",
          marketRegime: "NEUTRAL",
          fearGreedIndex: 50,
          bullishPicks: 0,
          valuePicks: 0,
          highVolatility: 0,
          positiveSentiment: 0,
        },
      };
    } catch (error) {
      console.error("🦍❌ Fallback strategy failed:", error.message);
      // Ultimate fallback - throw to let caller handle
      throw new Error(`Marlow fallback failed: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════
  // TECHNICAL ANALYSIS HELPERS
  // ═══════════════════════════════════════════════

  calculateChange(values, periods) {
    if (values.length < periods + 1) return 0;
    const current = values[values.length - 1];
    const past = values[values.length - 1 - periods];
    return past > 0 ? ((current - past) / past) * 100 : 0;
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  calculateVolatility(prices) {
    if (prices.length < 2) return 15;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = this.average(returns);
    const squaredDiffs = returns.map((r) => Math.pow(r - mean, 2));
    const variance = this.average(squaredDiffs);

    return Math.sqrt(variance) * Math.sqrt(365) * 100; // Annualized %
  }

  calculateMomentum(prices) {
    if (prices.length < 10) return 0;

    // Rate of change over 10 periods
    const roc = ((prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10]) * 100;
    return roc;
  }

  calculateHighLowPosition(current, highs, lows) {
    const high14 = Math.max(...highs);
    const low14 = Math.min(...lows);
    const range = high14 - low14;

    if (range === 0) return 0.5;
    return (current - low14) / range;
  }

  normalizeScore(value, min, max) {
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  }

  average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  getNeutralMarketData() {
    return {
      currentPrice: 0,
      priceChange24h: 0,
      priceChange7d: 0,
      priceChange14d: 0,
      avgVolume: 0,
      volumeChange: 0,
      rsi: 50,
      volatility: 15,
      momentum: 0,
      highLowRatio: 0.5,
    };
  }
}

module.exports = new MarlowAIService();
