const asyncHandler = require('../utils/asyncHandler');
const TimerLog = require('../models/TimerLog');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const Team = require('../models/Team');
const TaskTimeExtensionRequest = require('../models/TaskTimeExtensionRequest');
const { emitToAll } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');
const { defaultBillableFromProject } = require('../utils/timesheet');

function getTimerLogAction(log = {}) {
  if (log.isManual) return { action: 'manual', actionLabel: 'Manual entry' };
  if (log.switchFromLog) return { action: 'switched_to', actionLabel: 'Switched to task' };
  if (log.switchToTask) return { action: 'switched_from', actionLabel: 'Switched from task' };
  if (log.pausedAt) return { action: 'paused', actionLabel: 'Paused' };
  if (log.endTime) return { action: 'stopped', actionLabel: 'Stopped' };
  return { action: 'started', actionLabel: 'Started' };
}

function getTimerLogReason(log = {}) {
  return String(log.switchReason || log.note || '').trim();
}

function serializeTimerLog(log) {
  const item = log.toObject ? log.toObject({ virtuals: true }) : log;
  const actionMeta = getTimerLogAction(item);
  return {
    id: item._id,
    user: item.user,
    task: item.task,
    project: item.project,
    stage: item.stage,
    startTime: item.startTime,
    endTime: item.endTime,
    pausedAt: item.pausedAt,
    duration: item.duration || 0,
    note: item.note || '',
    reason: getTimerLogReason(item),
    ...actionMeta,
    switchReason: item.switchReason || '',
    switchFromLog: item.switchFromLog,
    switchFromTask: item.switchFromTask,
    switchToTask: item.switchToTask,
    date: item.date,
    isManual: item.isManual,
    isBillable: item.isBillable,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function addDurationToTask(taskId, durationSeconds) {
  if (!taskId || !durationSeconds) return;
  await Task.updateOne({ _id: taskId }, { $inc: { totalTimeLogged: durationSeconds } });
}

function getTaskBudgetSeconds(task) {
  const estimated = (Number(task?.estimatedDurationMinutes || 0) + Number(task?.extraTimeMinutesGranted || 0)) * 60;
  return Math.max(0, Math.floor(estimated));
}

function getTaskRemainingBudgetSeconds(task) {
  const budgetSeconds = getTaskBudgetSeconds(task);
  if (!budgetSeconds) return 0;
  const loggedSeconds = Math.max(0, Number(task?.totalTimeLogged || 0));
  return Math.max(0, budgetSeconds - loggedSeconds);
}

function buildTimerStatus(task) {
  const rawStatus = task.timerStatus || 'not_started';
  if (task.status === 'done' || rawStatus === 'completed') return 'completed';
  if (rawStatus === 'paused') return 'paused';
  if (task.timerExpiresAt && ['running', 'extended'].includes(rawStatus) && new Date(task.timerExpiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return rawStatus;
}

function getEffectiveTimerStatus(task) {
  return buildTimerStatus(task);
}

async function isBudgetedTimerLocked(log) {
  if (!log?.task) return false;
  const task = await Task.findById(log.task).select('estimatedDurationMinutes timerStatus status activeTimerLog');
  return Boolean(task?.estimatedDurationMinutes && task.status !== 'done' && String(task.activeTimerLog || '') === String(log._id));
}

async function subtractDurationFromTask(taskId, durationSeconds) {
  if (!taskId || !durationSeconds) return;
  await Task.updateOne(
    { _id: taskId },
    { $inc: { totalTimeLogged: -Math.abs(durationSeconds) } },
  );
}

function serializePausedTask(task) {
  const doc = task.toObject ? task.toObject({ virtuals: true }) : task;
  const timerStatus = buildTimerStatus(doc);
  const remainingSeconds = timerStatus === 'paused'
    ? getTaskRemainingBudgetSeconds(doc)
    : timerStatus === 'running' || timerStatus === 'extended'
      ? Math.max(0, Math.floor((new Date(doc.timerExpiresAt).getTime() - Date.now()) / 1000))
      : getTaskRemainingBudgetSeconds(doc);

  return {
    id: doc._id,
    title: doc.title,
    project: doc.project,
    stage: doc.stage,
    assignee: doc.assignee,
    timerStartedAt: doc.timerStartedAt,
    timerPausedAt: doc.timerPausedAt,
    timerExpiresAt: doc.timerExpiresAt,
    timerStatus,
    estimatedDurationMinutes: Number(doc.estimatedDurationMinutes || 0),
    totalTimeLogged: Number(doc.totalTimeLogged || 0),
    remainingSeconds,
    projectName: doc.project?.projectName || '',
    stageName: doc.stage?.stageName || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function getPausedTasksForUser(userId) {
  const teamIds = await Team.find({ members: userId }).select('_id');
  const filter = {
    timerStatus: 'paused',
    status: { $ne: 'done' },
    $or: [
      { assignee: userId },
      { reporter: userId },
      { createdBy: userId },
      { assignedTeam: userId },
      ...(teamIds.length ? [{ team: { $in: teamIds.map((team) => team._id) } }] : []),
    ],
  };

  const tasks = await Task.find(filter)
    .sort({ timerPausedAt: -1, updatedAt: -1 })
    .populate('project', 'projectName clientName overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('assignee', 'name email role avatar employeeId');

  return tasks.map(serializePausedTask);
}

function normalizeDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function groupLogsByDate(logs) {
  return logs.reduce((acc, log) => {
    const key = formatDateKey(log.date || log.startTime);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(log);
    return acc;
  }, {});
}

function buildDailySummary(logs) {
  const summary = {};
  logs.forEach((log) => {
    const key = formatDateKey(log.date || log.startTime);
    summary[key] = (summary[key] || 0) + Number(log.duration || 0);
  });
  return Object.entries(summary)
    .map(([date, duration]) => ({ date, duration }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function populateTimerLogById(logId) {
  return TimerLog.findById(logId)
    .populate('task', 'title status project stage totalTimeLogged estimatedDurationMinutes timerStartedAt timerExpiresAt timerPausedAt timerStatus extraTimeMinutesGranted activeTimerLog')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');
}

async function pauseActiveTimer(active, { reason = '', switchToTask = null } = {}) {
  if (!active) return null;

  active.endTime = new Date();
  active.pausedAt = active.endTime;
  active.isActive = false;
  active.note = reason || active.note || '';
  active.switchReason = reason || active.switchReason || '';
  if (switchToTask) {
    active.switchToTask = switchToTask;
  }
  await active.save();

  const sourceTask = active.task ? await Task.findById(active.task) : null;
  if (sourceTask) {
    sourceTask.totalTimeLogged = Number(sourceTask.totalTimeLogged || 0) + Number(active.duration || 0);
    sourceTask.timerPausedAt = active.endTime;
    sourceTask.timerStatus = Number(sourceTask.estimatedDurationMinutes || 0) > 0 ? 'paused' : 'not_started';
    sourceTask.activeTimerLog = undefined;
    sourceTask.lastPausedTimerLog = active._id;
    sourceTask.timerExpiresAt = undefined;
    await sourceTask.save();
  }

  return active;
}

async function stopActiveTimer(active, { reason = '' } = {}) {
  if (!active) return null;

  active.endTime = new Date();
  active.isActive = false;
  active.note = reason || active.note || '';
  await active.save();

  const sourceTask = active.task ? await Task.findById(active.task) : null;
  if (sourceTask) {
    sourceTask.totalTimeLogged = Number(sourceTask.totalTimeLogged || 0) + Number(active.duration || 0);
    sourceTask.timerPausedAt = undefined;
    sourceTask.timerStatus = sourceTask.status === 'done' ? 'completed' : 'not_started';
    sourceTask.activeTimerLog = undefined;
    sourceTask.lastPausedTimerLog = undefined;
    sourceTask.timerExpiresAt = undefined;
    await sourceTask.save();
  } else {
    await addDurationToTask(active.task, active.duration);
  }

  return active;
}

const startTimer = asyncHandler(async (req, res) => {
  const { taskId, projectId, stageId, note = '' } = req.body;

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  let task = null;
  if (taskId) {
    task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const effectiveStatus = getEffectiveTimerStatus(task);
    if (effectiveStatus === 'expired') {
      const pending = await TaskTimeExtensionRequest.exists({ task: task._id, employee: req.user.id, status: 'pending' });
      return res.status(400).json({
        success: false,
        message: pending ? 'Extra-time request is pending approval' : 'Task timer expired. Request extra time to continue.',
      });
    }
  }

  if (stageId) {
    const stage = await Stage.findById(stageId);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
  }

  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });
  if (active) {
    if (taskId && String(active.task || '') === String(taskId)) {
      const populatedActive = await populateTimerLogById(active._id);
      return res.json({
        success: true,
        message: 'Timer already running',
        data: serializeTimerLog(populatedActive),
      });
    }
    if (await isBudgetedTimerLocked(active)) {
      return res.status(409).json({ success: false, message: 'Use Switch to pause the current task before starting another one' });
    }
    active.endTime = new Date();
    active.isActive = false;
    await active.save();
    await addDurationToTask(active.task, active.duration);
  }

  const effectiveStatus = task ? getEffectiveTimerStatus(task) : 'not_started';
  const remainingSeconds = task ? getTaskRemainingBudgetSeconds(task) : 0;
  if (task && Number(task.estimatedDurationMinutes || 0) > 0 && remainingSeconds <= 0 && effectiveStatus !== 'paused') {
    const pending = await TaskTimeExtensionRequest.exists({ task: task._id, employee: req.user.id, status: 'pending' });
    return res.status(400).json({
      success: false,
      message: pending ? 'Extra-time request is pending approval' : 'Task timer expired. Request extra time to continue.',
    });
  }

  const log = await TimerLog.create({
    user: req.user.id,
    task: taskId || undefined,
    project: projectId,
    stage: stageId || undefined,
    startTime: new Date(),
    note,
    date: normalizeDateOnly(),
    isManual: false,
    isBillable: defaultBillableFromProject(project),
    isActive: true,
  });

  if (task?.estimatedDurationMinutes) {
    if (!task.timerStartedAt) {
      task.timerStartedAt = log.startTime;
    }
    task.timerPausedAt = undefined;
    task.timerExpiresAt = new Date(log.startTime.getTime() + remainingSeconds * 1000);
    task.timerStatus = task.extraTimeMinutesGranted ? 'extended' : 'running';
    task.activeTimerLog = log._id;
    task.lastPausedTimerLog = undefined;
    await task.save();
  }

  const populated = await populateTimerLogById(log._id);

  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:started', serializedLog);

  return res.status(201).json({
    success: true,
    message: 'Timer started',
    data: serializedLog,
  });
});

const switchTimer = asyncHandler(async (req, res) => {
  const { taskId, projectId, stageId, note = '' } = req.body;
  const switchReason = String(note || '').trim();

  if (!taskId || !projectId) {
    return res.status(400).json({ success: false, message: 'Task and project are required' });
  }
  if (!switchReason) {
    return res.status(400).json({ success: false, message: 'A switch reason is required before pausing the current task' });
  }

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const task = await Task.findById(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  if (stageId) {
    const stage = await Stage.findById(stageId);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
  }

  if (getEffectiveTimerStatus(task) === 'expired') {
    const pending = await TaskTimeExtensionRequest.exists({ task: task._id, employee: req.user.id, status: 'pending' });
    return res.status(400).json({
      success: false,
      message: pending ? 'Extra-time request is pending approval' : 'Task timer expired. Request extra time to continue.',
    });
  }

  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });
  if (active && String(active.task || '') === String(taskId)) {
    const populatedActive = await populateTimerLogById(active._id);
    return res.json({
      success: true,
      message: 'Timer already running',
      data: serializeTimerLog(populatedActive),
    });
  }

  if (active) {
    await pauseActiveTimer(active, { reason: switchReason, switchToTask: taskId });
    emitToAll('timer:stopped', serializeTimerLog(await populateTimerLogById(active._id)));
  }

  const log = await TimerLog.create({
    user: req.user.id,
    task: taskId,
    project: projectId,
    stage: stageId || task.stage || undefined,
    startTime: new Date(),
    note,
    date: normalizeDateOnly(),
    isManual: false,
    isBillable: defaultBillableFromProject(project),
    isActive: true,
    resumedFromLog: active?._id || undefined,
    switchFromLog: active?._id || undefined,
    switchReason,
  });

  const remainingSeconds = getTaskRemainingBudgetSeconds(task);
  if (Number(task.estimatedDurationMinutes || 0) > 0) {
    if (!task.timerStartedAt) {
      task.timerStartedAt = log.startTime;
    }
    task.timerPausedAt = undefined;
    task.timerExpiresAt = new Date(log.startTime.getTime() + remainingSeconds * 1000);
    task.timerStatus = task.extraTimeMinutesGranted ? 'extended' : 'running';
    task.activeTimerLog = log._id;
    task.lastPausedTimerLog = undefined;
    await task.save();
  }

  const populated = await populateTimerLogById(log._id);
  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:started', serializedLog);

  return res.status(201).json({
    success: true,
    message: active ? 'Timer switched' : 'Timer started',
    data: serializedLog,
  });
});

const resumeTimer = asyncHandler(async (req, res) => {
  const { taskId, projectId, stageId, note = '' } = req.body;

  if (!taskId) {
    return res.status(400).json({ success: false, message: 'Task is required' });
  }

  const task = await Task.findById(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  if (getEffectiveTimerStatus(task) !== 'paused') {
    return res.status(409).json({ success: false, message: 'Task is not paused' });
  }

  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });
  if (active) {
    return res.status(409).json({ success: false, message: 'Stop the current timer before resuming a paused task' });
  }

  const project = projectId ? await Project.findById(projectId) : await Project.findById(task.project);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  if (stageId) {
    const stage = await Stage.findById(stageId);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
  }

  const remainingSeconds = getTaskRemainingBudgetSeconds(task);
  if (remainingSeconds <= 0 && Number(task.estimatedDurationMinutes || 0) > 0) {
    const pending = await TaskTimeExtensionRequest.exists({ task: task._id, employee: req.user.id, status: 'pending' });
    return res.status(400).json({
      success: false,
      message: pending ? 'Extra-time request is pending approval' : 'Task timer expired. Request extra time to continue.',
    });
  }

  const log = await TimerLog.create({
    user: req.user.id,
    task: taskId,
    project: project._id,
    stage: stageId || task.stage || undefined,
    startTime: new Date(),
    note,
    date: normalizeDateOnly(),
    isManual: false,
    isBillable: defaultBillableFromProject(project),
    isActive: true,
    resumedFromLog: task.lastPausedTimerLog || undefined,
  });

  if (Number(task.estimatedDurationMinutes || 0) > 0) {
    if (!task.timerStartedAt) {
      task.timerStartedAt = log.startTime;
    }
    task.timerPausedAt = undefined;
    task.timerExpiresAt = new Date(log.startTime.getTime() + remainingSeconds * 1000);
    task.timerStatus = task.extraTimeMinutesGranted ? 'extended' : 'running';
    task.activeTimerLog = log._id;
    task.lastPausedTimerLog = undefined;
    await task.save();
  }

  const populated = await populateTimerLogById(log._id);
  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:started', serializedLog);

  return res.status(201).json({
    success: true,
    message: 'Timer resumed',
    data: serializedLog,
  });
});

const stopTimer = asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || req.body?.note || '').trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: 'A stop reason is required' });
  }

  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });

  if (!active) {
    return res.status(404).json({ success: false, message: 'No active timer found' });
  }

  await stopActiveTimer(active, { reason });

  if (Number(active.duration || 0) >= 1800) {
    await logActivity({
      actor: req.user.id,
      action: 'timer_warning',
      entityType: 'timer',
      entityId: active._id,
      project: active.project,
      title: 'Timer exceeded 30 minutes',
      detail: `${Math.floor(Number(active.duration || 0) / 60)} minutes were logged on ${active.project ? 'this project' : 'the active task'}.`,
      tone: 'amber',
      link: '/my-timesheets',
      metadata: {
        taskId: active.task ? String(active.task) : null,
        projectId: active.project ? String(active.project) : null,
        duration: Number(active.duration || 0),
      },
    });
  }

  const populated = await TimerLog.findById(active._id)
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:stopped', serializedLog);

  return res.json({
    success: true,
    message: 'Timer stopped',
    data: serializedLog,
  });
});

