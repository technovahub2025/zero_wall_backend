const mongoose = require('mongoose');

const stageLogSchema = new mongoose.Schema(
  {
    proj: { type: String, required: true, trim: true, index: true },
    client: { type: String, required: true, trim: true },
    stageNo: { type: String, required: true },
    stageName: { type: String, required: true },
    start: { type: Date, required: true },
    endPlan: { type: Date, required: true },
    endActual: { type: String, default: '-' },
    status: {
      type: String,
      enum: ['done', 'progress', 'review', 'hold'],
      default: 'progress',
    },
    deliverable: { type: String, required: true },
    approval: { type: String, default: 'Pending' },
    next: { type: String, default: '' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  },
  { timestamps: true },
);

module.exports = mongoose.model('StageLog', stageLogSchema);
