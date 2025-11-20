require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Asset = require('../models/Asset');
const config = require('../config');

const TRADFI_SYMBOLS = [
  "SIRI",
  "DKNG",
  "COIN",
  "BB",
  "NOK",
  "TLRY",
  "BYND",
  "CLOV",
  "RIOT",
  "PLUG",
  "SPY",
  "VOO",
  "VTI",
  "QQQ",
  "VUG",
  "VTV",
  "IWF",
  "IJH",
  "IJR",
  "SCHD",
  "JAAA",
  "SGOV",
  "BND",
  "BNDX",
  "TLT",
  "IAU",
  "ARKK",
  "O",
  "SOCL",
  "XLU",
  "XLK",
  "XLF",
  "XLRE",
  "XLE",
  "XLY",
  "XLC",
  "XLI",
  "XLP",
  "XLV",
  "XLB",
  "ICLN",
  "IBIT",
  "TQQQ",
  "UPRO",
  "YINN",
  "SOXL",
  "TSLL",
  "FAS",
  "SQQQ",
  "SPXS",
  "YANG",
  "EWJ",
  "FXI",
  "EWZ",
  "EWT",
  "EWG",
  "EWH",
  "EWI",
  "EWW",
  "EWU",
  "EPI",
  "IDX",
  "EWY",
  "EWA",
  "EWS",
  "EWC",
  "EWP",
  "EWL",
  "EZA",
];

async function initializeTradFiAssets() {
    console.log('Initializing TradFi assets...');
    
    for (let i = 0; i < TRADFI_SYMBOLS.length; i++) {
        const symbol = TRADFI_SYMBOLS[i];
        try {
            // Get company overview
            const response = await axios.get(
                `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${config.apiKeys.alphaVantage}`
            );

            if (response.data && response.data.Name) {
                await Asset.findOneAndUpdate(
                    { symbol },
                    {
                        assetId: 124 + i, // Starting from 101 for TradFi
                        symbol,
                        name: response.data.Name,
                        type: 'TRADFI',
                        isActive: true
                    },
                    { upsert: true }
                );
                console.log(`Added/Updated TradFi asset: ${symbol}`);
            }
            
            // Alpha Vantage has a rate limit of 5 calls per minute
            if ((i + 1) % 75 === 0) {
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        } catch (error) {
            console.error(`Error adding TradFi asset ${symbol}:`, error.message);
        }
    }
}

async function initializeDefiAssets() {
  console.log("Initializing DeFi assets...");

  try {
    // Get top 200 coins by market cap
    const response = await axios.get(
      `https://min-api.cryptocompare.com/data/top/mktcapfull?limit=100&page=1&tsym=USD&api_key=${config.apiKeys.cryptoCompare}`
    );

    if (response.data && response.data.Data) {
      for (let i = 0; i < response.data.Data.length; i++) {
        const coin = response.data.Data[i];
        const coinInfo = coin.CoinInfo;
        const rawInfo = coin.RAW?.USD;

        const imageUrl = coinInfo.ImageUrl; // Get the image URL
        console.log("coinInfo.Name", coinInfo.Name);

        // Check if the record exists
        const existingAsset = await Asset.findOne({
          symbol: coinInfo.Name,
          type: "DEFI", // Add the filter for type "DEFI"
        });

        // If the record exists, update it
        if (existingAsset) {
          existingAsset.imageUrl = imageUrl; // Update the image URL
          await existingAsset.save();
          console.log(`Updated DeFi asset: ${coinInfo.Name}`);
        } else {
          console.log(`Skipping DeFi asset (not found): ${coinInfo.Name}`);
        }
      }
    }
  } catch (error) {
    console.error("Error initializing DeFi assets:", error.message);
  }
}

async function main() {
    try {
        await mongoose.connect(config.mongodb.uri);
        console.log('Connected to MongoDB');

        // await initializeTradFiAssets();
        await initializeDefiAssets();

        console.log('Asset initialization completed');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
