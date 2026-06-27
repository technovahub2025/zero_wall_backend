const mongoose = require('mongoose');

const uploadAuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    filename: { type: String, default: null, trim: true },
    mimeType: { type: String, default: null, trim: true },
    size: { type: Number, default: null },
    ip: { type: String, default: null, trim: true },
    userAgent: { type: String, default: null, trim: true },
    outcome: { type: String, default: 'attempt', trim: true },
    reason: { type: String, default: null, trim: true },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } },
);

module.exports = mongoose.model('UploadAudit', uploadAuditSchema, 'upload_audit');
