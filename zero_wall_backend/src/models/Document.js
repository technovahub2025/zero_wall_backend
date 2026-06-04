const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
    },
    stage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Stage',
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    cloudinaryUrl: {
      type: String,
      required: true,
      trim: true,
    },
    publicId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true,
    },
    fileType: {
      type: String,
      enum: ['image', 'pdf', 'word', 'excel', 'other'],
      default: 'other',
    },
    mimeType: {
      type: String,
      default: '',
    },
    size: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      enum: ['drawing', 'report', 'approval', 'resume', 'id', 'certificate', 'other'],
      default: 'other',
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

DocumentSchema.index({ project: 1, createdAt: -1 });
DocumentSchema.index({ employee: 1, createdAt: -1 });
DocumentSchema.index({ uploadedBy: 1, createdAt: -1 });

function getFileType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word')) return 'word';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'excel';
  return 'other';
}

const Document = mongoose.model('Document', DocumentSchema);

module.exports = Document;
module.exports.getFileType = getFileType;
