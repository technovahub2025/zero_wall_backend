const { logUploadAttempt } = require('./auditLog');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function requireUploadContentType(req, res, next) {
  if (!req.headers['content-type']) {
    logUploadAttempt({
      req,
      outcome: 'rejected',
      reason: 'Missing Content-Type header',
    });
    return res.status(400).json({
      success: false,
      message: 'Content-Type header is required',
    });
  }

  return next();
}

function rejectUnsupportedUploadType(req, res, next) {
  if (req.file && !ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    logUploadAttempt({
      req,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      outcome: 'rejected',
      reason: 'Unsupported MIME type',
    });
    return res.status(400).json({
      success: false,
      message: 'File type not allowed',
    });
  }

  return next();
}

module.exports = {
  ALLOWED_MIME_TYPES,
  requireUploadContentType,
  rejectUnsupportedUploadType,
};
