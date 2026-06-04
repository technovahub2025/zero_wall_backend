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
      enum: ['todo', 'in-progress', 'review', 'done'],
      default: 'todo',
      index: true,
    },
    dueDate: { type: Date, index: true },
    completedAt: { type: Date },
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
