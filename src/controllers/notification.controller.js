const { asyncHandler } = require('../middleware/error');
const Notification = require('../models/Notification');

// Get all notifications for a user
const getUserNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id })
    .sort({ createdAt: -1 }); // Sort by newest first

  res.json({
    notifications,
    total: notifications.length
  });
});

// Get count of unread notifications
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({
    userId: req.user._id,
    read: false
  });

  res.json({ unreadCount: count });
});

// Mark notification as read
const markAsRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;

  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId: req.user._id },
    { read: true },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  res.json(notification);
});

// Mark all notifications as read
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, read: false },
    { read: true }
  );

  res.json({ message: 'All notifications marked as read' });
});

module.exports = {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead
};
