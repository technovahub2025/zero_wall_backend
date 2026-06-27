const AuditLog = require('../models/AuditLog');
const UploadAudit = require('../models/UploadAudit');

async function logAuditEvent({ userId = null, action, resource, resourceId = null, req = null, metadata = {} }) {
  try {
    await AuditLog.create({
      userId: userId || req?.user?.id || null,
      action,
      resource,
      resourceId: resourceId ? String(resourceId) : null,
      ip: req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
      metadata,
    });
  } catch (error) {
    // Never block the primary request path on audit failures.
  }
}

async function logUploadAttempt({ userId = null, filename = null, mimeType = null, size = null, req = null, outcome = 'attempt', reason = null }) {
  try {
    await UploadAudit.create({
      userId: userId || req?.user?.id || null,
      filename,
      mimeType,
      size,
      ip: req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || null,
      userAgent: req?.headers?.['user-agent'] || null,
      outcome,
      reason,
    });
  } catch (error) {
    // Never block uploads on audit failures.
  }
}

module.exports = {
  logAuditEvent,
  logUploadAttempt,
};
