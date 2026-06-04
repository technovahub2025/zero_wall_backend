const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const {
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require('../controllers/notification.controller');

const router = express.Router();

router.get('/', requireAuth, listNotifications);
router.get('/unread-count', requireAuth, getUnreadCount);
router.put('/mark-all-read', requireAuth, markAllNotificationsRead);
router.put('/:id/read', requireAuth, markNotificationRead);
router.delete('/:id', requireAuth, deleteNotification);

module.exports = router;
