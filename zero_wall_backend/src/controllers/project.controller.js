const Project = require('../models/Project');
const asyncHandler = require('../utils/asyncHandler');

function normalizeProjectPayload(payload = {}, existing = null) {
  const baseValue = existing ? Number(existing.value || 0) : 0;
  const providedValue = payload.value !== undefined ? Number(payload.value) : baseValue;
  const value = Number.isFinite(providedValue) ? providedValue : baseValue;

  const start = payload.start ? new Date(payload.start) : existing?.start || new Date();
  const end =
    payload.end ? new Date(payload.end) : existing?.end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    name: payload.name ?? existing?.name,
    client: payload.client ?? existing?.client,
    type: payload.type ?? existing?.type ?? 'General',
    typeShort: payload.typeShort ?? existing?.typeShort ?? payload.type ?? 'General',
    location: payload.location ?? existing?.location ?? 'Unknown',
    start,
    end,
    value,
    status: payload.status ?? existing?.status ?? 'progress',
    stage: payload.stage ?? existing?.stage ?? 'Concept Design',
    completion: Number.isFinite(Number(payload.completion))
      ? Number(payload.completion)
      : existing?.completion ?? 0,
    priority: payload.priority ?? existing?.priority ?? 'medium',
    engineer: payload.engineer ?? existing?.engineer ?? 'Unassigned',
    approval: payload.approval ?? existing?.approval ?? 'Pending',
    billing: payload.billing ?? existing?.billing ?? 'New',
    recv: Number.isFinite(Number(payload.recv)) ? Number(payload.recv) : existing?.recv ?? 0,
    balance:
      Number.isFinite(Number(payload.balance))
        ? Number(payload.balance)
        : existing?.balance ?? value,
    tasks: Array.isArray(payload.tasks)
      ? payload.tasks.map((task) => ({
          title: task.title ?? 'Untitled task',
          description: task.description ?? '',
          assignee: task.assignee ?? 'Unassigned',
          backupReviewer: task.backupReviewer ?? '',
          dueDate: task.dueDate ?? new Date().toISOString().slice(0, 10),
          priority: task.priority ?? 'medium',
          status: task.status ?? 'pending',
          stage: task.stage ?? '',
        }))
      : existing?.tasks || [],
    stageHistory: Array.isArray(payload.stageHistory)
      ? payload.stageHistory
      : existing?.stageHistory || [],
  };
}

function toProjectResponse(doc) {
  const project = doc.toObject ? doc.toObject() : doc;
  return {
    id: project._id,
    name: project.name,
    client: project.client,
    type: project.type,
    typeShort: project.typeShort,
    location: project.location,
    start: project.start,
    end: project.end,
    value: project.value,
    status: project.status,
    stage: project.stage,
    completion: project.completion,
    priority: project.priority,
    engineer: project.engineer,
    approval: project.approval,
    billing: project.billing,
    recv: project.recv,
    balance: project.balance,
    tasks: project.tasks || [],
    stageHistory: project.stageHistory || [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

const listProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find().sort({ createdAt: -1 });
  return res.json({ success: true, data: projects.map(toProjectResponse) });
});

const createProject = asyncHandler(async (req, res) => {
  const payload = normalizeProjectPayload(req.body);
  const project = await Project.create(payload);

  const io = req.app.get('io');
  if (io) {
    io.emit('project:created', toProjectResponse(project));
  }

  return res.status(201).json({ success: true, data: toProjectResponse(project) });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }
  return res.json({ success: true, data: toProjectResponse(project) });
});

const updateProject = asyncHandler(async (req, res) => {
  const current = await Project.findById(req.params.id);
  if (!current) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const nextPayload = normalizeProjectPayload(req.body, current.toObject());
  const project = await Project.findByIdAndUpdate(req.params.id, nextPayload, {
    new: true,
    runValidators: true,
  });

  const io = req.app.get('io');
  if (io) {
    io.emit('project:updated', toProjectResponse(project));
  }

  return res.json({ success: true, data: toProjectResponse(project) });
});

const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findByIdAndDelete(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const io = req.app.get('io');
  if (io) {
    io.emit('project:deleted', { id: req.params.id });
  }

  return res.json({ success: true, message: 'Project deleted' });
});

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  toProjectResponse,
};
