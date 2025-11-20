const { asyncHandler } = require('../middleware/error');
const GameCron = require('../models/GameCron');

// Helper function to validate winCondition config based on type
function validateWinCondition(winCondition) {
    if (!winCondition || !winCondition.type) {
        return { valid: false, message: 'winCondition.type is required' };
    }
    if (winCondition.config === undefined || winCondition.config === null) {
        return { valid: false, message: 'winCondition.config is required' };
    }
    switch (winCondition.type) {
        case 'MARLOWE_BAINES':
            if (Object.keys(winCondition.config).length !== 0) {
                return { valid: false, message: 'winCondition.config must be empty object for MARLOWE_BAINES' };
            }
            break;
        case 'EQUAL_DISTRIBUTE':
            if (
                typeof winCondition.config.topWinnersPercentage !== 'number' ||
                winCondition.config.topWinnersPercentage <= 0 ||
                typeof winCondition.config.rewardPercentage !== 'number' ||
                winCondition.config.rewardPercentage <= 0 ||
                winCondition.config.rewardPercentage > 100
            ) {
                return { valid: false, message: 'Invalid config for EQUAL_DISTRIBUTE winCondition' };
            }
            break;
        case 'TIERED':
            if (
                !Array.isArray(winCondition.config.tiers) ||
                winCondition.config.tiers.length === 0 ||
                !winCondition.config.tiers.every(tier =>
                    typeof tier.position === 'number' && tier.position > 0 &&
                    typeof tier.rewardPercentage === 'number' && tier.rewardPercentage >= 0 && tier.rewardPercentage <= 100
                ) ||
                winCondition.config.tiers.reduce((sum, tier) => sum + tier.rewardPercentage, 0) > 100
            ) {
                return { valid: false, message: 'Invalid tiers config for TIERED winCondition' };
            }
            break;
        default:
            return { valid: false, message: 'Invalid winCondition.type' };
    }
    return { valid: true };
}

// @desc    Create a new game cron
// @route   POST /api/game-cron
// @access  Admin
exports.createGameCron = asyncHandler(async (req, res) => {
  if (!req.body.creationTime) {
    req.body.creationTime = new Date();
  } else {
    const creationTime = new Date(req.body.creationTime);
    if (isNaN(creationTime.getTime())) {
      res.status(400);
      throw new Error('Invalid creationTime format. Please use ISO 8601 format (e.g., 2025-08-18T16:37:00.000Z)');
    }
    
    // Check if creationTime is more than 1 hour in the past
    const now = new Date();
    const oneHourInMs = 60 * 60 * 1000; // 1 hour in milliseconds
    const timeDifference = creationTime.getTime() - now.getTime();

    if (timeDifference < -oneHourInMs) {
      res.status(400);
      throw new Error('Creation time cannot be more than 1 hour in the past');
    }
    
    req.body.creationTime = creationTime;
  }

  req.body.nextExecution = req.body.creationTime;

  // Trim customGameName if provided
  if (req.body.customGameName && typeof req.body.customGameName === "string") {
    req.body.customGameName = req.body.customGameName.trim();
  }

  if (
    req.body.winCondition &&
    req.body.winCondition.type === "EQUAL_DISTRIBUTE" &&
    req.body.winCondition.config
  ) {
    if (typeof req.body.winCondition.config.topWinnersPercentage === "string") {
      req.body.winCondition.config.topWinnersPercentage = Number(
        req.body.winCondition.config.topWinnersPercentage
      );
    }
    if (typeof req.body.winCondition.config.rewardPercentage === "string") {
      req.body.winCondition.config.rewardPercentage = Number(
        req.body.winCondition.config.rewardPercentage
      );
    }
  }

  // Validate winCondition
  const validation = validateWinCondition(req.body.winCondition);
  if (!validation.valid) {
    res.status(400);
    throw new Error(`Invalid winCondition: ${validation.message}`);
  }

  const gameCron = await GameCron.create(req.body);
  res.status(201).json(gameCron);
});

// @desc    Get all game crons (excluding soft deleted)
// @route   GET /api/game-cron
// @access  Admin
exports.getGameCrons = asyncHandler(async (req, res) => {
    const gameCrons = await GameCron.find();
    res.json(gameCrons);
});

// @desc    Get all game crons (including soft deleted)
// @route   GET /api/game-cron/all
// @access  Admin
exports.getAllGameCrons = asyncHandler(async (req, res) => {
    const gameCrons = await GameCron.find({}).where({});
    res.json(gameCrons);
});

// @desc    Get a single game cron
// @route   GET /api/game-cron/:id
// @access  Admin
exports.getGameCron = asyncHandler(async (req, res) => {
    const gameCron = await GameCron.findById(req.params.id);
    if (!gameCron) {
        res.status(404);
        throw new Error('Game cron not found');
    }
    res.json(gameCron);
});

// @desc    Update a game cron
// @route   PUT /api/game-cron/:id
// @access  Admin
exports.updateGameCron = asyncHandler(async (req, res) => {
    const gameCron = await GameCron.findById(req.params.id);
    if (!gameCron) {
        res.status(404);
        throw new Error('Game cron not found');
    }

    const updatedGameCron = await GameCron.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
    );

    res.json(updatedGameCron);
});

// @desc    Soft delete a game cron
// @route   DELETE /api/game-cron/:id
// @access  Admin
exports.deleteGameCron = asyncHandler(async (req, res) => {
    const gameCron = await GameCron.findById(req.params.id);
    if (!gameCron) {
        res.status(404);
        throw new Error('Game cron not found');
    }

    await gameCron.softDelete();
    res.json({ message: 'Game cron deleted' });
});

// @desc    Restore a soft deleted game cron
// @route   POST /api/game-cron/:id/restore
// @access  Admin
exports.restoreGameCron = asyncHandler(async (req, res) => {
    const gameCron = await GameCron.findOne({ _id: req.params.id }).where({});
    if (!gameCron) {
        res.status(404);
        throw new Error('Game cron not found');
    }

    await gameCron.restore();
    res.json(gameCron);
});
