const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FusioFantasyGame", function () {
    let fusioFantasyGame;
    let usdcToken;
    let owner;
    let user1;
    let user2;
    let gasFeeWallet;
    let apeWallet;

    // Constants from contract
    const INITIAL_PORTFOLIO_VALUE = ethers.utils.parseUnits("100000", 18); // 100,000 USDC
    const ENTRY_FEE = ethers.utils.parseUnits("5", 18); // 5 USDC
    const GAS_FEE = ethers.utils.parseUnits("0.1", 18); // 0.1 USDC
    const ADMIN_FEE_PERCENTAGE = 10;
    const MAX_ASSETS = 8;

    // Test data
    const testSymbols = [
        ethers.utils.formatBytes32String("BTC"),
        ethers.utils.formatBytes32String("ETH"),
        ethers.utils.formatBytes32String("BNB"),
        ethers.utils.formatBytes32String("SOL"),
        ethers.utils.formatBytes32String("ADA"),
        ethers.utils.formatBytes32String("DOT"),
        ethers.utils.formatBytes32String("AVAX"),
        ethers.utils.formatBytes32String("MATIC")
    ];
    const testQuantities = [
        ethers.utils.parseUnits("0.2", 18),
        ethers.utils.parseUnits("2", 18),
        ethers.utils.parseUnits("15", 18),
        ethers.utils.parseUnits("15", 18),
        ethers.utils.parseUnits("10", 18),
        ethers.utils.parseUnits("10", 18),
        ethers.utils.parseUnits("5", 18),
        ethers.utils.parseUnits("5", 18)
    ];

    console.log("testSymbols", testSymbols);
    console.log("testQuantities", testQuantities);

    beforeEach(async function () {
        // Get signers
        [owner, user1, user2, gasFeeWallet, apeWallet] = await ethers.getSigners();

        // Deploy mock USDC token
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdcToken = await MockUSDC.deploy();
        await usdcToken.deployed();

        // Deploy FusioFantasyGame contract
        const FusioFantasyGame = await ethers.getContractFactory("FusioFantasyGame");
        fusioFantasyGame = await FusioFantasyGame.deploy(
            usdcToken.address,
            gasFeeWallet.address,
            apeWallet.address
        );
        await fusioFantasyGame.deployed();

        // Mint USDC to users
        await usdcToken.mint(user1.address, ethers.utils.parseUnits("1000", 18));
        await usdcToken.mint(user2.address, ethers.utils.parseUnits("1000", 18));

        // Approve USDC spending
        await usdcToken.connect(user1).approve(fusioFantasyGame.address, ethers.constants.MaxUint256);
        await usdcToken.connect(user2).approve(fusioFantasyGame.address, ethers.constants.MaxUint256);
    });

    describe("Game Creation", function () {
        it("Should create a new DeFi game", async function () {
            const startTime = (await time.latest()) + 100; // 1 hour from now
            const endTime = startTime + 300; // 24 hours duration
            
            console.log("startTime", startTime);
            console.log("endTime", endTime);

            await fusioFantasyGame.createGame(startTime, endTime, 0); // 0 for DEFI

            const gameId = await fusioFantasyGame.currentGameIds(0);
            expect(gameId).to.equal(1);

            const game = await fusioFantasyGame.games(gameId);
            expect(game.startTime).to.equal(startTime);
            expect(game.endTime).to.equal(endTime);
            expect(game.status).to.equal(1); // ACTIVE
            expect(game.gameType).to.equal(0); // DEFI
        });

        it("Should create a new TradFi game", async function () {
            const startTime = (await time.latest()) + 3600;
            const endTime = startTime + 86400;

            await fusioFantasyGame.createGame(startTime, endTime, 1); // 1 for TRADFI

            const gameId = await fusioFantasyGame.currentGameIds(1);
            expect(gameId).to.equal(1);

            const game = await fusioFantasyGame.games(gameId);
            expect(game.startTime).to.equal(startTime);
            expect(game.endTime).to.equal(endTime);
            expect(game.status).to.equal(1); // ACTIVE
            expect(game.gameType).to.equal(1); // TRADFI
        });

        it("Should not create a game with invalid times", async function () {
            const currentTime = await time.latest();
            
            // Start time in past
            await expect(
                fusioFantasyGame.createGame(currentTime - 3600, currentTime + 86400, 0)
            ).to.be.revertedWith("Invalid start time");

            // End time before start time
            await expect(
                fusioFantasyGame.createGame(currentTime + 3600, currentTime + 1800, 0)
            ).to.be.revertedWith("Invalid end time");
        });
    });

    describe("Balance Management", function () {
        it("Should lock balance correctly", async function () {
            // Approve USDC spending
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE));
            
            // Lock balance
            await fusioFantasyGame.lockBalance(user1.address);
            
            // Verify locked balance
            const lockedBalance = await fusioFantasyGame.userLockedBalance(user1.address);
            const adminFee = ENTRY_FEE.mul(ADMIN_FEE_PERCENTAGE).div(100);
            const expectedLockedBalance = ENTRY_FEE.sub(adminFee);
            
            expect(lockedBalance).to.equal(expectedLockedBalance);
        });

        it("Should handle partial balance deduction", async function () {
            // Add initial balance to user
            const initialBalance = ethers.utils.parseUnits("2", 18);
            await usdcToken.connect(owner).transfer(user1.address, initialBalance);
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE));
            
            // Try to lock balance
            await fusioFantasyGame.lockBalance(user1.address);
            
            // Verify balance was deducted
            const userBalance = await fusioFantasyGame.userBalances(user1.address);
            expect(userBalance).to.equal(0);
            
            // Verify USDC transfer
            const contractBalance = await usdcToken.balanceOf(fusioFantasyGame.address);
            expect(contractBalance).to.be.gt(0);
        });

        it("Should fail if insufficient USDC approval", async function () {
            // Revoke approval
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, 0);
            
            // Try to lock balance without approval
            await expect(
                fusioFantasyGame.lockBalance(user1.address)
            ).to.be.revertedWith("ERC20: insufficient allowance");
        });
    });

    describe("Portfolio Creation", function () {
        let gameId;

        beforeEach(async function () {
            // Create a DeFi game
            const startTime = (await time.latest()) + 3600;
            const endTime = startTime + 86400;
            await fusioFantasyGame.createGame(startTime, endTime, 0);
            gameId = await fusioFantasyGame.currentGameIds(0);

            // Move time to game start
            await time.increaseTo(startTime);
        });

        it("Should create a portfolio with locked balance", async function () {
            // Lock balance first
            await fusioFantasyGame.lockBalance(user1.address);

            // Get current game ID
            const currentGameId = await fusioFantasyGame.currentGameIds(0); // DEFI

            // Create portfolio
            const tx = await fusioFantasyGame.createAndLockPortfolio(
                user1.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                false // not ape
            );
            await tx.wait();

            // Verify portfolio creation
            const portfolioId = 1;
            const portfolio = await fusioFantasyGame.portfolioInfo(portfolioId);
            expect(portfolio.isLocked).to.be.true;
            expect(portfolio.initialValue).to.equal(INITIAL_PORTFOLIO_VALUE);
            expect(portfolio.gameId).to.equal(currentGameId);

            // Verify game portfolios
            const gamePortfolios = await fusioFantasyGame.gamePortfolios(currentGameId);
            expect(gamePortfolios.length).to.equal(1);
            expect(gamePortfolios[0]).to.equal(portfolioId);

            // Verify portfolio assets
            const [symbols, quantities] = await fusioFantasyGame.getPortfolioAssets(portfolioId);
            expect(symbols.length).to.equal(MAX_ASSETS);
            expect(quantities.length).to.equal(MAX_ASSETS);
            for (let i = 0; i < MAX_ASSETS; i++) {
                expect(symbols[i]).to.equal(testSymbols[i]);
                expect(quantities[i]).to.equal(testQuantities[i]);
            }
        });

        it("Should create an ape portfolio", async function () {
            await fusioFantasyGame.createAndLockPortfolio(
                apeWallet.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                true // is ape
            );

            const portfolioId = 1;
            const apePortfolioId = await fusioFantasyGame.apePortfoliosByGame(gameId);
            expect(apePortfolioId).to.equal(portfolioId);
        });

        it("Should not create portfolio without locked balance", async function () {
            await expect(
                fusioFantasyGame.createAndLockPortfolio(
                    user1.address,
                    testSymbols,
                    testQuantities,
                    0,
                    false
                )
            ).to.be.revertedWith("Payment failed");
        });
    });

    describe("Portfolio Value Updates", function () {
        let gameId;
        let portfolioId;

        beforeEach(async function () {
            // Get current timestamp
            const currentTime = await time.latest();
            
            // Create a DeFi game starting now
            const startTime = currentTime;
            const endTime = startTime + 86400; // 24 hours from now
            await fusioFantasyGame.createGame(startTime, endTime, 0);
            gameId = await fusioFantasyGame.currentGameIds(0);

            // Lock balance and create portfolio
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE));
            await fusioFantasyGame.lockBalance(user1.address);
            await fusioFantasyGame.createAndLockPortfolio(
                user1.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                false
            );
            portfolioId = 1;
        });

        it("Should update portfolio value correctly", async function () {
            const newValue = INITIAL_PORTFOLIO_VALUE.mul(2); // 200%
            await fusioFantasyGame.updatePortfolioValue(portfolioId, newValue);

            const portfolio = await fusioFantasyGame.portfolioInfo(portfolioId);
            expect(portfolio.currentValue).to.equal(newValue);
        });

        it("Should not update portfolio value for non-existent portfolio", async function () {
            const invalidPortfolioId = 999;
            await expect(
                fusioFantasyGame.updatePortfolioValue(invalidPortfolioId, INITIAL_PORTFOLIO_VALUE)
            ).to.be.revertedWith("Portfolio not found");
        });

        it("Should not update portfolio value for wrong game", async function () {
            // Complete current game
            await time.increase(86401); // Move past end time
            await fusioFantasyGame.endGame(gameId);
            
            // Create new game
            const currentTime = await time.latest();
            const startTime = currentTime + 3600;
            const endTime = startTime + 86400;
            await fusioFantasyGame.createGame(startTime, endTime, 0);
            
            await expect(
                fusioFantasyGame.updatePortfolioValue(portfolioId, INITIAL_PORTFOLIO_VALUE)
            ).to.be.revertedWith("Portfolio not in current game");
        });
    });

    describe("Game Type Management", function () {
        it("Should handle both game types independently", async function () {
            const currentTime = await time.latest();
            
            // Create both game types
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 0); // DEFI
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 1); // TRADFI

            const defiGameId = await fusioFantasyGame.currentGameIds(0);
            const tradfiGameId = await fusioFantasyGame.currentGameIds(1);

            // Verify game IDs
            expect(defiGameId).to.equal(1);
            expect(tradfiGameId).to.equal(1);

            // Verify game types
            const defiGame = await fusioFantasyGame.games(defiGameId);
            const tradfiGame = await fusioFantasyGame.games(tradfiGameId);

            expect(defiGame.gameType).to.equal(0);
            expect(tradfiGame.gameType).to.equal(1);
            expect(defiGame.status).to.equal(1); // ACTIVE
            expect(tradfiGame.status).to.equal(1); // ACTIVE
        });

        it("Should track portfolios separately for each game type", async function () {
            const currentTime = await time.latest();
            
            // Create both game types
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 0); // DEFI
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 1); // TRADFI

            // Lock balance twice for two portfolios
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE).mul(2));
            await fusioFantasyGame.lockBalance(user1.address);
            await fusioFantasyGame.lockBalance(user1.address);

            // Create portfolio in DeFi game
            await fusioFantasyGame.createAndLockPortfolio(
                user1.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                false
            );

            // Create portfolio in TradFi game
            await fusioFantasyGame.createAndLockPortfolio(
                user1.address,
                testSymbols,
                testQuantities,
                1, // TRADFI
                false
            );

            const defiGameId = await fusioFantasyGame.currentGameIds(0);
            const tradfiGameId = await fusioFantasyGame.currentGameIds(1);

            // Verify portfolios are in correct games
            const defiPortfolios = await fusioFantasyGame.gamePortfolios(defiGameId);
            const tradfiPortfolios = await fusioFantasyGame.gamePortfolios(tradfiGameId);

            expect(defiPortfolios.length).to.equal(1);
            expect(tradfiPortfolios.length).to.equal(1);
            expect(defiPortfolios[0]).to.not.equal(tradfiPortfolios[0]);

            // Verify portfolio game IDs
            const defiPortfolio = await fusioFantasyGame.portfolioInfo(defiPortfolios[0]);
            const tradfiPortfolio = await fusioFantasyGame.portfolioInfo(tradfiPortfolios[0]);
            expect(defiPortfolio.gameId).to.equal(defiGameId);
            expect(tradfiPortfolio.gameId).to.equal(tradfiGameId);
        });
    });

    describe("Reward Distribution", function () {
        let gameId;

        beforeEach(async function () {
            const currentTime = await time.latest();
            
            // Create a DeFi game starting now
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 0);
            gameId = await fusioFantasyGame.currentGameIds(0);

            // Create ape portfolio
            await fusioFantasyGame.createAndLockPortfolio(
                apeWallet.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                true
            );

            // Lock balances for both users
            await usdcToken.connect(user1).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE));
            await usdcToken.connect(user2).approve(fusioFantasyGame.address, ENTRY_FEE.add(GAS_FEE));
            await fusioFantasyGame.lockBalance(user1.address);
            await fusioFantasyGame.lockBalance(user2.address);

            // Create user portfolios
            await fusioFantasyGame.createAndLockPortfolio(
                user1.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                false
            );

            await fusioFantasyGame.createAndLockPortfolio(
                user2.address,
                testSymbols,
                testQuantities,
                0, // DEFI
                false
            );
        });

        it("Should distribute rewards to winners", async function () {
            // Get portfolio IDs
            const apePortfolioId = await fusioFantasyGame.apePortfoliosByGame(gameId);
            const portfolios = await fusioFantasyGame.gamePortfolios(gameId);
            const user1PortfolioId = portfolios[0];
            const user2PortfolioId = portfolios[1];

            // Set portfolio values
            await fusioFantasyGame.updatePortfolioValue(apePortfolioId, INITIAL_PORTFOLIO_VALUE);
            await fusioFantasyGame.updatePortfolioValue(user1PortfolioId, INITIAL_PORTFOLIO_VALUE.mul(2)); // 200%
            await fusioFantasyGame.updatePortfolioValue(user2PortfolioId, INITIAL_PORTFOLIO_VALUE.div(2)); // 50%

            // Move time to game end
            await time.increase(86401); // 24 hours + 1 second

            // Get prize pool before distribution
            const game = await fusioFantasyGame.games(gameId);
            const totalPrizePool = game.totalPrizePool;

            // Distribute rewards
            await fusioFantasyGame.distributeRewardsAndEndGame(gameId);

            // Verify rewards
            const user1Balance = await fusioFantasyGame.userBalances(user1.address);
            const user2Balance = await fusioFantasyGame.userBalances(user2.address);
            
            expect(user1Balance).to.equal(totalPrizePool); // Single winner gets entire pool
            expect(user2Balance).to.equal(0);
        });

        it("Should handle multiple winners correctly", async function () {
            // Get portfolio IDs
            const apePortfolioId = await fusioFantasyGame.apePortfoliosByGame(gameId);
            const portfolios = await fusioFantasyGame.gamePortfolios(gameId);
            const user1PortfolioId = portfolios[0];
            const user2PortfolioId = portfolios[1];

            // Set portfolio values
            await fusioFantasyGame.updatePortfolioValue(apePortfolioId, INITIAL_PORTFOLIO_VALUE);
            await fusioFantasyGame.updatePortfolioValue(user1PortfolioId, INITIAL_PORTFOLIO_VALUE.mul(2)); // 200%
            await fusioFantasyGame.updatePortfolioValue(user2PortfolioId, INITIAL_PORTFOLIO_VALUE.mul(3)); // 300%

            // Move time to game end
            await time.increase(86401);

            // Get prize pool before distribution
            const game = await fusioFantasyGame.games(gameId);
            const totalPrizePool = game.totalPrizePool;
            const expectedPrizePerWinner = totalPrizePool.div(2);

            // Distribute rewards
            await fusioFantasyGame.distributeRewardsAndEndGame(gameId);

            // Verify rewards
            const user1Balance = await fusioFantasyGame.userBalances(user1.address);
            const user2Balance = await fusioFantasyGame.userBalances(user2.address);
            
            expect(user1Balance).to.equal(expectedPrizePerWinner);
            expect(user2Balance).to.equal(expectedPrizePerWinner);
        });

        it("Should handle no winners correctly", async function () {
            // Get portfolio IDs
            const apePortfolioId = await fusioFantasyGame.apePortfoliosByGame(gameId);
            const portfolios = await fusioFantasyGame.gamePortfolios(gameId);
            const user1PortfolioId = portfolios[0];
            const user2PortfolioId = portfolios[1];

            // Set portfolio values
            await fusioFantasyGame.updatePortfolioValue(apePortfolioId, INITIAL_PORTFOLIO_VALUE.mul(4)); // 400%
            await fusioFantasyGame.updatePortfolioValue(user1PortfolioId, INITIAL_PORTFOLIO_VALUE.mul(2)); // 200%
            await fusioFantasyGame.updatePortfolioValue(user2PortfolioId, INITIAL_PORTFOLIO_VALUE.mul(3)); // 300%

            // Move time to game end
            await time.increase(86401);

            // Get prize pool before distribution
            const oldGame = await fusioFantasyGame.games(gameId);
            const prizePool = oldGame.totalPrizePool;

            // Distribute rewards
            await fusioFantasyGame.distributeRewardsAndEndGame(gameId);

            // Create new game
            const currentTime = await time.latest();
            await fusioFantasyGame.createGame(currentTime, currentTime + 86400, 0);
            const newGameId = await fusioFantasyGame.currentGameIds(0);

            // Verify prize pool rolled over
            const newGame = await fusioFantasyGame.games(newGameId);
            expect(newGame.totalPrizePool).to.equal(prizePool);

            // Verify no rewards distributed
            const user1Balance = await fusioFantasyGame.userBalances(user1.address);
            const user2Balance = await fusioFantasyGame.userBalances(user2.address);
            expect(user1Balance).to.equal(0);
            expect(user2Balance).to.equal(0);
        });

        it("Should not allow reward distribution before game ends", async function () {
            await expect(
                fusioFantasyGame.distributeRewardsAndEndGame(gameId)
            ).to.be.revertedWith("Game not ended yet");
        });

        it("Should not allow reward distribution for non-existent game", async function () {
            const invalidGameId = 999;
            await expect(
                fusioFantasyGame.distributeRewardsAndEndGame(invalidGameId)
            ).to.be.revertedWith("Game not active");
        });
    });
});
