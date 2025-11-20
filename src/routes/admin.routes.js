const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');

// Single route for admin login/creation
router.post('/login', adminController.loginOrCreate);

module.exports = router;
