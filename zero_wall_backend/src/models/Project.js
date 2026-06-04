const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    sNo: { type: Number, index: true },
    projectName: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: 200,
      index: true,
    },
    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true,
      index: true,
    },
    companySegment: {
      type: String,
      enum: ['Residential', 'Commercial', 'Industrial', 'Manufacturing', ''],
      default: '',
      index: true,
    },
    projectType: [
      {
        type: String,
        enum: [
          'Structural',
          'Architectural',
          'Electrical',
          'PEB',
          'Structural + Architectural',
          'Architectural + Electrical',
          'Structural + PEB + Electrical',
          'PEB + Structural',
          'Structural Engineering',
          'Electrical Consulting',
          'PEB Structure',
        ],
      },
    ],
    location: { type: String, trim: true, default: '' },
    startDate: { type: Date },
    targetDate: { type: Date },
    projectValue: { type: Number, default: 0 },
    overallStatus: {
      type: String,
      enum: ['In Progress', 'Completed', 'On Hold', 'Cancelled'],
      default: 'In Progress',
      index: true,
    },
    currentStage: {
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
        'Load Schedule & SLD',
        'Panel Schedule & Drawings',
      ],
      default: 'Concept Design',
    },
    stageCompletion: { type: Number, min: 0, max: 100, default: 0 },
    clientApprovalStatus: {
      type: String,
      enum: ['Approved', 'Pending', 'Not Submitted', 'In Review', ''],
      default: 'Not Submitted',
      index: true,
    },
    clientApprovalDate: { type: Date },
    nextActionRequired: { type: String, trim: true, default: '' },
    responsibleEngineer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedTeam: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    remarks: { type: String, trim: true, default: '' },
    blockers: { type: String, trim: true, default: '' },
    ceoMdReview: {
      type: String,
      enum: ['Reviewed', 'Pending', 'Escalate', 'Scheduled', 'Closed', ''],
      default: '',
    },
    priority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low'],
      default: 'Medium',
      index: true,
    },
    invoiceStatus: { type: String, trim: true, default: '' },
    estimatedCompletion: { type: Number, min: 0, max: 100, default: 0 },
    recv: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    isArchived: { type: Boolean, default: false },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

projectSchema.index({ projectName: 'text', clientName: 'text' });

projectSchema.virtual('taskCount', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'project',
  count: true,
});

projectSchema.virtual('name').get(function name() {
  return this.projectName;
});

projectSchema.virtual('client').get(function client() {
  return this.clientName;
});

projectSchema.virtual('stage').get(function stage() {
  return this.currentStage;
});

projectSchema.virtual('completion').get(function completion() {
  return this.stageCompletion;
});

projectSchema.virtual('approval').get(function approval() {
  return this.clientApprovalStatus;
});

projectSchema.virtual('billing').get(function billing() {
  return this.invoiceStatus;
});

projectSchema.virtual('value').get(function value() {
  return this.projectValue;
});

projectSchema.virtual('start').get(function start() {
  return this.startDate;
});

projectSchema.virtual('end').get(function end() {
  return this.targetDate;
});

projectSchema.virtual('status').get(function status() {
  const map = {
    'In Progress': 'progress',
    Completed: 'done',
    'On Hold': 'hold',
    Cancelled: 'cancelled',
  };

  return map[this.overallStatus] || 'progress';
});

projectSchema.virtual('engineer').get(function engineer() {
  if (this.populated('responsibleEngineer') && this.responsibleEngineer?.name) {
    return this.responsibleEngineer.name;
  }
  return this.responsibleEngineerName || '';
});

module.exports = mongoose.model('Project', projectSchema);
