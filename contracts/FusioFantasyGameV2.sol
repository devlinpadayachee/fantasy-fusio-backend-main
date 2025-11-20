// SPDX-License-Identifier: MIT

pragma solidity ^0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title FusioFantasyGame - A fantasy game contract with entry fees, portfolios, and rewards
/// @author
/// @notice This contract manages games, portfolios, rewards, and admin fees using USDC token
/// @dev Uses OpenZeppelin AccessControl, ReentrancyGuard, SafeERC20, and ECDSA for security and token handling
contract FusioFantasyGameV2 is Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    /// @notice Authorizes contract upgrades
    /// @param newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    using ECDSAUpgradeable for bytes32;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // Roles
    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");

    IERC20Upgradeable public usdcToken;
    uint256 public nonce;

    // Admin fee settings
    uint256 public constant MAX_ADMIN_FEE_PERCENTAGE = 10;
    uint256 public adminFeePercentage;
    address public adminWallet;

    // Game status enum
    enum GameStatus { NONE, ACTIVE, COMPLETED }

    // Structs
    struct Game {
        uint256 startTime;
        uint256 endTime;
        uint256 totalPrizePool;
        uint256 totalRewardDistributed;
        uint256 entryFee;
        uint256 entryCap;
        uint256 entryCount;
        GameStatus status;
    }

    // Mappings
    mapping(uint256 => Game) public games;                    // gameId => Game
    mapping(uint256 => address) public portfolioOwner;         // portfolioId => owner
    mapping(uint256 => uint256) public portfolioGameId;        // portfolioId => gameId
    mapping(uint256 => bool) public rewardAssigned;            // portfolioId => rewardAssigned
    mapping(address => uint256) public userBalance;            // user => balance

    // Events
    event GameCreated(uint256 indexed gameId, uint256 startTime, uint256 endTime, uint256 entryFee, uint256 entryCap);
    event GameStatusUpdated(uint256 indexed gameId, GameStatus status);
    event PortfolioCreated(uint256 indexed gameId, uint256 indexed portfolioId,uint256 entryCount,uint256 prizePool, address indexed owner);
    event PortfolioEntryFeePaid(uint256 indexed portfolioId, address indexed payer, uint256 entryFee, uint256 adminFee);
    event RewardAssigned(uint256 indexed portfolioId, address indexed owner, uint256 amount);
    event BatchRewardAssigned(uint256[] portfolioIds, uint256[] amounts);
    event BalanceWithdrawn(address indexed user, uint256 amount);
    event AdminFeeTransferred(address indexed user, uint256 adminFee);
    event AdminFeePercentageUpdated(uint256 newPercentage);
    event AdminWalletUpdated(address newWallet);
    event AdminAddedToPrizePool(uint256 indexed gameId, uint256 amount);
    event AdminWithdrawFromPrizePool(uint256 indexed gameId, uint256 amount);

    /// @notice Initializer to replace constructor for upgradeable contract
    /// @param _usdcToken Address of the USDC token contract
    /// @param _adminWallet Address of the admin wallet to receive fees
    /// @param _gameManagerWallet Address of the game manager wallet to manage games
    function initialize(address _usdcToken, address _adminWallet, address _gameManagerWallet) public initializer {
        require(_usdcToken != address(0), "Invalid USDC token address");
        require(_adminWallet != address(0), "Invalid admin wallet address");
        require(_gameManagerWallet != address(0), "Invalid game manager wallet address");
        usdcToken = IERC20Upgradeable(_usdcToken);
        adminWallet = _adminWallet;

        adminFeePercentage = 10; // default 10%

        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _adminWallet);
        _grantRole(GAME_MANAGER_ROLE, _gameManagerWallet);
    }

    /// @notice Creates a new game with specified parameters
    /// @param gameId Unique identifier for the game
    /// @param startTime Timestamp when the game starts
    /// @param endTime Timestamp when the game ends
    /// @param entryFee Entry fee amount in USDC
    /// @param entryCap Maximum number of portfolios allowed
    function createGame(
        uint256 gameId,
        uint256 startTime,
        uint256 endTime,
        uint256 entryFee,
        uint256 entryCap
    ) external onlyRole(GAME_MANAGER_ROLE) {
        require(games[gameId].startTime == 0, "Game already exists");
        require(startTime > block.timestamp, "Invalid start time");
        require(endTime > startTime, "Invalid end time");
        require(entryFee > 0, "Invalid entry fee");
        require(entryCap > 0, "Invalid entry cap");

        games[gameId] = Game({
            startTime: startTime,
            endTime: endTime,
            totalPrizePool: 0,
            totalRewardDistributed: 0,
            entryFee: entryFee,
            entryCap: entryCap,
            entryCount: 0,
            status: GameStatus.ACTIVE
        });

        emit GameCreated(gameId, startTime, endTime, entryFee, entryCap);
    }

    /// @notice Updates the status of a game to COMPLETED after it ends
    /// @param gameId Unique identifier for the game
    function updateGameStatus(uint256 gameId) external onlyRole(GAME_MANAGER_ROLE) {
        Game storage game = games[gameId];
        require(game.startTime > 0, "Game does not exist");
        require(block.timestamp > game.endTime, "Game not ended yet");
        require(game.totalRewardDistributed == game.totalPrizePool, "All rewards must be distributed before completing the game");
        game.status = GameStatus.COMPLETED;
        emit GameStatusUpdated(gameId, GameStatus.COMPLETED);
    }

    /// @notice Creates a portfolio for a game by paying the entry fee
    /// @param gameId Unique identifier for the game
    /// @param portfolioId Unique identifier for the portfolio
    function createPortfolio(uint256 gameId, uint256 portfolioId) external nonReentrant {
        _validatePortfolioId(portfolioId);
        Game storage game = games[gameId];
        require(game.startTime > 0, "Game does not exist");
        require(block.timestamp < game.startTime, "Game already started");
        require(portfolioOwner[portfolioId] == address(0), "Portfolio ID already exists");
        require(game.entryCount < game.entryCap, "Entry cap reached for this game");

        uint256 adminFee = _handleEntryFeePayment(game.entryFee);

        // Create portfolio using mappings
        portfolioOwner[portfolioId] = msg.sender;
        portfolioGameId[portfolioId] = gameId;
        rewardAssigned[portfolioId] = false;

        // Increment entry count for the game
        game.entryCount += 1;

        // Update game prize pool (only the portion after admin fee)
        uint256 prizePoolContribution = game.entryFee - adminFee;
        game.totalPrizePool += prizePoolContribution;

        emit PortfolioCreated(gameId, portfolioId, game.entryCount, game.totalPrizePool, msg.sender);
        emit PortfolioEntryFeePaid(portfolioId, msg.sender, game.entryFee, adminFee);
        emit AdminFeeTransferred(msg.sender, adminFee);
    }

    /// @notice Returns the required USDC approval amount for a user to join a game
    /// @param gameId Unique identifier for the game
    /// @return The amount of USDC approval required
    function getRequiredUSDCApproval(address user,uint256 gameId) external view returns (uint256) {
        Game storage game = games[gameId];
        require(game.startTime > 0, "Game does not exist");

        uint256 userBal = userBalance[user];
        uint256 requiredAmount = game.entryFee;

        if (userBal >= requiredAmount) {
            return 0;
        }

        uint256 remainingAmount = requiredAmount - userBal;
        uint256 currentAllowance = usdcToken.allowance(user, address(this));

        return currentAllowance >= remainingAmount ? 0 : remainingAmount - currentAllowance;
    }

    /// @notice Assigns a reward to a portfolio after verifying signature
    /// @param portfolioId Unique identifier for the portfolio
    /// @param amount Reward amount to assign
    /// @param signature Signature from admin authorizing the reward
    function assignReward(
        uint256 portfolioId,
        uint256 amount,
        bytes calldata signature
    ) external onlyRole(GAME_MANAGER_ROLE) {
        require(amount > 0, "Zero amount");
        _validatePortfolioId(portfolioId);
        address owner = portfolioOwner[portfolioId];
        uint256 gameId = portfolioGameId[portfolioId];
        Game storage game = games[gameId];

        require(owner != address(0), "Portfolio does not exist");
        require(!rewardAssigned[portfolioId], "Reward already assigned");
        require(game.status != GameStatus.COMPLETED, "Game already completed");
        require(block.timestamp > game.endTime, "Game not ended yet");
        require(amount <= game.totalPrizePool - game.totalRewardDistributed, "Insufficient prize pool");

        // Verify signature using EIP-712 style domain separator and typed data hash
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            keccak256("AssignReward(uint256 portfolioId,uint256 amount,uint256 nonce)"),
            portfolioId,
            amount,
            nonce
        )));
        address signer = digest.recover(signature);
        require(hasRole(GAME_MANAGER_ROLE, signer), "Invalid signature");
        unchecked { nonce++; }

        rewardAssigned[portfolioId] = true;
        userBalance[owner] += amount;
        game.totalRewardDistributed += amount;
        emit RewardAssigned(portfolioId, owner, amount);
    }

    /// @notice Assigns rewards to multiple portfolios in a batch for gas efficiency
    /// @param portfolioIds Array of portfolio IDs
    /// @param amounts Array of reward amounts corresponding to portfolio IDs
    function batchAssignRewards(
        uint256[] calldata portfolioIds,
        uint256[] calldata amounts,
        bytes calldata signature
    ) external onlyRole(GAME_MANAGER_ROLE) {
        uint256 portfolioslength = portfolioIds.length;
        require(portfolioslength == amounts.length, "Mismatched input lengths");

        // Verify signature using EIP-712 style domain separator and typed data hash
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            keccak256("BatchAssignRewards(uint256[] portfolioIds,uint256[] amounts,uint256 nonce)"),
            keccak256(abi.encodePacked(portfolioIds)),
            keccak256(abi.encodePacked(amounts)),
            nonce
        )));
        address signer = digest.recover(signature);
        require(hasRole(GAME_MANAGER_ROLE, signer), "Invalid signature");
        unchecked { nonce++; }

        for (uint256 i = 0; i < portfolioslength; i++) {
            uint256 portfolioId = portfolioIds[i];
            uint256 amount = amounts[i];
            require(amount > 0, "Zero amount");
            address owner = portfolioOwner[portfolioId];
            uint256 gameId = portfolioGameId[portfolioId];
            Game storage game = games[gameId];

            require(owner != address(0), "Portfolio does not exist");
            require(!rewardAssigned[portfolioId], "Reward already assigned");
            require(game.status != GameStatus.COMPLETED, "Game already completed");
            require(block.timestamp > game.endTime, "Game not ended yet");
            require(amount <= game.totalPrizePool - game.totalRewardDistributed, "Insufficient prize pool");

            rewardAssigned[portfolioId] = true;
            userBalance[owner] += amount;
            game.totalRewardDistributed += amount;
        }

        emit BatchRewardAssigned(portfolioIds, amounts);
    }

    /// @notice Allows admin to add USDC to a specific game's totalPrizePool
    /// @param gameId The ID of the game to add prize pool to
    /// @param amount The amount of USDC to add
    function adminAddToPrizePool(uint256 gameId, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        Game storage game = games[gameId];
        require(game.startTime > 0, "Game does not exist");

        // Transfer USDC from admin to contract
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);

        // Increase the game's totalPrizePool
        game.totalPrizePool += amount;

        emit AdminAddedToPrizePool(gameId, amount);
    }

    /// @notice Withdraws a specified amount from the user's balance
    /// @param amount Amount to withdraw
    function withdrawBalance(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(userBalance[msg.sender] >= amount, "Insufficient balance");

        userBalance[msg.sender] -= amount;
        usdcToken.safeTransfer(msg.sender, amount);

        emit BalanceWithdrawn(msg.sender, amount);
    }

    /// @notice Returns the balance of a user
    /// @param user Address of the user
    /// @return The balance of the user
    function getUserBalance(address user) external view returns (uint256) {
        return userBalance[user];
    }

    /// @notice Returns the owner of a portfolio
    /// @param portfolioId Unique identifier for the portfolio
    /// @return Address of the portfolio owner
    function getPortfolioOwner(uint256 portfolioId) external view returns (address) {
        return portfolioOwner[portfolioId];
    }

    /// @notice Returns the game ID associated with a portfolio
    /// @param portfolioId Unique identifier for the portfolio
    /// @return Game ID
    function getPortfolioGameId(uint256 portfolioId) external view returns (uint256) {
        return portfolioGameId[portfolioId];
    }

    /// @notice Checks if a reward has been assigned to a portfolio
    /// @param portfolioId Unique identifier for the portfolio
    /// @return True if reward assigned, false otherwise
    function isRewardAssigned(uint256 portfolioId) external view returns (bool) {
        return rewardAssigned[portfolioId];
    }

    /// @notice Sets the admin fee percentage
    /// @param newPercentage New admin fee percentage (max 50)
    function setAdminFeePercentage(uint256 newPercentage) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPercentage <= MAX_ADMIN_FEE_PERCENTAGE, "Admin fee cannot exceed 10%");
        if (newPercentage != adminFeePercentage) {
            adminFeePercentage = newPercentage;
            emit AdminFeePercentageUpdated(newPercentage);
        }
    }

    /// @notice Sets the admin wallet address
    /// @param newWallet New admin wallet address
    function setAdminWallet(address newWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newWallet != address(0), "Invalid wallet address");
        if (newWallet != adminWallet) {
            adminWallet = newWallet;
            emit AdminWalletUpdated(newWallet);
        }
    }

    /// @notice Allows admin to withdraw USDC tokens from the contract
    /// @param amount Amount of USDC tokens to withdraw
    function adminWithdrawUSDC(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        uint256 contractBalance = usdcToken.balanceOf(address(this));
        require(contractBalance >= amount, "Insufficient contract balance");

        usdcToken.safeTransfer(msg.sender, amount);

        emit BalanceWithdrawn(msg.sender, amount);
    }

    /// @notice Allows admin to withdraw USDC tokens from a specific game's prize pool
    /// @param gameId The ID of the game
    /// @param amount The amount of USDC tokens to subtract
    function adminWithdrawFromPrizePool(uint256 gameId, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        Game storage game = games[gameId];
        require(game.startTime > 0, "Game does not exist");
        require(amount <= game.totalPrizePool - game.totalRewardDistributed, "Amount exceeds available prize pool");

        game.totalPrizePool -= amount;
        usdcToken.safeTransfer(msg.sender, amount);

        emit AdminWithdrawFromPrizePool(gameId, amount);
    }

    /// @notice Returns detailed information about a game
    /// @param gameId Unique identifier for the game
    /// @return startTime Game start time
    /// @return endTime Game end time
    /// @return totalPrizePool Total prize pool amount
    /// @return totalRewardDistributed Total rewards distributed
    function getGameDetails(uint256 gameId) external view returns (
        uint256 startTime,
        uint256 endTime,
        uint256 totalPrizePool,
        uint256 totalRewardDistributed,
        uint256 entryCount
    ) {
        Game storage game = games[gameId];
        return (
            game.startTime,
            game.endTime,
            game.totalPrizePool,
            game.totalRewardDistributed,
            game.entryCount
        );
    }

    /// @dev Internal function to validate portfolio ID
    /// @param portfolioId Portfolio ID to validate
    function _validatePortfolioId(uint256 portfolioId) internal pure {
        require(portfolioId != 0, "Invalid portfolio ID");
    }

    /// @dev Internal function to handle entry fee payment logic
    function _handleEntryFeePayment(uint256 entryFee) internal returns (uint256) {
        uint256 userBal = userBalance[msg.sender];
        uint256 adminFee = (entryFee * adminFeePercentage) / 100;

        if (userBal >= entryFee) {
            userBalance[msg.sender] -= entryFee;
        } else if (userBal > 0) {
            uint256 remainingAmount = entryFee - userBal;
            userBalance[msg.sender] = 0;
            usdcToken.safeTransferFrom(msg.sender, address(this), remainingAmount);
        } else {
            usdcToken.safeTransferFrom(msg.sender, address(this), entryFee);
        }

        usdcToken.safeTransfer(adminWallet, adminFee);
        return adminFee;
    }

        /// @dev EIP-712 domain separator and typed data hash implementation
        /// @param structHash Hash of the struct to sign
        /// @return digest EIP-712 digest to verify signature
        function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
            bytes32 DOMAIN_SEPARATOR = keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256(bytes("FusioFantasyGameV2")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                )
            );
            return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        }
}