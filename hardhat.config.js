require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    bsc: {
      url: process.env.BLOCKCHAIN_RPC_URL,
      accounts: process.env.ADMIN_PRIVATE_KEY
        ? [process.env.ADMIN_PRIVATE_KEY]
        : [],
      gasPrice: 1000000000,
    },
    bscTestnet: {
      url: process.env.BLOCKCHAIN_RPC_URL,
      accounts: process.env.ADMIN_PRIVATE_KEY
        ? [process.env.ADMIN_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: process.env.BSCSCAN_API_KEY,
  },
};
