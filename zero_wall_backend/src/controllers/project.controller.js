const { validationResult } = require('express-validator');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const Task = require('../models/Task');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { notifyAdmins, createNotification } = require('../utils/createNotification');
const { emitToProject, emitToAll } = require('../config/socket');
const { sanitizeProjectData } = require('../utils/sanitize');
const { logActivity } = require('../utils/logActivity');

function getPagination(req) {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10) || 20));
  return { page, limit };
}

function normalizeProjectInput(body = {}, existing = null) {
  const projectType = Array.isArray(body.projectType)
    ? body.projectType
    : existing?.projectType || [];

  const toDate = (value, fallback = null) => {
    if (value === undefined || value === null || value === '') return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  };

  const overallStatus = body.overallStatus || existing?.overallStatus || 'In Progress';
  const currentStage = body.currentStage || existing?.currentStage || 'Concept Design';

  return {
    sNo: Number.isFinite(Number(body.sNo)) ? Number(body.sNo) : existing?.sNo,
    projectName: body.projectName ?? body.name ?? existing?.projectName,
    clientName: body.clientName ?? body.client ?? existing?.clientName,
    companySegment: body.companySegment ?? existing?.companySegment ?? '',
    projectType,
    location: body.location ?? existing?.location ?? '',
    startDate: toDate(body.startDate ?? body.start, existing?.startDate),
    targetDate: toDate(body.targetDate ?? body.end, existing?.targetDate),
    projectValue: Number.isFinite(Number(body.projectValue ?? body.value))
      ? Number(body.projectValue ?? body.value)
      : existing?.projectValue || 0,
    overallStatus,
    currentStage,
    stageCompletion: Number.isFinite(Number(body.stageCompletion ?? body.completion))
      ? Number(body.stageCompletion ?? body.completion)
      : existing?.stageCompletion || 0,
    clientApprovalStatus: body.clientApprovalStatus ?? body.approval ?? existing?.clientApprovalStatus ?? 'Not Submitted',
    clientApprovalDate: toDate(body.clientApprovalDate, existing?.clientApprovalDate),
    nextActionRequired: body.nextActionRequired ?? body.nextAction ?? existing?.nextActionRequired ?? '',
    responsibleEngineer: body.responsibleEngineer ?? existing?.responsibleEngineer ?? null,
    assignedTeam: Array.isArray(body.assignedTeam) ? body.assignedTeam : existing?.assignedTeam || [],
    remarks: body.remarks ?? existing?.remarks ?? '',
    blockers: body.blockers ?? existing?.blockers ?? '',
    ceoMdReview: body.ceoMdReview ?? existing?.ceoMdReview ?? '',
    priority: body.priority ?? existing?.priority ?? 'Medium',
    invoiceStatus: body.invoiceStatus ?? existing?.invoiceStatus ?? '',
    estimatedCompletion: Number.isFinite(Number(body.estimatedCompletion))
      ? Number(body.estimatedCompletion)
      : existing?.estimatedCompletion || 0,
    recv: Number.isFinite(Number(body.recv)) ? Number(body.recv) : existing?.recv || 0,
    balance: Number.isFinite(Number(body.balance)) ? Number(body.balance) : existing?.balance || 0,
    isArchived: body.isArchived ?? existing?.isArchived ?? false,
    createdBy: body.createdBy ?? existing?.createdBy ?? null,
  };
}

function normalizeStatusForFilter(status) {
  if (!status) return '';
  const value = String(status).trim().toLowerCase();
  const map = {
    progress: 'In Progress',
    'in progress': 'In Progress',
    done: 'Completed',
    completed: 'Completed',
    hold: 'On Hold',
    'on hold': 'On Hold',
    cancelled: 'Cancelled',
  };
  return map[value] || status;
}

