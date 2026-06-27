const asyncHandler = require('../utils/asyncHandler');
const AuditLog = require('../models/AuditLog');

const listAuditLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '50', 10) || 50));
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const filter = {};

  if (req.query.resource) {
    filter.resource = String(req.query.resource).trim();
  }

  if (req.query.action) {
    filter.action = String(req.query.action).trim();
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name email role'),
    AuditLog.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: items,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

module.exports = {
  listAuditLogs,
};
