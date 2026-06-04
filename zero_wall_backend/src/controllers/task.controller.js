const { validationResult } = require('express-validator');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification } = require('../utils/createNotification');
const { emitToProject } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');
const mongoose = require('mongoose');

function serializeTask(task) {
  const doc = task.toObject ? task.toObject({ virtuals: true }) : task;
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    project: doc.project,
    stage: doc.stage,
    assignee: doc.assignee,
    backupReviewer: doc.backupReviewer,
    priority: doc.priority,
    status: doc.status,
    dueDate: doc.dueDate,
    completedAt: doc.completedAt,
    attachments: doc.attachments || [],
    comments: doc.comments || [],
    order: doc.order,
    totalTimeLogged: doc.totalTimeLogged,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveStageForProject(projectId, stageValue) {
  if (!stageValue) return null;

  const raw = String(stageValue).trim();
  if (!raw) return null;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    const byId = await Stage.findOne({ _id: raw, project: projectId });
    if (byId) return byId;
  }

  const normalized = raw.toLowerCase();
  const compact = normalized.replace(/\s+/g, ' ').trim();
  const regex = new RegExp(`^${escapeRegex(compact)}$`, 'i');

  const byLabel = await Stage.findOne({
    project: projectId,
    $or: [{ stageNo: regex }, { stageName: regex }],
  });

  if (byLabel) return byLabel;

  // allow loose matches such as "stage 1" vs "Stage 1" or "concept design"
  const stages = await Stage.find({ project: projectId }).select('_id stageNo stageName');
  const found = stages.find((stage) => {
    const stageNo = String(stage.stageNo || '').toLowerCase();
    const stageName = String(stage.stageName || '').toLowerCase();
    return stageNo === compact || stageName === compact;
  });

  return found || null;
}

function toDate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeTaskInput(body = {}, existing = null) {
  const stage = body.stage ?? body.stageId ?? existing?.stage ?? null;
  const assignee = body.assignee ?? body.assigneeId ?? existing?.assignee ?? null;
  const backupReviewer = body.backupReviewer ?? body.backupReviewerId ?? existing?.backupReviewer ?? null;

  return {
    title: body.title ?? existing?.title ?? '',
    description: body.description ?? existing?.description ?? '',
    project: body.project ?? existing?.project ?? null,
    stage: stage === '' ? null : stage,
    assignee: assignee === '' ? null : assignee,
    backupReviewer: backupReviewer === '' ? null : backupReviewer,
    priority: body.priority ?? existing?.priority ?? 'Medium',
    status: body.status ?? existing?.status ?? 'todo',
    dueDate: toDate(body.dueDate, existing?.dueDate || null),
    completedAt: toDate(body.completedAt, existing?.completedAt || null),
    attachments: Array.isArray(body.attachments) ? body.attachments : existing?.attachments || [],
    order: Number.isFinite(Number(body.order ?? existing?.order))
      ? Number(body.order ?? existing?.order)
      : existing?.order || 0,
    totalTimeLogged: Number.isFinite(Number(body.totalTimeLogged ?? existing?.totalTimeLogged))
      ? Number(body.totalTimeLogged ?? existing?.totalTimeLogged)
      : existing?.totalTimeLogged || 0,
  };
}

async function canAccessTask(req, task) {
  if (['superadmin', 'admin'].includes(req.user?.role)) {
    return true;
  }

  return String(task.assignee?._id || task.assignee) === String(req.user?.id);
}

const listTasks = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.project) filter.project = req.query.project;
  if (req.query.assignee) filter.assignee = req.query.assignee;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;

  let tasks = await Task.find(filter)
    .sort({ order: 1, dueDate: 1, createdAt: -1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar');

  if (req.query.search) {
    const search = String(req.query.search).trim().toLowerCase();
    tasks = tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(search) ||
        (task.description || '').toLowerCase().includes(search),
    );
  }

  return res.json({
    success: true,
    data: tasks.map(serializeTask),
  });
});

const getMyTasks = asyncHandler(async (req, res) => {
  const tasks = await Task.find({ assignee: req.user.id })
    .sort({ dueDate: 1, order: 1 })
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar');

  return res.json({
    success: true,
    data: tasks.map(serializeTask),
  });
});

const getTaskById = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar');

  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  if (!(await canAccessTask(req, task))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  return res.json({
    success: true,
    data: serializeTask(task),
  });
});