function serializeProject(project) {
  const doc = project.toObject ? project.toObject({ virtuals: true }) : project;
  const responsibleEngineer = doc.responsibleEngineer || null;
  return {
    id: doc._id,
    sNo: doc.sNo,
    projectName: doc.projectName,
    clientName: doc.clientName,
    companySegment: doc.companySegment,
    projectType: doc.projectType || [],
    location: doc.location,
    startDate: doc.startDate,
    targetDate: doc.targetDate,
    projectValue: doc.projectValue,
    overallStatus: doc.overallStatus,
    currentStage: doc.currentStage,
    stageCompletion: doc.stageCompletion,
    clientApprovalStatus: doc.clientApprovalStatus,
    clientApprovalDate: doc.clientApprovalDate,
    nextActionRequired: doc.nextActionRequired,
    responsibleEngineer,
    assignedTeam: doc.assignedTeam || [],
    remarks: doc.remarks,
    blockers: doc.blockers,
    ceoMdReview: doc.ceoMdReview,
    priority: doc.priority,
    invoiceStatus: doc.invoiceStatus,
    estimatedCompletion: doc.estimatedCompletion,
    recv: doc.recv || 0,
    balance: doc.balance || 0,
    isArchived: doc.isArchived,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    name: doc.projectName,
    client: doc.clientName,
    type: doc.companySegment,
    typeShort: Array.isArray(doc.projectType) ? doc.projectType[0] || '' : '',
    start: doc.startDate,
    end: doc.targetDate,
    value: doc.projectValue,
    status: doc.overallStatus,
    stage: doc.currentStage,
    completion: doc.stageCompletion,
    engineer: responsibleEngineer?.name || '',
    approval: doc.clientApprovalStatus,
    billing: doc.invoiceStatus,
  };
}

async function applyEngineerNames(projects) {
  const populated = await Project.populate(projects, [
    { path: 'responsibleEngineer', select: 'name email role avatar employeeId designation department' },
    { path: 'assignedTeam', select: 'name email role avatar employeeId designation department' },
    { path: 'createdBy', select: 'name email role avatar' },
  ]);
  return populated;
}

const listProjects = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req);
  const filter = {};
  const query = {};

  if (req.query.status) {
    filter.overallStatus = normalizeStatusForFilter(req.query.status);
  }

  if (req.query.priority) {
    filter.priority = req.query.priority;
  }

  if (req.query.segment) {
    filter.companySegment = req.query.segment;
  }

  if (req.query.isArchived !== undefined) {
    filter.isArchived = req.query.isArchived === 'true';
  }

  if (req.query.search) {
    const search = String(req.query.search).trim();
    if (search) {
      query.$text = { $search: search };
    }
  }

  const finalFilter = { ...filter, ...query };
  const total = await Project.countDocuments(finalFilter);
  const projects = await Project.find(finalFilter)
    .sort({ sNo: 1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  const populated = await applyEngineerNames(projects);
  const rows = populated.map(serializeProject);

  return res.json({
    success: true,
    projects: rows,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: {
      projects: rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const populated = await applyEngineerNames([project]);
  const taskCount = await Task.countDocuments({ project: project._id });
  const tasks = await Task.find({ project: project._id })
    .sort({ order: 1, createdAt: 1 })
    .populate('assignee backupReviewer createdBy stage')
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment');
  const stages = await Stage.find({ project: project._id }).sort({ stageNo: 1 }).populate('project', 'projectName clientName');

  return res.json({
    success: true,
    data: {
      ...serializeProject(populated[0]),
      taskCount,
      tasks: tasks.map((task) => task.toObject({ virtuals: true })),
      stages: stages.map((stage) => stage.toObject({ virtuals: true })),
    },
  });
});

const createProject = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const count = await Project.countDocuments({});
  const payload = normalizeProjectInput(req.body);
  Object.assign(payload, sanitizeProjectData(payload));
  payload.sNo = Number.isFinite(payload.sNo) ? payload.sNo : count + 1;
  payload.createdBy = req.user?.id || null;

  const project = await Project.create(payload);
  const populated = await applyEngineerNames([project]);
  const projectRow = serializeProject(populated[0]);

  const io = req.app.get('io');
  if (io) {
    io.emit('project:created', projectRow);
  }
  emitToAll('project:created', projectRow);
  await notifyAdmins({
    sender: req.user?.id || null,
    type: 'project_created',
    title: 'Project created',
    message: `${projectRow.projectName} was created`,
    link: `/projects/${projectRow.id}`,
    metadata: {
      projectId: projectRow.id,
      projectName: projectRow.projectName,
    },
  });
  await logActivity({
    actor: req.user?.id || null,
    action: 'project_created',
    entityType: 'project',
    entityId: projectRow.id,
    project: projectRow.id,
    title: 'Project record created',
    detail: `${projectRow.projectName} was added to the portfolio.`,
    tone: 'sky',
    link: `/projects/${projectRow.id}`,
    metadata: { projectName: projectRow.projectName },
  });

  return res.status(201).json({
    success: true,
    message: 'Project created',
    data: projectRow,
  });
});

const updateProject = asyncHandler(async (req, res) => {
  const existing = await Project.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const payload = normalizeProjectInput(req.body, existing.toObject());
  Object.assign(payload, sanitizeProjectData(payload));
  const project = await Project.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  });

  const populated = await applyEngineerNames([project]);
  const projectRow = serializeProject(populated[0]);
  const io = req.app.get('io');
  if (io) {
    io.emit('project:updated', projectRow);
  }
  emitToProject(req.params.id, 'project:updated', projectRow);
  await logActivity({
    actor: req.user?.id || null,
    action: 'project_updated',
    entityType: 'project',
    entityId: projectRow.id,
    project: projectRow.id,
    title: 'Project details updated',
    detail: `Latest changes were saved for ${projectRow.projectName}.`,
    tone: 'blue',
    link: `/projects/${projectRow.id}`,
    metadata: { projectName: projectRow.projectName },
  });

  return res.json({
    success: true,
    message: 'Project updated',
    data: projectRow,
  });
});

