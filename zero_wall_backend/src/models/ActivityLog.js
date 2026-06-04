const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['project', 'stage', 'task', 'invoice', 'notification', 'team', 'timer', 'auth', 'dashboard', 'other'],
      default: 'other',
      index: true,
    },
    entityId: {
      type: String,
      default: '',
      index: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    detail: {
      type: String,
      trim: true,
      default: '',
    },
    tone: {
      type: String,
      enum: ['sky', 'blue', 'emerald', 'amber', 'violet', 'rose', 'slate'],
      default: 'sky',
      index: true,
    },
    link: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

activityLogSchema.index({ project: 1, occurredAt: -1 });
activityLogSchema.index({ entityType: 1, occurredAt: -1 });
activityLogSchema.index({ actor: 1, occurredAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
