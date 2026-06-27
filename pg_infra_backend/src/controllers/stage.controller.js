const { validationResult } = require('express-validator');
const Stage = require('../models/Stage');
const Project = require('../models/Project');
const asyncHandler = require('../utils/asyncHandler');
const { serializeProject } = require('./project.controller');
const { createNotification } = require('../utils/createNotification');
const { emitToProject } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');
const { logAuditEvent } = require('../middleware/auditLog');

function serializeStage(stage) {
  const doc = stage.toObject ? stage.toObject({ virtuals: true }) : stage;
  return {
    id: doc._id,
    project: doc.project,
    stageNo: doc.stageNo,
    stageName: doc.stageName,
    stageDescription: doc.stageDescription,
    stageStart: doc.stageStart,
    stageEndPlanned: doc.stageEndPlanned,
    stageEndActual: doc.stageEndActual,
    stageStatus: doc.stageStatus,
    deliverable: doc.deliverable,
    submittedToClientOn: doc.submittedToClientOn,
    clientApprovalStatus: doc.clientApprovalStatus,
    clientApprovalDate: doc.clientApprovalDate,
    clientComments: doc.clientComments,
    nextAction: doc.nextAction,
    responsibleEngineer: doc.responsibleEngineer,
    approvalRequired: doc.approvalRequired,
    disciplines: doc.disciplines,
    duration: doc.duration,
    completionPct: doc.completionPct,
    assignedTo: doc.assignedTo,
    approvedBy: doc.approvedBy,
    approvedAt: doc.approvedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeStageInput(body = {}, existing = null) {
  return {
    stageNo: body.stageNo ?? existing?.stageNo ?? 'Stage 1',
    stageName: body.stageName ?? existing?.stageName ?? 'Concept Design',
    stageDescription: body.stageDescription ?? existing?.stageDescription ?? '',
    stageStart: toDate(body.stageStart, existing?.stageStart || null),
    stageEndPlanned: toDate(body.stageEndPlanned, existing?.stageEndPlanned || null),
    stageEndActual: toDate(body.stageEndActual, existing?.stageEndActual || null),
    stageStatus: body.stageStatus ?? existing?.stageStatus ?? 'Not Started',
    deliverable: body.deliverable ?? existing?.deliverable ?? '',
    submittedToClientOn: toDate(body.submittedToClientOn, existing?.submittedToClientOn || null),
    clientApprovalStatus: body.clientApprovalStatus ?? existing?.clientApprovalStatus ?? 'Not Submitted',
    clientApprovalDate: toDate(body.clientApprovalDate, existing?.clientApprovalDate || null),
    clientComments: body.clientComments ?? existing?.clientComments ?? '',
    nextAction: body.nextAction ?? existing?.nextAction ?? '',
    responsibleEngineer: body.responsibleEngineer ?? existing?.responsibleEngineer ?? null,
    approvalRequired: body.approvalRequired ?? existing?.approvalRequired ?? '',
    disciplines: body.disciplines ?? existing?.disciplines ?? '',
    duration: body.duration ?? existing?.duration ?? '',
    completionPct: Number.isFinite(Number(body.completionPct ?? body.completion))
      ? Number(body.completionPct ?? body.completion)
      : existing?.completionPct || 0,
    assignedTo: body.assignedTo ?? existing?.assignedTo ?? null,
    approvedBy: body.approvedBy ?? existing?.approvedBy ?? null,
    approvedAt: toDate(body.approvedAt, existing?.approvedAt || null),
  };
}

async function recalcProjectCompletion(projectId) {
  const stages = await Stage.find({ project: projectId });
  const total = stages.length;
  const completed = stages.filter((stage) => stage.stageStatus === 'Completed').length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  await Project.updateOne({ _id: projectId }, { $set: { stageCompletion: pct } });
}

const listStages = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.params.projectId) {
    filter.project = req.params.projectId;
  } else if (req.query.project) {
    filter.project = req.query.project;
  }

  const stages = await Stage.find(filter)
    .sort({ stageNo: 1, createdAt: 1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment');

  return res.json({
    success: true,
    data: stages.map(serializeStage),
  });
});

const createStage = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const projectId = req.params.projectId || req.body.project;
  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const stage = await Stage.create({
    ...normalizeStageInput(req.body),
    project: projectId,
    createdBy: req.user?.id || null,
  });

  await recalcProjectCompletion(projectId);
  const populatedProject = await Project.findById(projectId).select('projectName clientName');
  await logActivity({
    actor: req.user?.id || null,
    action: 'stage_created',
    entityType: 'stage',
    entityId: stage._id,
    project: projectId,
    title: `${stage.stageName} added`,
    detail: stage.stageDescription || 'A project stage was created.',
    tone: 'emerald',
    link: `/projects/${projectId}`,
    metadata: {
      projectName: populatedProject?.projectName || '',
      stageName: stage.stageName,
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'stage_created',
    resource: 'stage',
    resourceId: String(stage._id),
  });

  return res.status(201).json({
    success: true,
    message: 'Stage created',
    data: serializeStage(stage),
  });
});

