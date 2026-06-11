const mongoose = require('mongoose');
const { emitToUser } = require('../config/socket');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: [
        'task_assigned',
        'task_status_changed',
        'task_overdue',
        'task_due_soon',
        'stage_approved',
        'stage_rejected',
        'stage_submitted',
        'project_updated',
        'project_created',
        'comment_added',
        'invite_accepted',
        'timer_reminder',
        'time_extension_requested',
        'time_extension_approved',
        'time_extension_rejected',
        'billing_updated',
        'role_changed',
        'general',
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    link: { type: String, trim: true, default: '' },
    isRead: { type: Boolean, default: false, index: true },
    metadata: {
      projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
      taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
      stageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stage' },
      projectName: { type: String, default: '' },
      taskTitle: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

notificationSchema.statics.createAndEmit = async function createAndEmit(data) {
  const notif = await this.create(data);
  const populated = await this.findById(notif._id).populate('sender', 'name avatar role employeeId');
  emitToUser(String(data.recipient), 'notification:new', populated);
  return populated;
};

module.exports = mongoose.model('Notification', notificationSchema);
