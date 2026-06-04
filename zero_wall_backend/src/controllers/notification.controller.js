const asyncHandler = require('../utils/asyncHandler');
const Notification = require('../models/Notification');

function serializeNotification(notification) {
  const item = notification.toObject ? notification.toObject({ virtuals: true }) : notification;
  return {
    id: item._id,
    recipient: item.recipient,
    sender: item.sender,
    type: item.type,
    title: item.title,
    message: item.message,
    link: item.link || '',
    isRead: item.isRead,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

const listNotifications = asyncHandler(async (req, res) => {
  const filter = { recipient: req.user.id };
  const type = String(req.query.type || '').trim();
  const unreadOnly = req.query.unread === 'true';

  if (type && type !== 'all') {
    const map = {
      tasks: ['task_assigned', 'task_status_changed', 'task_overdue', 'task_due_soon'],
      stages: ['stage_approved', 'stage_rejected', 'stage_submitted'],
      billing: ['billing_updated'],
      all: [],
    };
    if (map[type]?.length) filter.type = { $in: map[type] };
  }
  if (unreadOnly) filter.isRead = false;

  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .populate('sender', 'name avatar role employeeId');

  const unreadCount = await Notification.countDocuments({ recipient: req.user.id, isRead: false });
  return res.json({
    success: true,
    data: {
      notifications: notifications.map(serializeNotification),
      unreadCount,
    },
  });
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({ recipient: req.user.id, isRead: false });
  return res.json({ success: true, data: { unreadCount } });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user.id },
    { $set: { isRead: true } },
    { new: true },
  ).populate('sender', 'name avatar role employeeId');

  if (!notification) {
    return res.status(404).json({ success: false, message: 'Notification not found' });
  }

  return res.json({ success: true, data: serializeNotification(notification) });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.id, isRead: false }, { $set: { isRead: true } });
  return res.json({ success: true, message: 'All notifications marked as read' });
});

const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user.id,
  });

  if (!notification) {
    return res.status(404).json({ success: false, message: 'Notification not found' });
  }

  return res.json({ success: true, message: 'Notification deleted' });
});

module.exports = {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  serializeNotification,
};
