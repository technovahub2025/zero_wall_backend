const mongoose = require('mongoose');

const TimerLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },
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
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    pausedAt: {
      type: Date,
    },
    duration: {
      type: Number,
      default: 0,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    date: {
      type: Date,
      default: () => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        return date;
      },
    },
    isManual: {
      type: Boolean,
      default: false,
    },
    isBillable: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    switchReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    switchFromLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TimerLog',
    },
    switchFromTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },
    switchToTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },
  },
  { timestamps: true },
);

TimerLogSchema.index({ user: 1, date: -1 });
TimerLogSchema.index({ user: 1, project: 1, date: -1 });
TimerLogSchema.index({ user: 1, task: 1, date: -1 });
TimerLogSchema.index({ user: 1, isManual: 1, date: -1 });
TimerLogSchema.index({ user: 1, isBillable: 1, date: -1 });
TimerLogSchema.index({ project: 1, createdAt: -1 });
TimerLogSchema.index({ task: 1, createdAt: -1 });
TimerLogSchema.index({ user: 1, isActive: 1 });

TimerLogSchema.pre('save', function computeDuration() {
  if (this.endTime && this.startTime) {
    this.duration = Math.max(0, Math.floor((this.endTime.getTime() - this.startTime.getTime()) / 1000));
  }
});

TimerLogSchema.statics.formatDuration = function formatDuration(seconds = 0) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const TimerLog = mongoose.model('TimerLog', TimerLogSchema);

module.exports = TimerLog;
module.exports.formatDuration = TimerLogSchema.statics.formatDuration;
