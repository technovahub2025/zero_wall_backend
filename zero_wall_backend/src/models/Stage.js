const mongoose = require('mongoose');

const stageSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    stageNo: {
      type: String,
      enum: [
        'Stage 1',
        'Stage 2',
        'Stage 3',
        'Stage 4',
        'Stage 5',
        'Stage 6',
        'Stage 7',
        'Stage 8',
        'Stage 9',
        'Stage 10',
        'Stage 11',
      ],
      required: true,
    },
    stageName: {
      type: String,
      enum: [
        'Concept Design',
        'Scheme Design',
        'Preliminary Design',
        'Structural Design',
        'Working Drawings',
        'Detailed Engineering',
        'GFC Drawings',
        'Shop Drawings',
        'Site Supervision',
        'As-Built Drawings',
        'Project Handover',
        'Panel Schedule & Drawings',
        'Load Schedule & SLD',
      ],
      required: true,
    },
    stageDescription: { type: String, trim: true, default: '' },
    stageStart: { type: Date },
    stageEndPlanned: { type: Date },
    stageEndActual: { type: Date },
    stageStatus: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Completed', 'On Hold'],
      default: 'Not Started',
      index: true,
    },
    deliverable: { type: String, trim: true, default: '' },
    submittedToClientOn: { type: Date },
    clientApprovalStatus: {
      type: String,
      enum: ['Approved', 'Pending', 'Not Submitted', 'In Review', ''],
      default: 'Not Submitted',
    },
    clientApprovalDate: { type: Date },
    clientComments: { type: String, trim: true, default: '' },
    nextAction: { type: String, trim: true, default: '' },
    completionPct: { type: Number, min: 0, max: 100, default: 0 },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

stageSchema.index({ project: 1, stageNo: 1 });

module.exports = mongoose.model('Stage', stageSchema);
