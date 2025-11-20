const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { 
  getUserNotifications, 
  getUnreadCount, 
  markAsRead, 
  markAllAsRead 
} = require('../controllers/notification.controller');

// Get all notifications for authenticated user
router.get('/', authenticate, getUserNotifications);

// Get unread notifications count
router.get('/unread', authenticate, getUnreadCount);

// Mark single notification as read
router.put('/:notificationId/read', authenticate, markAsRead);

// Mark all notifications as read
router.put('/read-all', authenticate, markAllAsRead);

module.exports = router;
