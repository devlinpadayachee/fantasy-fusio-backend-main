const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);
    // Deploy FusioFantasyGame contract
    const GAS_FEE_WALLET = deployer.address; // Use deployer's address as gas fee wallet
    const APE_WALLET = deployer.address; // Use deployer's address as ape wallet

    const FusioFantasyGame = await hre.ethers.getContractFactory("FusioFantasyGame");
    const fusioFantasyGame = await FusioFantasyGame.deploy(
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      GAS_FEE_WALLET,
      APE_WALLET
    );

    await fusioFantasyGame.deployed();
    console.log("FusioFantasyGame deployed to:", fusioFantasyGame.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
