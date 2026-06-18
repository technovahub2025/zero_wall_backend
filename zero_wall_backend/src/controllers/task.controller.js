const { validationResult } = require('express-validator');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const User = require('../models/User');
const Team = require('../models/Team');
const TimerLog = require('../models/TimerLog');
const TaskTimeExtensionRequest = require('../models/TaskTimeExtensionRequest');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification } = require('../utils/createNotification');
const { emitToAll, emitToProject } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');
const mongoose = require('mongoose');

const MAX_TASKS_PER_REQUEST = 50;

function serializeTask(task) {
  const doc = task.toObject ? task.toObject({ virtuals: true }) : task;
  const reporter = doc.reporter || doc.createdBy || null;
  const team = doc.team || null;
  const assignedTeam = doc.assignedTeam || [];
  const teamMembers = Array.isArray(team?.members) ? team.members : [];
  const timerStatus = getEffectiveTimerStatus(doc);
  const timerBudgetSeconds = (Number(doc.estimatedDurationMinutes || 0) + Number(doc.extraTimeMinutesGranted || 0)) * 60;
  const timerRemainingSeconds = timerStatus === 'paused'
    ? Math.max(0, Math.floor(timerBudgetSeconds - Number(doc.totalTimeLogged || 0)))
    : doc.timerExpiresAt && ['running', 'extended'].includes(timerStatus)
      ? Math.max(0, Math.floor((new Date(doc.timerExpiresAt).getTime() - Date.now()) / 1000))
      : Math.max(0, Math.floor(timerBudgetSeconds - Number(doc.totalTimeLogged || 0)));
  return {
    id: doc._id,
    title: doc.title,
    description: doc.description,
    project: doc.project,
    stage: doc.stage,
    assignee: doc.assignee,
    team,
    teamName: team?.name || '',
    teamMembers,
    assignedTeam,
    backupReviewer: doc.backupReviewer,
    reporter,
    priority: doc.priority,
    status: doc.status,
    startDate: doc.startDate,
    dueDate: doc.dueDate,
    completedAt: doc.completedAt,
    estimatedDurationMinutes: Number(doc.estimatedDurationMinutes || 0),
    timerStartedAt: doc.timerStartedAt,
    timerPausedAt: doc.timerPausedAt,
    timerExpiresAt: doc.timerExpiresAt,
    timerStatus,
    extraTimeMinutesGranted: Number(doc.extraTimeMinutesGranted || 0),
    activeTimerLog: doc.activeTimerLog,
    timerBudgetSeconds,
    timerRemainingSeconds,
    pendingTimeExtensionRequest: doc.pendingTimeExtensionRequest || null,
    latestTimeExtensionRequest: doc.latestTimeExtensionRequest || null,
    nextAction: doc.nextAction,
    tags: doc.tags || [],
    attachments: doc.attachments || [],
    comments: doc.comments || [],
    order: doc.order,
    totalTimeLogged: doc.totalTimeLogged,
    createdBy: doc.createdBy,
    reporterName: reporter?.name || '',
    teamMemberNames: teamMembers.map((member) => member?.name || member?.label || '').filter(Boolean),
    assignedTeamNames: assignedTeam
      .map((member) => member?.name || member?.label || '')
      .filter(Boolean),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function getEffectiveTimerStatus(task) {
  const rawStatus = task.timerStatus || 'not_started';
  if (task.status === 'done' || rawStatus === 'completed') return 'completed';
  if (task.timerExpiresAt && ['running', 'extended'].includes(rawStatus) && new Date(task.timerExpiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return rawStatus;
}

function serializeTimeExtensionRequest(request) {
  if (!request) return null;
  const doc = request.toObject ? request.toObject({ virtuals: true }) : request;
  return {
    id: doc._id,
    task: doc.task,
    employee: doc.employee,
    requestedMinutes: Number(doc.requestedMinutes || 0),
    reason: doc.reason || '',
    status: doc.status,
    approvedBy: doc.approvedBy,
    rejectedBy: doc.rejectedBy,
    decidedAt: doc.decidedAt,
    decisionNote: doc.decisionNote || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function canApproveTimeExtension(user, task) {
  if (!user || !task) return false;
  const userId = String(user.id);
  const reporterId = String(task.reporter?._id || task.reporter || '');
  const creatorId = String(task.createdBy?._id || task.createdBy || '');
  const assigneeId = String(task.assignee?._id || task.assignee || '');
  return userId === reporterId || userId === creatorId || userId === assigneeId;
}

async function serializeTasksWithRequests(tasks) {
  const taskIds = tasks.map((task) => task?._id || task?.id).filter(Boolean);
  if (!taskIds.length) return tasks.map(serializeTask);

  const requests = await TaskTimeExtensionRequest.find({ task: { $in: taskIds } })
    .sort({ createdAt: -1 })
    .populate('employee', 'name email role avatar employeeId')
    .populate('approvedBy', 'name email role avatar employeeId')
    .populate('rejectedBy', 'name email role avatar employeeId');

  const byTask = requests.reduce((acc, request) => {
    const key = String(request.task?._id || request.task);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(request);
    return acc;
  }, new Map());

  return tasks.map((task) => {
    const doc = task.toObject ? task.toObject({ virtuals: true }) : { ...task };
    const taskRequests = byTask.get(String(doc._id || doc.id)) || [];
    const pending = taskRequests.find((request) => request.status === 'pending') || null;
    doc.pendingTimeExtensionRequest = serializeTimeExtensionRequest(pending);
    doc.latestTimeExtensionRequest = serializeTimeExtensionRequest(taskRequests[0] || null);
    return serializeTask(doc);
  });
}

async function getUserTeamIds(userId) {
  if (!userId) return [];
  const teams = await Team.find({ members: userId }).select('_id');
  return teams.map((team) => String(team._id));
}

function populateTaskRelations(query) {
  return query
    .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId designation department')
    .populate('assignedTeam', 'name email role avatar employeeId designation department')
    .populate('backupReviewer', 'name email role avatar')
    .populate('createdBy', 'name email role avatar')
    .populate('reporter', 'name email role avatar employeeId designation department')
    .populate({
      path: 'team',
      select: 'name description color members isActive',
      populate: {
        path: 'members',
        select: 'name email role avatar employeeId designation department',
      },
    });
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTaskLimit(value) {
  const parsed = Number.parseInt(value ?? `${MAX_TASKS_PER_REQUEST}`, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_TASKS_PER_REQUEST;
  return Math.min(parsed, MAX_TASKS_PER_REQUEST);
}

function parseTaskScope(req) {
  const projectId = String(req.query.project || '').trim();
  const mine = ['true', '1', 'yes'].includes(String(req.query.mine || '').trim().toLowerCase());
  if (projectId) {
    return { type: 'project', projectId };
  }
  if (mine) {
    return { type: 'mine' };
  }
  return null;
}

async function buildTaskFilter(req) {
  const scope = parseTaskScope(req);
  if (!scope) {
    return { error: 'Project or mine scope is required' };
  }

  const filter = {};
  if (scope.type === 'project') {
    if (!['superadmin', 'admin', 'project_manager'].includes(req.user?.role)) {
      return { error: 'Forbidden', code: 403 };
    }
    filter.project = scope.projectId;
  } else {
    const teamIds = await getUserTeamIds(req.user?.id);
    filter.$or = [
      { assignee: req.user?.id },
      { reporter: req.user?.id },
      { assignedTeam: req.user?.id },
      ...(teamIds.length ? [{ team: { $in: teamIds } }] : []),
    ];
  }

  if (req.query.assignee) filter.assignee = req.query.assignee;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;

  const search = String(req.query.search || '').trim();
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const searchMatch = [{ title: regex }, { description: regex }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchMatch }];
      delete filter.$or;
    } else {
      filter.$or = searchMatch;
    }
  }

  return { filter, scope };
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

function toPositiveMinutes(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function normalizeTaskInput(body = {}, existing = null) {
  const stage = body.stage ?? body.stageId ?? existing?.stage ?? null;
  const assignee = body.assignee ?? body.assigneeId ?? existing?.assignee ?? null;
  const reporter = body.reporter ?? body.reporterId ?? existing?.reporter ?? existing?.createdBy ?? null;
  const team = body.team ?? body.teamId ?? existing?.team ?? null;
  const assignedTeam = Array.isArray(body.assignedTeam)
    ? body.assignedTeam.filter(Boolean)
    : typeof body.assignedTeam === 'string'
      ? body.assignedTeam.split(',').map((item) => String(item).trim()).filter(Boolean)
      : existing?.assignedTeam || [];
  const backupReviewer = body.backupReviewer ?? body.backupReviewerId ?? existing?.backupReviewer ?? null;
  const tags = Array.isArray(body.tags)
    ? body.tags.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)
    : typeof body.tags === 'string'
      ? body.tags.split(',').map((item) => String(item).trim()).filter(Boolean)
      : existing?.tags || [];

  return {
    title: body.title ?? existing?.title ?? '',
    description: body.description ?? existing?.description ?? '',
    project: body.project ?? existing?.project ?? null,
    startDate: toDate(body.startDate, existing?.startDate || null),
    stage: stage === '' ? null : stage,
    assignee: assignee === '' ? null : assignee,
    team: team === '' ? null : team,
    assignedTeam,
    backupReviewer: backupReviewer === '' ? null : backupReviewer,
    reporter: reporter === '' ? null : reporter,
    priority: body.priority ?? existing?.priority ?? 'Medium',
    status: body.status ?? existing?.status ?? 'todo',
    dueDate: toDate(body.dueDate, existing?.dueDate || null),
    completedAt: toDate(body.completedAt, existing?.completedAt || null),
    estimatedDurationMinutes: toPositiveMinutes(body.estimatedDurationMinutes, existing?.estimatedDurationMinutes || 0),
    nextAction: body.nextAction ?? existing?.nextAction ?? '',
    tags,
    attachments: Array.isArray(body.attachments) ? body.attachments : existing?.attachments || [],
    order: Number.isFinite(Number(body.order ?? existing?.order))
      ? Number(body.order ?? existing?.order)
      : existing?.order || 0,
    totalTimeLogged: Number.isFinite(Number(body.totalTimeLogged ?? existing?.totalTimeLogged))
      ? Number(body.totalTimeLogged ?? existing?.totalTimeLogged)
      : existing?.totalTimeLogged || 0,
  };
}

async function finishBudgetedTimerForTask(task, userId = null) {
  if (!task?.activeTimerLog) return;
  const activeLog = await TimerLog.findById(task.activeTimerLog);
  if (!activeLog || !activeLog.isActive) {
    task.activeTimerLog = undefined;
    return;
  }

  activeLog.endTime = new Date();
  activeLog.isActive = false;
  await activeLog.save();
  task.totalTimeLogged = Number(task.totalTimeLogged || 0) + Number(activeLog.duration || 0);
  task.activeTimerLog = undefined;
  task.timerPausedAt = undefined;
  task.timerStatus = 'completed';

  await logActivity({
    actor: userId,
    action: 'task_timer_completed',
    entityType: 'task',
    entityId: task._id,
    project: task.project,
    title: `Task timer completed: ${task.title}`,
    detail: `${Math.floor(Number(activeLog.duration || 0) / 60)} minutes were logged before completion.`,
    tone: 'emerald',
    link: `/projects/${task.project}`,
    metadata: {
      taskTitle: task.title,
      duration: Number(activeLog.duration || 0),
    },
  });
}

async function canAccessTask(req, task) {
  if (['superadmin', 'admin'].includes(req.user?.role)) {
    return true;
  }

  const userId = String(req.user?.id);
  const assigneeId = String(task.assignee?._id || task.assignee);
  const reporterId = String(task.reporter?._id || task.reporter || task.createdBy?._id || task.createdBy);
  const assignedTeam = Array.isArray(task.assignedTeam) ? task.assignedTeam : [];
  const isTeamMember = assignedTeam.some((member) => String(member?._id || member) === userId);
  const taskTeam = task.team && typeof task.team === 'object' ? task.team : null;
  let isAssignedTeamMember = Array.isArray(taskTeam?.members) && taskTeam.members.some((member) => String(member?._id || member) === userId);
  if (!isAssignedTeamMember && task.team && !taskTeam) {
    isAssignedTeamMember = Boolean(await Team.exists({ _id: task.team, members: userId }));
  }

  return userId === assigneeId || userId === reporterId || isTeamMember || isAssignedTeamMember;
}

const listTasks = asyncHandler(async (req, res) => {
  const scoped = await buildTaskFilter(req);
  if (scoped.error) {
    return res.status(scoped.code || 400).json({ success: false, message: scoped.error });
  }

  const { filter } = scoped;
  const limit = parseTaskLimit(req.query.limit);
  const total = await Task.countDocuments(filter);
  const tasks = await populateTaskRelations(
    Task.find(filter)
      .sort({ order: 1, dueDate: 1, createdAt: -1 })
      .limit(limit),
  );

  const serializedTasks = await serializeTasksWithRequests(tasks);

  return res.json({
    success: true,
    data: {
      tasks: serializedTasks,
      total,
      limit,
      hasMore: total > limit,
      scope: scoped.scope.type,
    },
  });
});

const getMyTasks = asyncHandler(async (req, res) => {
  const limit = parseTaskLimit(req.query.limit);
  const teamIds = await getUserTeamIds(req.user.id);
  const filter = {
    $or: [
      { assignee: req.user.id },
      { reporter: req.user.id },
      { assignedTeam: req.user.id },
      ...(teamIds.length ? [{ team: { $in: teamIds } }] : []),
    ],
  };
  const total = await Task.countDocuments(filter);
  const tasks = await populateTaskRelations(
    Task.find(filter)
      .sort({ dueDate: 1, order: 1 })
      .limit(limit),
  );

  const serializedTasks = await serializeTasksWithRequests(tasks);

  return res.json({
    success: true,
    data: {
      tasks: serializedTasks,
      total,
      limit,
      hasMore: total > limit,
      scope: 'mine',
    },
  });
});

const getTaskById = asyncHandler(async (req, res) => {
  const task = await populateTaskRelations(Task.findById(req.params.id));

  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  if (!(await canAccessTask(req, task))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const [serializedTask] = await serializeTasksWithRequests([task]);

  return res.json({
    success: true,
    data: serializedTask,
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
    reporter: req.body.reporter || req.user?.id || null,
  });

  const populated = await populateTaskRelations(Task.findById(task._id));

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
  const [serializedTask] = await serializeTasksWithRequests([populated]);
  emitToProject(populated.project?._id || populated.project, 'task:created', serializedTask);
  emitToAll('task:created', serializedTask);
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
    data: serializedTask,
  });
});

const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  const userId = String(req.user?.id);
  const assigneeId = String(task.assignee);
  const reporterId = String(task.reporter || task.createdBy || '');
  const teamMatch = Array.isArray(task.assignedTeam) && task.assignedTeam.some((member) => String(member) === userId);
  const teamMemberMatch = task.team ? await Team.exists({ _id: task.team, members: userId }) : false;
  if (req.user?.role === 'employee' && userId !== assigneeId && userId !== reporterId && !teamMatch && !teamMemberMatch) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const previousStatus = task.status;
  Object.assign(task, normalizeTaskInput(req.body, task));
  if (req.body.stage !== undefined) {
    const resolvedStage = await resolveStageForProject(task.project, req.body.stage);
    if (!resolvedStage && req.body.stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
    task.stage = resolvedStage?._id || null;
  }
  if (task.status === 'done' && previousStatus !== 'done') {
    await finishBudgetedTimerForTask(task, req.user?.id || null);
  }
  if (task.status === 'done') {
    task.timerStatus = 'completed';
    task.timerPausedAt = undefined;
  } else if (task.estimatedDurationMinutes && task.timerStatus === 'completed') {
    task.timerStatus = getEffectiveTimerStatus(task) === 'expired' ? 'expired' : 'not_started';
  }
  await task.save();

  const populated = await populateTaskRelations(Task.findById(task._id));

  const [serializedTask] = await serializeTasksWithRequests([populated]);
  emitToProject(populated.project?._id || populated.project, 'task:updated', serializedTask);
  emitToAll('task:updated', serializedTask);
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
    data: serializedTask,
  });
});

const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  await task.deleteOne();
  emitToProject(task.project, 'task:deleted', { id: String(task._id), projectId: String(task.project || '') });
  emitToAll('task:deleted', { id: String(task._id), projectId: String(task.project || '') });
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

const getTaskCounts = asyncHandler(async (req, res) => {
  const scoped = await buildTaskFilter(req);
  if (scoped.error) {
    return res.status(scoped.code || 400).json({ success: false, message: scoped.error });
  }

  const match = scoped.filter;
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const [totals, byStatusRows, byPriorityRows] = await Promise.all([
    Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: {
            $sum: {
              $cond: [{ $ne: ['$status', 'done'] }, 1, 0],
            },
          },
          done: {
            $sum: {
              $cond: [{ $eq: ['$status', 'done'] }, 1, 0],
            },
          },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'done'] },
                    { $ne: ['$dueDate', null] },
                    { $lt: ['$dueDate', now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          dueSoon: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', 'done'] },
                    { $ne: ['$dueDate', null] },
                    { $gte: ['$dueDate', now] },
                    { $lte: ['$dueDate', dueSoon] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    Task.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Task.aggregate([
      { $match: match },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const byStatus = byStatusRows.reduce((acc, row) => {
    acc[row._id || 'todo'] = row.count;
    return acc;
  }, {});
  const byPriority = byPriorityRows.reduce((acc, row) => {
    acc[row._id || 'Medium'] = row.count;
    return acc;
  }, {});
  const counts = totals[0] || {
    total: 0,
    open: 0,
    done: 0,
    overdue: 0,
    dueSoon: 0,
  };

  return res.json({
    success: true,
    data: {
      scope: scoped.scope.type,
      total: counts.total || 0,
      open: counts.open || 0,
      done: counts.done || 0,
      overdue: counts.overdue || 0,
      dueSoon: counts.dueSoon || 0,
      byStatus,
      byPriority,
    },
  });
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

  const populated = await populateTaskRelations(
    Task.findById(task._id).populate('comments.user', 'name email role avatar employeeId designation department'),
  );

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
    data: (await serializeTasksWithRequests([populated]))[0],
  });
});

const createTimeExtensionRequest = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  if (!(await canAccessTask(req, task))) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const reason = String(req.body.reason || '').trim();
  const requestedMinutes = toPositiveMinutes(req.body.requestedMinutes, 0);
  if (!reason) {
    return res.status(400).json({ success: false, message: 'A valid reason is required' });
  }
  if (!requestedMinutes) {
    return res.status(400).json({ success: false, message: 'Requested minutes must be greater than zero' });
  }

  const effectiveStatus = getEffectiveTimerStatus(task);
  if (!task.estimatedDurationMinutes || effectiveStatus !== 'expired') {
    return res.status(400).json({ success: false, message: 'Extra time can be requested only after the task timer expires' });
  }

  const existingPending = await TaskTimeExtensionRequest.findOne({
    task: task._id,
    employee: req.user.id,
    status: 'pending',
  });
  if (existingPending) {
    return res.status(409).json({ success: false, message: 'An extra-time request is already pending' });
  }

  task.timerStatus = 'expired';
  await task.save();

  const request = await TaskTimeExtensionRequest.create({
    task: task._id,
    employee: req.user.id,
    requestedMinutes,
    reason,
  });

  const approver = task.reporter || task.createdBy;
  if (approver && String(approver) !== String(req.user.id)) {
    await createNotification({
      recipient: approver,
      sender: req.user.id,
      type: 'time_extension_requested',
      title: 'Extra time requested',
      message: `${task.title} needs ${requestedMinutes} more minutes`,
      link: `/projects/${task.project}`,
      metadata: {
        taskId: task._id,
        taskTitle: task.title,
        projectId: task.project,
      },
    });
  }

  await logActivity({
    actor: req.user.id,
    action: 'time_extension_requested',
    entityType: 'task',
    entityId: task._id,
    project: task.project,
    title: `Extra time requested: ${task.title}`,
    detail: reason,
    tone: 'amber',
    link: `/projects/${task.project}`,
    metadata: {
      taskTitle: task.title,
      requestedMinutes,
    },
  });

  return res.status(201).json({
    success: true,
    message: 'Extra-time request submitted',
    data: serializeTimeExtensionRequest(await TaskTimeExtensionRequest.findById(request._id).populate('employee', 'name email role avatar employeeId')),
  });
});

const listPendingTimeExtensionRequests = asyncHandler(async (req, res) => {
  const query = { status: 'pending' };

  const requests = await TaskTimeExtensionRequest.find(query)
    .sort({ createdAt: -1 })
    .populate('employee', 'name email role avatar employeeId')
    .populate({
      path: 'task',
      select: 'title project reporter createdBy assignee timerExpiresAt timerStatus estimatedDurationMinutes',
      populate: [
        { path: 'project', select: 'projectName clientName' },
        { path: 'reporter', select: 'name email role avatar employeeId' },
        { path: 'createdBy', select: 'name email role avatar employeeId' },
        { path: 'assignee', select: 'name email role avatar employeeId' },
      ],
    });

  const visible = requests.filter((request) => {
    const task = request.task || {};
    return canApproveTimeExtension(req.user, task);
  });

  return res.json({
    success: true,
    data: visible.map(serializeTimeExtensionRequest),
  });
});

async function decideTimeExtensionRequest(req, res, status) {
  const request = await TaskTimeExtensionRequest.findById(req.params.requestId).populate('task');
  if (!request) {
    return res.status(404).json({ success: false, message: 'Extra-time request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Request has already been decided' });
  }

  const task = request.task;
  if (!canApproveTimeExtension(req.user, task)) {
    return res.status(403).json({ success: false, message: 'Only the task raiser or assigned owner can approve or reject this request' });
  }

  request.status = status;
  request.decisionNote = String(req.body.decisionNote || '').trim();
  request.decidedAt = new Date();
  if (status === 'approved') {
    request.approvedBy = req.user.id;
    const grantedMinutes = toPositiveMinutes(req.body.grantedMinutes, request.requestedMinutes);
    const baseTime = task.timerExpiresAt && new Date(task.timerExpiresAt).getTime() > Date.now()
      ? new Date(task.timerExpiresAt).getTime()
      : Date.now();
    task.timerExpiresAt = new Date(baseTime + grantedMinutes * 60 * 1000);
    task.extraTimeMinutesGranted = Number(task.extraTimeMinutesGranted || 0) + grantedMinutes;
    task.timerStatus = 'extended';
    await task.save();
  } else {
    request.rejectedBy = req.user.id;
  }
  await request.save();

  await createNotification({
    recipient: request.employee,
    sender: req.user.id,
    type: status === 'approved' ? 'time_extension_approved' : 'time_extension_rejected',
    title: status === 'approved' ? 'Extra time approved' : 'Extra time rejected',
    message: status === 'approved'
      ? `${task.title} was extended by ${toPositiveMinutes(req.body.grantedMinutes, request.requestedMinutes)} minutes`
      : `${task.title} extra-time request was rejected`,
    link: '/my-tasks',
    metadata: {
      taskId: task._id,
      taskTitle: task.title,
      projectId: task.project,
    },
  });

  emitToProject(task.project, 'task:time-extension', { taskId: task._id, requestId: request._id, status });
  emitToAll('task:time-extension', { taskId: task._id, requestId: request._id, status });

  return res.json({
    success: true,
    message: status === 'approved' ? 'Extra time approved' : 'Extra time rejected',
    data: serializeTimeExtensionRequest(
      await TaskTimeExtensionRequest.findById(request._id)
        .populate('employee', 'name email role avatar employeeId')
        .populate('approvedBy', 'name email role avatar employeeId')
        .populate('rejectedBy', 'name email role avatar employeeId'),
    ),
  });
}

const approveTimeExtensionRequest = asyncHandler((req, res) => decideTimeExtensionRequest(req, res, 'approved'));
const rejectTimeExtensionRequest = asyncHandler((req, res) => decideTimeExtensionRequest(req, res, 'rejected'));

module.exports = {
  listTasks,
  getMyTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  addComment,
  getTaskCounts,
  createTimeExtensionRequest,
  listPendingTimeExtensionRequests,
  approveTimeExtensionRequest,
  rejectTimeExtensionRequest,
  serializeTask,
  serializeTasksWithRequests,
};
