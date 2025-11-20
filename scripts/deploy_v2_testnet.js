const hre = require("hardhat");
const { ethers } = hre;
const upgrades = require('@openzeppelin/hardhat-upgrades');

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // 1. Deploy MockUSDC
    // console.log("\nDeploying MockUSDC...");
    // const MockUSDC = await ethers.getContractFactory("MockUSDC");
    // const mockUSDC = await MockUSDC.deploy();
    // await mockUSDC.deployed();
    // console.log("MockUSDC deployed to:", mockUSDC.address);

    // 2. Deploy FusioFantasyGameV2 as upgradeable proxy
    console.log("\nDeploying FusioFantasyGameV2 (upgradeable proxy)...");
    const FusioFantasyGameV2 = await ethers.getContractFactory("FusioFantasyGameV2");
    const fusioFantasyGameV2 = await upgrades.deployProxy(FusioFantasyGameV2, [
      "0xe67B7843680B26fb1d4d70041cae53E3Aae2636C", // Use MockUSDC as the USDC token
      deployer.address // Use deployer as admin wallet
    ], { initializer: 'initialize' });
    await fusioFantasyGameV2.deployed();
    console.log("FusioFantasyGameV2 proxy deployed to:", fusioFantasyGameV2.address);

    // 4. Verify implementation contract on BSCScan
    console.log("\nWaiting for block confirmations...");
    await fusioFantasyGameV2.deployTransaction.wait(6);

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(fusioFantasyGameV2.address);

    console.log("\nVerifying implementation contract on BSCScan...");
    try {
        await hre.run("verify:verify", {
          address: implementationAddress,
          constructorArguments: [],
        });
        console.log("Implementation contract verified successfully");
    } catch (error) {
        console.log("Error verifying implementation contract:", error.message);
    }

    // 5. Print summary
    console.log("\nDeployment Summary:");
    console.log("--------------------");
    console.log("Network: BSC Testnet");
    console.log(
      "MockUSDC Address:",
      "0xe67B7843680B26fb1d4d70041cae53E3Aae2636C"
    );
    console.log("FusioFantasyGameV2 Proxy Address:", fusioFantasyGameV2.address);
    console.log("Admin Wallet:", deployer.address);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