const pauseTimer = asyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || req.body?.note || '').trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: 'A pause reason is required' });
  }

  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });
  if (!active) {
    return res.status(404).json({ success: false, message: 'No active timer found' });
  }

  await pauseActiveTimer(active, { reason });

  const populated = await populateTimerLogById(active._id);
  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:stopped', serializedLog);

  return res.json({
    success: true,
    message: 'Timer paused',
    data: serializedLog,
  });
});

const getActiveTimer = asyncHandler(async (req, res) => {
  const active = await TimerLog.findOne({ user: req.user.id, isActive: true })
    .sort({ createdAt: -1 })
    .populate('task', 'title status project stage totalTimeLogged estimatedDurationMinutes timerStartedAt timerExpiresAt timerPausedAt timerStatus extraTimeMinutesGranted activeTimerLog')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  const pausedTasks = await getPausedTasksForUser(req.user.id);

  if (!active) {
    return res.json({ success: true, data: { activeLog: null, pausedTasks } });
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000));
  const remainingSeconds = active.task?.timerExpiresAt
    ? Math.floor((new Date(active.task.timerExpiresAt).getTime() - Date.now()) / 1000)
    : null;

  return res.json({
    success: true,
    data: {
      activeLog: {
        ...serializeTimerLog(active),
        elapsedSeconds,
        remainingSeconds,
      },
      elapsedSeconds,
      remainingSeconds,
      pausedTasks,
    },
  });
});

