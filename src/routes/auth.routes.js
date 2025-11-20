const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Public routes
router.post('/nonce', authController.getNonce);
router.post('/verify', authController.verifySignature);
router.get('/username/check', authController.checkUsername);

// Protected routes (require authentication)
router.use(authenticate);
router.get('/profile', authController.getProfile);
router.post('/profile', upload.single('profileImage'), authController.updateProfile);
router.get('/transactions', authController.getTransactionHistory);

module.exports = router;
