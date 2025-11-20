const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const Asset = require("../models/Asset");
const config = require("../config");

// Directory to save images
const IMAGE_DIR = path.join(__dirname, "crypto");
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR);
}

async function fetchDefiAssets() {
  try {
    await mongoose.connect(config.mongodb.uri);
    console.log("Connected to MongoDB");

    const defiAssets = await Asset.find({ type: "DEFI" });
    mongoose.disconnect();
    return defiAssets;
  } catch (error) {
    console.error("Error fetching DeFi assets:", error.message);
    return [];
  }
}

async function downloadImage(symbol) {
  try {
    // Get token logo from Moralis token API
    const response = await axios({
      url: `https://deep-index.moralis.io/api/v2/market-data/token-logos`,
      params: {
        chain: 'eth',
        symbols: [symbol]
      },
      headers: {
        'Accept': 'application/json',
        'X-API-Key': config.apiKeys.moralis
      }
    });

    if (!response.data || !response.data.length || !response.data[0].logo) {
      throw new Error('Logo not found in Moralis');
    }

    const logoUrl = response.data[0].logo;
    const imagePath = path.join(IMAGE_DIR, `${symbol}.png`);

    // Download the logo
    const imageResponse = await axios({
      url: logoUrl,
      responseType: "stream",
      headers: {
        'Accept': 'image/*'
      }
    });

    const writer = fs.createWriteStream(imagePath);
    imageResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`Successfully downloaded logo for ${symbol}`);
        resolve();
      });
      writer.on("error", (err) => {
        console.error(`Error writing logo for ${symbol}:`, err);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Failed to download logo for ${symbol}:`, error.message);
    // Try fallback to CoinGecko API
    try {
      const geckoResponse = await axios({
        url: `https://api.coingecko.com/api/v3/simple/search`,
        params: {
          query: symbol
        }
      });

      if (geckoResponse.data && geckoResponse.data.length > 0 && geckoResponse.data[0].thumb) {
        const logoUrl = geckoResponse.data[0].thumb;
        const imagePath = path.join(IMAGE_DIR, `${symbol}.png`);

        const imageResponse = await axios({
          url: logoUrl,
          responseType: "stream"
        });

        const writer = fs.createWriteStream(imagePath);
        imageResponse.data.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on("finish", () => {
            console.log(`Successfully downloaded logo for ${symbol} from CoinGecko`);
            resolve();
          });
          writer.on("error", (err) => {
            console.error(`Error writing logo for ${symbol}:`, err);
            reject(err);
          });
        });
      }
    } catch (geckoError) {
      console.error(`Failed to download logo from CoinGecko for ${symbol}:`, geckoError.message);
    }
  }
}

async function downloadAllLogos() {
  console.log("Fetching DeFi assets...");
  const defiAssets = await fetchDefiAssets();

  for (const asset of defiAssets) {
    await downloadImage(asset.symbol);
  }
  console.log("All DeFi logos downloaded.");
}

downloadAllLogos();
