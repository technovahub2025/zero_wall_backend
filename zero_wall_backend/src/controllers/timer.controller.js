const asyncHandler = require('../utils/asyncHandler');
const TimerLog = require('../models/TimerLog');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Stage = require('../models/Stage');

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

  if (taskId) {
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
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

  const populated = await TimerLog.findById(log._id)
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  return res.status(201).json({
    success: true,
    message: 'Timer started',
    data: serializeTimerLog(populated),
  });
});

const stopTimer = asyncHandler(async (req, res) => {
  const active = await TimerLog.findOne({ user: req.user.id, isActive: true }).sort({ createdAt: -1 });

  if (!active) {
    return res.status(404).json({ success: false, message: 'No active timer found' });
  }

  active.endTime = new Date();
  active.isActive = false;
  await active.save();
  await addDurationToTask(active.task, active.duration);

  const populated = await TimerLog.findById(active._id)
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  return res.json({
    success: true,
    message: 'Timer stopped',
    data: serializeTimerLog(populated),
  });
});

const getActiveTimer = asyncHandler(async (req, res) => {
  const active = await TimerLog.findOne({ user: req.user.id, isActive: true })
    .sort({ createdAt: -1 })
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  if (!active) {
    return res.json({ success: true, data: null });
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000));

  return res.json({
    success: true,
    data: {
      ...serializeTimerLog(active),
      elapsedSeconds,
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

  const populated = await TimerLog.findById(log._id)
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId');

  return res.status(201).json({
    success: true,
    message: 'Manual log created',
    data: serializeTimerLog(populated),
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
