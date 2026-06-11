const asyncHandler = require('../utils/asyncHandler');
const TimerLog = require('../models/TimerLog');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const TaskTimeExtensionRequest = require('../models/TaskTimeExtensionRequest');
const { emitToAll } = require('../config/socket');
const { logActivity } = require('../utils/logActivity');

function serializeTimerLog(log) {
  const item = log.toObject ? log.toObject({ virtuals: true }) : log;
  return {
    id: item._id,
    user: item.user,
    task: item.task,
    project: item.project,
    stage: item.stage,
    startTime: item.startTime,
    endTime: item.endTime,
    duration: item.duration || 0,
    note: item.note || '',
    date: item.date,
    isManual: item.isManual,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function addDurationToTask(taskId, durationSeconds) {
  if (!taskId || !durationSeconds) return;
  await Task.updateOne({ _id: taskId }, { $inc: { totalTimeLogged: durationSeconds } });
}

function getEffectiveTimerStatus(task) {
  const rawStatus = task.timerStatus || 'not_started';
  if (task.status === 'done' || rawStatus === 'completed') return 'completed';
  if (task.timerExpiresAt && ['running', 'extended'].includes(rawStatus) && new Date(task.timerExpiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return rawStatus;
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
    if (await isBudgetedTimerLocked(active)) {
      if (taskId && String(active.task || '') === String(taskId)) {
        const populatedActive = await TimerLog.findById(active._id)
          .populate('task', 'title status project stage totalTimeLogged estimatedDurationMinutes timerStartedAt timerExpiresAt timerStatus extraTimeMinutesGranted activeTimerLog')
          .populate('project', 'projectName clientName currentStage overallStatus')
          .populate('stage', 'stageName stageNo')
          .populate('user', 'name avatar role employeeId');
        return res.json({
          success: true,
          message: 'Timer already running',
          data: serializeTimerLog(populatedActive),
        });
      }
      return res.status(409).json({ success: false, message: 'Complete the active budgeted task before switching timers' });
    }
    active.endTime = new Date();
    active.isActive = false;
    await active.save();
    await addDurationToTask(active.task, active.duration);
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
    isActive: true,
  });

  if (task?.estimatedDurationMinutes) {
    if (!task.timerStartedAt) {
      task.timerStartedAt = log.startTime;
      task.timerExpiresAt = new Date(log.startTime.getTime() + Number(task.estimatedDurationMinutes || 0) * 60 * 1000);
    }
    task.timerStatus = getEffectiveTimerStatus(task) === 'expired' ? 'expired' : task.extraTimeMinutesGranted ? 'extended' : 'running';
    task.activeTimerLog = log._id;
    await task.save();
  }

  const populated = await TimerLog.findById(log._id)
    .populate('task', 'title status project stage totalTimeLogged estimatedDurationMinutes timerStartedAt timerExpiresAt timerStatus extraTimeMinutesGranted activeTimerLog')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  const serializedLog = serializeTimerLog(populated);
  emitToAll('timer:started', serializedLog);

  return res.status(201).json({
    success: true,
    message: 'Timer started',
    data: serializedLog,
  });
});

const stopTimer = asyncHandler(async (req, res) => {
  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });

  if (!active) {
    return res.status(404).json({ success: false, message: 'No active timer found' });
  }

  if (await isBudgetedTimerLocked(active)) {
    return res.status(409).json({ success: false, message: 'Budgeted task timers cannot be stopped manually. Complete the task to end the timer.' });
  }

  active.endTime = new Date();
  active.isActive = false;
  await active.save();
  await addDurationToTask(active.task, active.duration);

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

const getActiveTimer = asyncHandler(async (req, res) => {
  const active = await TimerLog.findOne({ user: req.user.id, isActive: true })
    .sort({ createdAt: -1 })
    .populate('task', 'title status project stage totalTimeLogged estimatedDurationMinutes timerStartedAt timerExpiresAt timerStatus extraTimeMinutesGranted activeTimerLog')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  if (!active) {
    return res.json({ success: true, data: null });
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000));
  const remainingSeconds = active.task?.timerExpiresAt
    ? Math.floor((new Date(active.task.timerExpiresAt).getTime() - Date.now()) / 1000)
    : null;

  return res.json({
    success: true,
    data: {
      ...serializeTimerLog(active),
      elapsedSeconds,
      remainingSeconds,
    },
  });
});

const getMyLogs = asyncHandler(async (req, res) => {
  const { start, end, project, groupByDate } = req.query;
  const filter = { user: req.user.id };
  if (start || end) {
    filter.date = {};
    if (start) filter.date.$gte = normalizeDateOnly(start);
    if (end) filter.date.$lte = normalizeDateOnly(end);
  }
  if (project) filter.project = project;

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
  stopTimer,
  getActiveTimer,
  getMyLogs,
  createManualLog,
  deleteTimerLog,
  serializeTimerLog,
  groupLogsByDate,
  buildDailySummary,
};
