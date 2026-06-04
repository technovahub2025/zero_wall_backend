const asyncHandler = require('../utils/asyncHandler');
const ActivityLog = require('../models/ActivityLog');
const { serializeActivity } = require('../utils/logActivity');

const listActivityLogs = asyncHandler(async (req, res) => {
  const { project, entityType, actor, limit = 20, page = 1 } = req.query;
  const filter = {};

  if (project) filter.project = project;
  if (entityType && entityType !== 'all') filter.entityType = entityType;
  if (actor) filter.actor = actor;

  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);

  const [items, total] = await Promise.all([
    ActivityLog.find(filter)
      .sort({ occurredAt: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate('actor', 'name avatar role employeeId designation department')
      .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment'),
    ActivityLog.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: items.map(serializeActivity),
      total,
      page: safePage,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  });
});

module.exports = {
  listActivityLogs,
};
