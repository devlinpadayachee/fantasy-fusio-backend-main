# Functional Requirements for Fusio Fantasy Game

1. User Authentication & Profile Management
* Authentication: The system must allow users to authenticate by connecting their wallet. The authentication process must involve signature verification to ensure that only authorized users can access their profile.
* Profile Management: Users must have the ability to view and update their profiles, including their username and profile image.

2. Game Management
* Game Initialization: The system must automatically initialize a new game every week, specifically on Mondays at 03:00 UTC. 
* Game State Tracking: The system must track the current state of the game (e.g., active, inactive).
* Historical Game Results: Users should be able to view current game results, including performance metrics and rankings, to gauge historical performance.

3. Portfolio Management
* Portfolio Creation: Users must be able to create a portfolio by selecting exactly 8 assets, with predefined allocations for each asset. User have lock funds in livegamefunds of smart contract,Once the portfolio is created, it should be locked and no further modifications can be made after the game starts.
* Portfolio Locking: At the start of each game, user portfolios must be locked to prevent further changes. The locking process includes the deduction of entry fees in USDC from the user’s wallet to game pool.
* Portfolio Comparison: Users should be able to compare their portfolio's performance against the AI-generated portfolio ("Ape"). This comparison will help users gauge their performance in the game.

4. Leaderboard & Performance Tracking
* Live Performance Tracking: The system must track the performance of portfolios in real-time based on live asset prices from external sources (e.g., CryptoCompare for DeFi assets, Alpha Vantage for TradFi assets).
* Current Game Performance Updates: The leaderboard must be updated frequently (every 5-10 minutes) to reflect the current ranking of portfolios based on their performance relative to the market.
* Ranking Based on Performance: Portfolios should be ranked based on their performance against both the AI-generated portfolio and the real-world market performance.

5. Transaction & Reward Handling
* Entry Fee: Users must pay an entry fee (in USDC) to participate in the game. This fee must be deducted from the user's wallet at the time of portfolio creation.
* Reward Distribution: At the end of each game, users who outperform the AI-generated portfolio must be rewarded. The system must handle the distribution of rewards based on performance.
* Withdrawals: Users must be able to withdraw their winnings at any time after the game concludes. The withdrawal process must be secure and ensure that funds are transferred appropriately.

6. Smart Contract Functionalities
* User have lock funds in livegamefunds of smart contract
* Portfolio Management: The smart contract must manage the locking of portfolios and ensure that users follow the required 8-asset structure.
* Winner Calculation: The smart contract must calculate the winner at the end of each game by comparing user portfolios against the AI-generated portfolio. This involves fetching the real-time portfolio values and determining the highest-performing portfolios.
* Transaction Handling: The smart contract must handle transactions such as entry fee deductions, reward distribution, and withdrawals. It should ensure that all transactions are processed securely and efficiently.
* Reward Distribution: At the end of each game, users who outperform the AI-generated portfolio must be rewarded. The system must handle the distribution of rewards based on performance. Reward should be distribute to all winners equally.
* Withdrawals: Users must be able to withdraw their winnings at any time after the game concludes. The withdrawal process must be secure and ensure that funds are transferred appropriately.

7. Automated Processes & Cron Jobs
* Game Lifecycle Automation: The system must automatically handle critical game processes through Cron jobs, including the initialization of new games, locking of portfolios, leaderboard updates, and reward distribution.
* Automated Leaderboard Updates: The leaderboard must update at regular intervals (every 5-10 minutes) based on the latest asset prices and portfolio performances.
* Automated Price Updates
