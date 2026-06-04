const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitToAdmin, emitToUser } = require('../config/socket');

async function createNotification({ recipient, sender, type, title, message, link, metadata = {} }) {
  if (!recipient) return null;

  const notif = await Notification.create({
    recipient,
    sender,
    type,
    title,
    message,
    link,
    metadata,
  });

  const populated = await Notification.findById(notif._id).populate('sender', 'name avatar role employeeId');
  emitToUser(String(recipient), 'notification:new', populated);
  return populated;
}

async function notifyAdmins({ sender, type, title, message, link, metadata = {} }) {
  const admins = await User.find({
    role: { $in: ['superadmin', 'admin'] },
    isActive: true,
    _id: { $ne: sender },
  }).select('_id');

  const results = await Promise.all(
    admins.map((admin) =>
      createNotification({
        recipient: admin._id,
        sender,
        type,
        title,
        message,
        link,
        metadata,
      }),
    ),
  );

  emitToAdmin('notification:admin', { type, title, message, metadata });
  return results.filter(Boolean);
}

module.exports = {
  createNotification,
  notifyAdmins,
};