const updateStage = asyncHandler(async (req, res) => {
  const stage = await Stage.findById(req.params.id);
  if (!stage) {
    return res.status(404).json({ success: false, message: 'Stage not found' });
  }

  Object.assign(stage, normalizeStageInput(req.body, stage));
  await stage.save();
  await recalcProjectCompletion(stage.project);
  const project = await Project.findById(stage.project).select('projectName clientName');
  await logActivity({
    actor: req.user?.id || null,
    action: 'stage_updated',
    entityType: 'stage',
    entityId: stage._id,
    project: stage.project,
    title: `${stage.stageName} updated`,
    detail: stage.nextAction || 'Stage details were updated.',
    tone: 'blue',
    link: `/projects/${stage.project}`,
    metadata: {
      projectName: project?.projectName || '',
      stageName: stage.stageName,
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'stage_updated',
    resource: 'stage',
    resourceId: String(stage._id),
  });

  return res.json({
    success: true,
    message: 'Stage updated',
    data: serializeStage(stage),
  });
});

const deleteStage = asyncHandler(async (req, res) => {
  const stage = await Stage.findById(req.params.id);
  if (!stage) {
    return res.status(404).json({ success: false, message: 'Stage not found' });
  }

  const projectId = stage.project;
  await stage.deleteOne();
  await recalcProjectCompletion(projectId);
  const project = await Project.findById(projectId).select('projectName clientName');
  await logActivity({
    actor: req.user?.id || null,
    action: 'stage_deleted',
    entityType: 'stage',
    entityId: stage._id,
    project: projectId,
    title: `${stage.stageName} deleted`,
    detail: `${stage.stageName} was removed from the project.`,
    tone: 'rose',
    link: `/projects/${projectId}`,
    metadata: {
      projectName: project?.projectName || '',
      stageName: stage.stageName,
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'stage_deleted',
    resource: 'stage',
    resourceId: String(stage._id),
  });

  return res.json({
    success: true,
    message: 'Stage deleted',
  });
});

const approveStage = asyncHandler(async (req, res) => {
  const stage = await Stage.findById(req.params.id);
  if (!stage) {
    return res.status(404).json({ success: false, message: 'Stage not found' });
  }

  const action = String(req.body.action || 'approve').toLowerCase();
  const comments = req.body.comments || '';

  if (action === 'approve') {
    stage.stageStatus = 'Completed';
    stage.clientApprovalStatus = 'Approved';
    stage.clientApprovalDate = new Date();
    stage.stageEndActual = stage.stageEndActual || new Date();
    stage.approvedBy = req.user?.id || null;
    stage.approvedAt = new Date();
    stage.clientComments = comments || stage.clientComments;
    stage.completionPct = 100;
  } else {
    stage.stageStatus = 'In Progress';
    stage.clientApprovalStatus = 'In Review';
    stage.clientComments = comments || stage.clientComments;
  }

  await stage.save();
  await recalcProjectCompletion(stage.project);

  const project = await Project.findById(stage.project).populate('responsibleEngineer assignedTeam createdBy');
  emitToProject(stage.project, 'stage:approved', {
    stage: serializeStage(stage),
    project: project ? serializeProject(project) : null,
  });
  await logActivity({
    actor: req.user?.id || null,
    action: action === 'approve' ? 'stage_approved' : 'stage_rejected',
    entityType: 'stage',
    entityId: stage._id,
    project: stage.project,
    title: action === 'approve' ? `${stage.stageName} approved` : `${stage.stageName} review updated`,
    detail: action === 'approve'
      ? `${stage.stageName} for ${project?.projectName || 'project'} was approved.`
      : `${stage.stageName} for ${project?.projectName || 'project'} was sent back for review.`,
    tone: action === 'approve' ? 'emerald' : 'amber',
    link: `/projects/${project?._id || stage.project}`,
    metadata: {
      projectName: project?.projectName || '',
      stageName: stage.stageName,
      action,
    },
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: action === 'approve' ? 'stage_approved' : 'stage_rejected',
    resource: 'stage',
    resourceId: String(stage._id),
  });

  const recipient = project?.responsibleEngineer?._id || project?.createdBy?._id || null;
  if (recipient) {
    await createNotification({
      recipient,
      sender: req.user?.id || null,
      type: action === 'approve' ? 'stage_approved' : 'stage_rejected',
      title: action === 'approve' ? 'Stage approved' : 'Stage review updated',
      message: `${stage.stageName} for ${project?.projectName || 'project'} was ${action === 'approve' ? 'approved' : 'sent back for review'}`,
      link: `/projects/${project?._id || stage.project}`,
      metadata: {
        projectId: project?._id || stage.project,
        projectName: project?.projectName || '',
        stageId: stage._id,
      },
    });
  }

  return res.json({
    success: true,
    message: 'Stage approval updated',
    data: {
      stage: serializeStage(stage),
      project: project ? serializeProject(project) : null,
    },
  });
});

module.exports = {
  listStages,
  createStage,
  updateStage,
  deleteStage,
  approveStage,
  serializeStage,
};
