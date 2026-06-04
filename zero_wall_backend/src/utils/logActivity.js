const ActivityLog = require('../models/ActivityLog');
const { emitToAdmin, emitToProject } = require('../config/socket');

function serializeActivity(log) {
  const doc = log.toObject ? log.toObject({ virtuals: true }) : log;
  return {
    id: doc._id,
    actor: doc.actor || null,
    action: doc.action,
    entityType: doc.entityType,
    entityId: doc.entityId || '',
    project: doc.project || null,
    title: doc.title,
    detail: doc.detail || '',
    tone: doc.tone || 'sky',
    link: doc.link || '',
    metadata: doc.metadata || {},
    occurredAt: doc.occurredAt || doc.createdAt || null,
    isSystem: Boolean(doc.isSystem),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function logActivity({
  actor = null,
  action,
  entityType = 'other',
  entityId = '',
  project = null,
  title,
  detail = '',
  tone = 'sky',
  link = '',
  metadata = {},
  occurredAt = null,
  isSystem = false,
}) {
  if (!action || !title) return null;

  const activity = await ActivityLog.create({
    actor,
    action,
    entityType,
    entityId: entityId ? String(entityId) : '',
    project,
    title,
    detail,
    tone,
    link,
    metadata,
    occurredAt: occurredAt || new Date(),
    isSystem,
  });

  const populated = await ActivityLog.findById(activity._id)
    .populate('actor', 'name avatar role employeeId designation department')
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment');

  const payload = serializeActivity(populated);

  try {
    emitToAdmin('activity:created', payload);
    if (project) {
      emitToProject(String(project), 'activity:created', payload);
    }
  } catch (error) {
    // socket layer is optional during seed/tests
  }

  return payload;
}

module.exports = {
  logActivity,
  serializeActivity,
};
