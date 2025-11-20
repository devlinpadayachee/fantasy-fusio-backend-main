const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const {
    createGameCron,
    getGameCrons,
    getAllGameCrons,
    getGameCron,
    updateGameCron,
    deleteGameCron,
    restoreGameCron
} = require('../controllers/game-cron.controller');

// Protect all routes with admin authentication
router.use(isAdmin);

router.route('/')
    .post(createGameCron)
    .get(getGameCrons);

router.get('/all', getAllGameCrons);

router.route('/:id')
    .get(getGameCron)
    .put(updateGameCron)
    .delete(deleteGameCron);

router.post('/:id/restore', restoreGameCron);

module.exports = router;