const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  const projectName = project.projectName;
  const projectId = String(project._id);

  await Promise.all([
    Stage.deleteMany({ project: project._id }),
    Task.deleteMany({ project: project._id }),
    Project.findByIdAndDelete(project._id),
  ]);

  const io = req.app.get('io');
  if (io) {
    io.emit('project:deleted', { id: req.params.id });
  }
  emitToAll('project:deleted', { id: req.params.id });
  await logActivity({
    actor: req.user?.id || null,
    action: 'project_deleted',
    entityType: 'project',
    entityId: projectId,
    project: projectId,
    title: 'Project deleted',
    detail: `${projectName} was removed from the portfolio.`,
    tone: 'rose',
    link: '/projects',
    metadata: { projectName },
  });

  return res.json({
    success: true,
    message: 'Project and related data deleted',
  });
});

const reorderProjects = asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  await Promise.all(
    items.map((item, index) =>
      Project.updateOne(
        { _id: item.id || item._id },
        { $set: { sNo: Number(item.sNo || index + 1) } },
      ),
    ),
  );
  return res.json({ success: true, message: 'Projects reordered' });
});

const getProjectSummary = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const tasks = await Task.find({ project: project._id });
  const taskCounts = tasks.reduce(
    (acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    },
    { todo: 0, 'in-progress': 0, review: 0, done: 0 },
  );

  return res.json({
    success: true,
    data: {
      project: serializeProject(project),
      taskCounts,
      totalTasks: tasks.length,
      stageCompletion: project.stageCompletion,
    },
  });
});

const exportProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find().sort({ sNo: 1 });
  const populated = await applyEngineerNames(projects);
  return res.json({
    success: true,
    data: populated.map(serializeProject),
  });
});

const listProjectStages = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const stages = await Stage.find({ project: projectId }).sort({ stageNo: 1 });
  return res.json({
    success: true,
    data: stages.map((stage) => stage.toObject({ virtuals: true })),
  });
});

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects,
  getProjectSummary,
  exportProjects,
  listProjectStages,
  serializeProject,
};
