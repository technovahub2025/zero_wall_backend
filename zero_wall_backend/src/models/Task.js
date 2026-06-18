const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: 200,
      index: true,
    },
    description: { type: String, trim: true, default: '' },
    startDate: { type: Date },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    stage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Stage',
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      index: true,
    },
    assignedTeam: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    backupReviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    priority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low'],
      default: 'Medium',
      index: true,
    },
    status: {
      type: String,
      default: 'todo',
      index: true,
    },
    dueDate: { type: Date, required: [true, 'Due date is required'], index: true },
    completedAt: { type: Date },
    estimatedDurationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    timerStartedAt: { type: Date },
    timerPausedAt: { type: Date },
    timerExpiresAt: { type: Date, index: true },
    timerStatus: {
      type: String,
      enum: ['not_started', 'running', 'paused', 'expired', 'extended', 'completed'],
      default: 'not_started',
      index: true,
    },
    extraTimeMinutesGranted: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeTimerLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TimerLog',
    },
    lastPausedTimerLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TimerLog',
    },
    nextAction: { type: String, trim: true, default: '' },
    tags: [{ type: String, trim: true }],
    attachments: [
      {
        name: String,
        url: String,
        publicId: String,
        uploadedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        text: { type: String, trim: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    order: { type: Number, default: 0, index: true },
    totalTimeLogged: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

taskSchema.index({ title: 'text', description: 'text' });

taskSchema.pre('save', function syncCompletedAt() {
  if (this.status === 'done' && !this.completedAt) {
    this.completedAt = new Date();
  }

  if (this.status !== 'done') {
    this.completedAt = undefined;
  }
});

module.exports = mongoose.model('Task', taskSchema);