const getMyLogs = asyncHandler(async (req, res) => {
  const { start, end, project, task, taskId, groupByDate } = req.query;
  const filter = { user: req.user.id };
  if (start || end) {
    filter.date = {};
    if (start) filter.date.$gte = normalizeDateOnly(start);
    if (end) filter.date.$lte = normalizeDateOnly(end);
  }
  if (project) filter.project = project;
  if (task || taskId) filter.task = task || taskId;

  const logs = await TimerLog.find(filter)
    .sort({ date: -1, startTime: -1 })
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  const serialized = logs.map(serializeTimerLog);
  const dailySummary = buildDailySummary(serialized);

  return res.json({
    success: true,
    data: {
      logs: serialized,
      grouped: groupByDate === 'true' ? groupLogsByDate(serialized) : groupLogsByDate(serialized),
      dailySummary,
    },
  });
});

const createManualLog = asyncHandler(async (req, res) => {
  const { projectId, taskId, stageId, startTime, endTime, duration, note = '', date } = req.body;

  const project = await Project.findById(projectId);
  if (!project) {
    return res.status(404).json({ success: false, message: 'Project not found' });
  }

  const log = await TimerLog.create({
    user: req.user.id,
    project: projectId,
    task: taskId || undefined,
    stage: stageId || undefined,
    startTime: startTime ? new Date(startTime) : new Date(),
    endTime: endTime ? new Date(endTime) : undefined,
    duration: Number(duration || 0),
    note,
    date: date ? normalizeDateOnly(date) : normalizeDateOnly(),
    isManual: true,
    isBillable: defaultBillableFromProject(project),
    isActive: false,
  });

  if (!log.duration && log.endTime && log.startTime) {
    await log.save();
  }

  await addDurationToTask(log.task, log.duration);

  if (Number(log.duration || 0) >= 1800) {
    await logActivity({
      actor: req.user.id,
      action: 'timer_warning',
      entityType: 'timer',
      entityId: log._id,
      project: log.project,
      title: 'Manual timer entry exceeded 30 minutes',
      detail: `${Math.floor(Number(log.duration || 0) / 60)} minutes were logged manually.`,
      tone: 'amber',
      link: '/my-timesheets',
      metadata: {
        taskId: log.task ? String(log.task) : null,
        projectId: log.project ? String(log.project) : null,
        duration: Number(log.duration || 0),
      },
    });
  }

  const populated = await TimerLog.findById(log._id)
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:manual', serializedLog);

  return res.status(201).json({
    success: true,
    message: 'Manual log created',
    data: serializedLog,
  });
});

const deleteTimerLog = asyncHandler(async (req, res) => {
  const log = await TimerLog.findById(req.params.id);
  if (!log) {
    return res.status(404).json({ success: false, message: 'Timer log not found' });
  }

  if (String(log.user) !== String(req.user.id) && !['superadmin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await subtractDurationFromTask(log.task, log.duration);
  await log.deleteOne();
  emitToAll('timer:deleted', { id: String(log._id), projectId: String(log.project || '') });

  return res.json({ success: true, message: 'Timer log deleted' });
});

module.exports = {
  startTimer,
  switchTimer,
  resumeTimer,
  pauseTimer,
  stopTimer,
  getActiveTimer,
  getMyLogs,
  createManualLog,
  deleteTimerLog,
  serializeTimerLog,
  groupLogsByDate,
  buildDailySummary,
};

