const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    assignee: { type: String, required: true, trim: true },
    backupReviewer: { type: String, default: '', trim: true },
    dueDate: { type: String, required: true },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'review', 'blocked', 'done'],
      default: 'pending',
    },
    stage: { type: String, default: '', trim: true },
  },
  { _id: true },
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    client: { type: String, required: true, trim: true, index: true },
    type: { type: String, required: true, trim: true },
    typeShort: { type: String, default: '' },
    location: { type: String, required: true, trim: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    value: { type: Number, required: true },
    status: {
      type: String,
      enum: ['progress', 'done', 'hold', 'cancelled'],
      default: 'progress',
      index: true,
    },
    stage: { type: String, required: true },
    completion: { type: Number, default: 0, min: 0, max: 100 },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
      index: true,
    },
    engineer: { type: String, required: true, trim: true },
    approval: { type: String, default: 'Pending' },
    billing: { type: String, default: '' },
    recv: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    tasks: [taskSchema],
    stageHistory: [
      {
        stageNo: String,
        stageName: String,
        start: Date,
        endPlan: Date,
        endActual: String,
        status: String,
        deliverable: String,
        approval: String,
        next: String,
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model('Project', projectSchema);
