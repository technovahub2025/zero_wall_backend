const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, trim: true },
    resource: { type: String, required: true, trim: true },
    resourceId: { type: String, default: null, trim: true },
    ip: { type: String, default: null, trim: true },
    userAgent: { type: String, default: null, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } },
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