const createTask = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const project = await Project.findById(req.body.project);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  let resolvedStage = null;
  if (req.body.stage) {
    resolvedStage = await resolveStageForProject(project._id, req.body.stage);
    if (!resolvedStage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
  }

  const existingCount = await Task.countDocuments({ project: project._id });
  const task = await Task.create({
    ...normalizeTaskInput(req.body),
    order: Number.isFinite(Number(req.body.order)) ? Number(req.body.order) : existingCount + 1,
    stage: resolvedStage?._id || null,
    createdBy: req.user?.id || null,
  });

  const populated = await Task.findById(task._id)
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar');

  if (populated?.assignee && String(populated.assignee._id || populated.assignee) !== String(req.user?.id)) {
    await createNotification({
      recipient: populated.assignee._id || populated.assignee,
      sender: req.user?.id || null,
      type: 'task_assigned',
      title: 'Task assigned',
      message: `${populated.title} was assigned to you`,
      link: '/my-tasks',
      metadata: {
        taskId: populated._id,
        taskTitle: populated.title,
        projectId: populated.project?._id || populated.project,
        projectName: populated.project?.projectName || '',
      },
    });
  }
  await logActivity({
    actor: req.user?.id || null,
    action: 'task_created',
    entityType: 'task',
    entityId: populated._id,
    project: populated.project?._id || populated.project,
    title: `Task created: ${populated.title}`,
    detail: populated.description || 'A new task was added to the project.',
    tone: 'sky',
    link: `/projects/${populated.project?._id || populated.project}`,
    metadata: {
      projectName: populated.project?.projectName || '',
      taskTitle: populated.title,
    },
  });

  return res.status(201).json({
    success: true,
    message: 'Task created',
    data: serializeTask(populated),
  });
});

const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  const userId = String(req.user?.id);
  const assigneeId = String(task.assignee);
  if (req.user?.role === 'employee' && userId !== assigneeId) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  Object.assign(task, normalizeTaskInput(req.body, task));
  if (req.body.stage !== undefined) {
    const resolvedStage = await resolveStageForProject(task.project, req.body.stage);
    if (!resolvedStage && req.body.stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
    task.stage = resolvedStage?._id || null;
  }
  await task.save();

  const populated = await Task.findById(task._id)
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar');

  emitToProject(populated.project?._id || populated.project, 'task:updated', serializeTask(populated));
  await logActivity({
    actor: req.user?.id || null,
    action: 'task_updated',
    entityType: 'task',
    entityId: populated._id,
    project: populated.project?._id || populated.project,
    title: `Task updated: ${populated.title}`,
    detail: populated.description || 'Task details were updated.',
    tone: 'blue',
    link: `/projects/${populated.project?._id || populated.project}`,
    metadata: {
      projectName: populated.project?.projectName || '',
      taskTitle: populated.title,
      status: populated.status,
    },
  });

  return res.json({
    success: true,
    message: 'Task updated',
    data: serializeTask(populated),
  });
});

const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  await task.deleteOne();
  await logActivity({
    actor: req.user?.id || null,
    action: 'task_deleted',
    entityType: 'task',
    entityId: task._id,
    project: task.project,
    title: `Task deleted: ${task.title}`,
    detail: `${task.title} was removed from the project.`,
    tone: 'rose',
    link: `/projects/${task.project}`,
    metadata: {
      taskTitle: task.title,
    },
  });
  return res.json({ success: true, message: 'Task deleted' });
});

const reorderTasks = asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  await Promise.all(
    items.map((item, index) =>
      Task.updateOne(
        { _id: item.id || item._id },
        { $set: { order: Number(item.order ?? index + 1) } },
      ),
    ),
  );

  return res.json({ success: true, message: 'Tasks reordered' });
});

const addComment = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  const text = String(req.body.text || '').trim();
  if (!text) {
    return res.status(400).json({ success: false, message: 'Comment text is required' });
  }

  task.comments.push({
    user: req.user?.id || null,
    text,
    timestamp: new Date(),
  });
  await task.save();

  const populated = await Task.findById(task._id)
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('comments.user', 'name email role avatar employeeId designation department')
    .populate('createdBy', 'name email role avatar');

  emitToProject(task.project, 'comment:added', {
    taskId: task._id,
    text,
    userId: req.user?.id || null,
  });
  await logActivity({
    actor: req.user?.id || null,
    action: 'task_commented',
    entityType: 'task',
    entityId: task._id,
    project: task.project,
    title: `Comment added: ${task.title}`,
    detail: text,
    tone: 'amber',
    link: `/projects/${task.project}`,
    metadata: {
      taskTitle: task.title,
    },
  });

  if (task.assignee && String(task.assignee) !== String(req.user?.id)) {
    await createNotification({
      recipient: task.assignee,
      sender: req.user?.id || null,
      type: 'comment_added',
      title: 'Comment added',
      message: `A comment was added to ${task.title}`,
      link: `/projects/${task.project}`,
      metadata: {
        taskId: task._id,
        taskTitle: task.title,
        projectId: task.project,
      },
    });
  }

  return res.status(201).json({
    success: true,
    message: 'Comment added',
    data: serializeTask(populated),
  });
});

module.exports = {
  listTasks,
  getMyTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  addComment,
  serializeTask,
};
