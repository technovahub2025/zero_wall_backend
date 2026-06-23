const TimerLog = require('../models/TimerLog');
const Task = require('../models/Task');
const Project = require('../models/Project');
const TimesheetFilter = require('../models/TimesheetFilter');
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/logActivity');
const { serializeTimerLog } = require('./timer.controller');
const {
  addDays,
  defaultBillableFromProject,
  endOfDay,
  escapeRegex,
  formatDateKey,
  formatDurationSeconds,
  formatMinutesClock,
  normalizeIdList,
  resolveTimesheetRange,
  startOfDay,
  startOfWeek,
  toDateFilter,
} = require('../utils/timesheet');

function normalizeFilterValue(value) {
  const text = String(value || '').trim();
  return text && text !== 'all' ? text : '';
}

function toObjectId(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : value;
}

function castFilterForAggregate(filter = {}) {
  const casted = { ...filter };
  ['user', 'project', 'task', 'stage'].forEach((field) => {
    if (!casted[field]) return;
    if (casted[field]?.$in) {
      casted[field] = { ...casted[field], $in: casted[field].$in.map(toObjectId) };
      return;
    }
    casted[field] = toObjectId(casted[field]);
  });
  if (Array.isArray(casted.$or)) {
    casted.$or = casted.$or.map((clause) => castFilterForAggregate(clause));
  }
  return casted;
}

function getPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedLimit = Number.parseInt(query.limit || query.pageSize, 10) || 50;
  const limit = Math.min(100, Math.max(10, requestedLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function buildBasicFilter(query = {}, targetUserId) {
  const filter = {};
  if (targetUserId) {
    filter.user = targetUserId;
  }

  const project = normalizeFilterValue(query.project);
  if (project) filter.project = project;

  const task = normalizeFilterValue(query.task);
  if (task) filter.task = task;

  const type = String(query.type || query.entryType || 'all').trim().toLowerCase();
  if (type === 'manual') filter.isManual = true;
  if (type === 'automatic') filter.isManual = false;

  const billable = String(query.billable || 'all').trim().toLowerCase();
  if (['billable', 'true', '1'].includes(billable)) filter.isBillable = true;
  if (['non-billable', 'nonbillable', 'false', '0'].includes(billable)) filter.isBillable = false;

  return filter;
}

async function buildTimesheetFilter(query = {}, targetUserId) {
  const range = resolveTimesheetRange(query);
  const baseFilter = buildBasicFilter(query, targetUserId);

  const search = String(query.search || '').trim();
  let searchTaskIds = [];
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const matchedTasks = await Task.find({ title: regex }).select('_id').lean();
    searchTaskIds = matchedTasks.map((task) => String(task._id));
    const searchClauses = [{ note: regex }, { switchReason: regex }];
    if (searchTaskIds.length) {
      searchClauses.push({ task: { $in: searchTaskIds } });
    }
    baseFilter.$or = searchClauses;
  }

  return { baseFilter, range, searchTaskIds };
}

function buildPreviousRange(range) {
  if (!range?.start || !range?.end) return null;
  const start = new Date(range.start);
  const end = new Date(range.end);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const previousStart = startOfDay(addDays(start, -spanDays));
  const previousEnd = endOfDay(addDays(start, -1));
  return { start: previousStart, end: previousEnd };
}

function createEmptyBucket(dateKey, dateValue) {
  return {
    date: dateKey,
    dateValue,
    durationSeconds: 0,
    billableSeconds: 0,
    entries: 0,
    tasks: new Set(),
    projects: new Set(),
    startMinutesTotal: 0,
    startMinutesCount: 0,
  };
}

function getEntityId(value) {
  if (!value) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function buildDerivedMaps(logs = []) {
  const dailyMap = new Map();
  const projectMap = new Map();
  const taskMap = new Map();
  const weekdayMap = new Map();

  let totalSeconds = 0;
  let billableSeconds = 0;
  let totalEntries = 0;
  let startMinutesTotal = 0;
  let startMinutesCount = 0;

  logs.forEach((log) => {
    const seconds = Number(log.duration || 0);
    const dateValue = new Date(log.date || log.startTime || log.createdAt || Date.now());
    const key = formatDateKey(dateValue);
    const weekKey = formatDateKey(startOfWeek(dateValue));
    const weekdayIndex = dateValue.getDay();
    const startDate = log.startTime ? new Date(log.startTime) : null;

    totalSeconds += seconds;
    totalEntries += 1;
    if (log.isBillable) billableSeconds += seconds;
    const projectId = getEntityId(log.project);
    const taskId = getEntityId(log.task);

    if (!dailyMap.has(key)) dailyMap.set(key, createEmptyBucket(key, dateValue));
    const dayBucket = dailyMap.get(key);
    dayBucket.durationSeconds += seconds;
    dayBucket.billableSeconds += log.isBillable ? seconds : 0;
    dayBucket.entries += 1;
    if (taskId) dayBucket.tasks.add(taskId);
    if (projectId) dayBucket.projects.add(projectId);
    if (startDate && !Number.isNaN(startDate.getTime())) {
      const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
      dayBucket.startMinutesTotal += startMinutes;
      dayBucket.startMinutesCount += 1;
      startMinutesTotal += startMinutes;
      startMinutesCount += 1;
    }

    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, {
        id: projectId,
        label: log.projectName || 'Project',
        clientName: log.clientName || '',
        durationSeconds: 0,
        billableSeconds: 0,
        entries: 0,
      });
    }
    if (projectId) {
      const projectBucket = projectMap.get(projectId);
      projectBucket.durationSeconds += seconds;
      projectBucket.billableSeconds += log.isBillable ? seconds : 0;
      projectBucket.entries += 1;
      if (log.projectName) projectBucket.label = log.projectName;
      if (log.clientName) projectBucket.clientName = log.clientName;
    }

    if (!taskMap.has(taskId)) {
      taskMap.set(taskId, {
        id: taskId,
        label: log.taskTitle || 'Task',
        projectName: log.projectName || '',
        durationSeconds: 0,
        billableSeconds: 0,
        entries: 0,
      });
    }
    if (taskId) {
      const taskBucket = taskMap.get(taskId);
      taskBucket.durationSeconds += seconds;
      taskBucket.billableSeconds += log.isBillable ? seconds : 0;
      taskBucket.entries += 1;
      if (log.taskTitle) taskBucket.label = log.taskTitle;
      if (log.projectName) taskBucket.projectName = log.projectName;
    }

    if (!weekdayMap.has(weekdayIndex)) {
      weekdayMap.set(weekdayIndex, { dayIndex: weekdayIndex, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayIndex], durationSeconds: 0, entries: 0 });
    }
    const weekdayBucket = weekdayMap.get(weekdayIndex);
    weekdayBucket.durationSeconds += seconds;
    weekdayBucket.entries += 1;
  });

  const dailySummary = [...dailyMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      date: item.date,
      duration: Number(item.durationSeconds || 0),
      entries: Number(item.entries || 0),
      tasks: item.tasks.size,
      projects: item.projects.size,
      billable: Number(item.billableSeconds || 0),
      averageStartMinutes: item.startMinutesCount ? item.startMinutesTotal / item.startMinutesCount : 0,
    }));

  const projectRows = [...projectMap.values()]
    .filter((item) => item.id)
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .map((item) => ({
      id: item.id,
      label: item.label,
      clientName: item.clientName,
      duration: Number(item.durationSeconds || 0),
      billable: Number(item.billableSeconds || 0),
      entries: Number(item.entries || 0),
    }));

  const taskRows = [...taskMap.values()]
    .filter((item) => item.id)
    .sort((a, b) => b.durationSeconds - a.durationSeconds)
    .map((item) => ({
      id: item.id,
      label: item.label,
      projectName: item.projectName,
      duration: Number(item.durationSeconds || 0),
      billable: Number(item.billableSeconds || 0),
      entries: Number(item.entries || 0),
    }));

  const weekdayRows = [...weekdayMap.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  const activeDays = dailySummary.filter((item) => item.duration > 0).length;
  const averageHours = dailySummary.length ? totalSeconds / dailySummary.length : 0;
  const peakDay = dailySummary.reduce((best, item) => (item.duration > (best?.duration || 0) ? item : best), null);
  const mostProductiveWeekday = weekdayRows.reduce((best, item) => (item.durationSeconds > (best?.durationSeconds || 0) ? item : best), null);
  const averageStartTime = startMinutesCount ? formatMinutesClock(startMinutesTotal / startMinutesCount) : null;

  return {
    dailySummary,
    projectRows,
    taskRows,
    weekdayRows,
    totals: {
      totalSeconds,
      billableSeconds,
      totalEntries,
      activeDays,
      averageHours,
      peakDay: peakDay
        ? {
            date: peakDay.date,
            duration: Number(peakDay.duration || 0),
            entries: Number(peakDay.entries || 0),
            tasks: Number(peakDay.tasks || 0),
          }
        : null,
    },
    pattern: {
      mostProductiveWeekday: mostProductiveWeekday
        ? {
            dayIndex: mostProductiveWeekday.dayIndex,
            label: mostProductiveWeekday.label,
            duration: Number(mostProductiveWeekday.durationSeconds || 0),
            entries: Number(mostProductiveWeekday.entries || 0),
          }
        : null,
      averageStartTime,
    },
  };
}

function buildTrendRows(dailySummary = [], range = {}) {
  const spanDays = range?.start && range?.end ? Math.max(1, Math.round((new Date(range.end).getTime() - new Date(range.start).getTime()) / (24 * 60 * 60 * 1000)) + 1) : dailySummary.length;
  if (spanDays <= 62) {
    return dailySummary.map((item) => ({
      date: item.date,
      label: item.date,
      duration: Number(item.duration || 0),
      entries: Number(item.entries || 0),
      billable: Number(item.billable || 0),
    }));
  }

  const buckets = new Map();
  dailySummary.forEach((item) => {
    const weekStart = formatDateKey(startOfWeek(item.date));
    if (!buckets.has(weekStart)) {
      buckets.set(weekStart, { date: weekStart, label: weekStart, duration: 0, entries: 0, billable: 0 });
    }
    const bucket = buckets.get(weekStart);
    bucket.duration += Number(item.duration || 0);
    bucket.entries += Number(item.entries || 0);
    bucket.billable += Number(item.billable || 0);
  });

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function buildDerivedAggregates(filter = {}, range = {}) {
  const match = castFilterForAggregate({ ...filter });
  const pipeline = [
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalSeconds: { $sum: { $ifNull: ['$duration', 0] } },
              billableSeconds: { $sum: { $cond: ['$isBillable', { $ifNull: ['$duration', 0] }, 0] } },
              totalEntries: { $sum: 1 },
              activeDaysSet: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$date' } } },
            },
          },
        ],
        daily: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
              duration: { $sum: { $ifNull: ['$duration', 0] } },
              billable: { $sum: { $cond: ['$isBillable', { $ifNull: ['$duration', 0] }, 0] } },
              entries: { $sum: 1 },
              tasks: { $addToSet: '$task' },
              projects: { $addToSet: '$project' },
              averageStartMinutes: {
                $avg: {
                  $add: [
                    { $multiply: [{ $hour: '$startTime' }, 60] },
                    { $minute: '$startTime' },
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        projects: [
          {
            $group: {
              _id: '$project',
              duration: { $sum: { $ifNull: ['$duration', 0] } },
              billable: { $sum: { $cond: ['$isBillable', { $ifNull: ['$duration', 0] }, 0] } },
              entries: { $sum: 1 },
            },
          },
          { $sort: { duration: -1 } },
          { $limit: 5 },
        ],
        tasks: [
          {
            $group: {
              _id: '$task',
              duration: { $sum: { $ifNull: ['$duration', 0] } },
              billable: { $sum: { $cond: ['$isBillable', { $ifNull: ['$duration', 0] }, 0] } },
              entries: { $sum: 1 },
            },
          },
          { $match: { _id: { $ne: null } } },
          { $sort: { duration: -1 } },
          { $limit: 5 },
        ],
        weekdays: [
          {
            $group: {
              _id: { $dayOfWeek: '$date' },
              duration: { $sum: { $ifNull: ['$duration', 0] } },
              entries: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        startTimes: [
          {
            $group: {
              _id: null,
              averageStartMinutes: {
                $avg: {
                  $add: [
                    { $multiply: [{ $hour: '$startTime' }, 60] },
                    { $minute: '$startTime' },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ];

  const [result = {}] = await TimerLog.aggregate(pipeline);
  const totals = result.totals?.[0] || {};
  const dailySummary = (result.daily || []).map((item) => ({
    date: item._id,
    duration: Number(item.duration || 0),
    entries: Number(item.entries || 0),
    tasks: (item.tasks || []).filter(Boolean).length,
    projects: (item.projects || []).filter(Boolean).length,
    billable: Number(item.billable || 0),
    averageStartMinutes: Number(item.averageStartMinutes || 0),
  }));
  const peakDay = dailySummary.reduce((best, item) => (item.duration > (best?.duration || 0) ? item : best), null);

  const projectIds = (result.projects || []).map((item) => item._id).filter(Boolean);
  const taskIds = (result.tasks || []).map((item) => item._id).filter(Boolean);
  const [projectRows, taskRows] = await Promise.all([
    projectIds.length ? Project.find({ _id: { $in: projectIds } }).select('_id projectName clientName invoiceStatus').lean() : [],
    taskIds.length ? Task.find({ _id: { $in: taskIds } }).select('_id title project').lean() : [],
  ]);
  const projectMeta = new Map(projectRows.map((project) => [String(project._id), project]));
  const taskMeta = new Map(taskRows.map((task) => [String(task._id), task]));

  const topProjects = (result.projects || []).filter((item) => item._id).map((item) => {
    const meta = projectMeta.get(String(item._id)) || {};
    return {
      id: String(item._id),
      label: meta.projectName || 'Project',
      clientName: meta.clientName || '',
      duration: Number(item.duration || 0),
      billable: Number(item.billable || 0),
      entries: Number(item.entries || 0),
      hours: Number((Number(item.duration || 0) / 3600).toFixed(1)),
      billableHours: Number((Number(item.billable || 0) / 3600).toFixed(1)),
    };
  });

  const topTasks = (result.tasks || []).filter((item) => item._id).map((item) => {
    const meta = taskMeta.get(String(item._id)) || {};
    return {
      id: String(item._id),
      label: meta.title || 'Task',
      projectName: projectMeta.get(String(meta.project || ''))?.projectName || '',
      duration: Number(item.duration || 0),
      billable: Number(item.billable || 0),
      entries: Number(item.entries || 0),
      hours: Number((Number(item.duration || 0) / 3600).toFixed(1)),
      billableHours: Number((Number(item.billable || 0) / 3600).toFixed(1)),
    };
  });

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mostProductiveWeekday = (result.weekdays || []).reduce((best, item) => (item.duration > (best?.duration || 0) ? item : best), null);
  const totalSeconds = Number(totals.totalSeconds || 0);
  const billableSeconds = Number(totals.billableSeconds || 0);

  return {
    dailySummary,
    summary: {
      totalSeconds,
      billableSeconds,
      totalEntries: Number(totals.totalEntries || 0),
      activeDays: (totals.activeDaysSet || []).filter(Boolean).length,
      averageHours: dailySummary.length ? Number((totalSeconds / dailySummary.length / 3600).toFixed(2)) : 0,
      peakDay: peakDay
        ? {
            date: peakDay.date,
            duration: Number(peakDay.duration || 0),
            entries: Number(peakDay.entries || 0),
            tasks: Number(peakDay.tasks || 0),
          }
        : null,
      billableRate: totalSeconds ? Number(((billableSeconds / totalSeconds) * 100).toFixed(1)) : 0,
    },
    insightsBase: {
      topProjects,
      topTasks,
      productivity: {
        mostProductiveWeekday: mostProductiveWeekday
          ? {
              dayIndex: Number(mostProductiveWeekday._id || 1) - 1,
              label: weekdayLabels[(Number(mostProductiveWeekday._id || 1) - 1) % 7],
              duration: Number(mostProductiveWeekday.duration || 0),
              entries: Number(mostProductiveWeekday.entries || 0),
            }
          : null,
        averageStartTime: result.startTimes?.[0]?.averageStartMinutes ? formatMinutesClock(result.startTimes[0].averageStartMinutes) : null,
      },
    },
    trendRows: buildTrendRows(dailySummary, range),
  };
}

async function buildComparison(baseFilter, range) {
  const previousRange = buildPreviousRange(range);
  if (!previousRange) return null;
  const previousLogs = await TimerLog.find({ ...baseFilter, ...toDateFilter(previousRange) })
    .select('duration isBillable')
    .lean();
  const totalSeconds = previousLogs.reduce((sum, log) => sum + Number(log.duration || 0), 0);
  const billableSeconds = previousLogs.reduce((sum, log) => sum + (log.isBillable ? Number(log.duration || 0) : 0), 0);
  return { totalSeconds, billableSeconds };
}

function calculateChange(currentSeconds, previousSeconds) {
  if (!previousSeconds) {
    return currentSeconds ? 100 : 0;
  }
  return Number((((currentSeconds - previousSeconds) / previousSeconds) * 100).toFixed(1));
}

function buildCsv(rows = []) {
  const header = ['Date', 'Start Time', 'End Time', 'Project', 'Task', 'Action', 'Reason / Comment', 'Duration', 'Billable', 'Manual'];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    const values = [
      row.date,
      row.startTime,
      row.endTime,
      row.project,
      row.task,
      row.action,
      row.reason,
      row.duration,
      row.billable,
      row.manual,
    ].map((value) => {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    });
    lines.push(values.join(','));
  });
  return `${lines.join('\n')}\n`;
}

async function loadTimesheetContext({ targetUserId, query = {} }) {
  const { baseFilter, range } = await buildTimesheetFilter(query, targetUserId);
  const { page, limit, skip } = getPagination(query);
  const fullFilter = { ...baseFilter, ...toDateFilter(range) };
  const optionScopeFilter = targetUserId ? { user: targetUserId } : {};

  const [total, logs, allMatchingRows, aggregateData, optionProjectIds, optionTaskIds] = await Promise.all([
    TimerLog.countDocuments(fullFilter),
    TimerLog.find(fullFilter)
      .sort({ date: -1, startTime: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('task', 'title status project stage totalTimeLogged')
      .populate('project', 'projectName clientName currentStage overallStatus invoiceStatus')
      .populate('stage', 'stageName stageNo')
      .populate('user', 'name avatar role employeeId')
      .lean(),
    TimerLog.find(fullFilter).select('_id').sort({ date: -1, startTime: -1, _id: -1 }).lean(),
    buildDerivedAggregates(fullFilter, range),
    TimerLog.find(optionScopeFilter).distinct('project'),
    TimerLog.find(optionScopeFilter).distinct('task'),
  ]);

  const projectRows = optionProjectIds.length
    ? await Project.find({ _id: { $in: optionProjectIds } }).select('_id projectName clientName invoiceStatus').sort({ projectName: 1 }).lean()
    : [];
  const taskRows = optionTaskIds.length
    ? await Task.find({ _id: { $in: optionTaskIds } }).select('_id title project').sort({ title: 1 }).lean()
    : [];

  const projectMeta = new Map(projectRows.map((project) => [String(project._id), project]));
  const taskMeta = new Map(taskRows.map((task) => [String(task._id), task]));
  const serializedLogs = logs.map((log) => ({
    ...serializeTimerLog(log),
    projectName: projectMeta.get(getEntityId(log.project))?.projectName || '',
    clientName: projectMeta.get(getEntityId(log.project))?.clientName || '',
    taskTitle: taskMeta.get(getEntityId(log.task))?.title || '',
  }));

  const comparison = await buildComparison(baseFilter, range);
  const billableSeconds = aggregateData.summary.billableSeconds;
  const totalSeconds = aggregateData.summary.totalSeconds;
  const previousTotalSeconds = comparison?.totalSeconds || 0;
  const previousBillableSeconds = comparison?.billableSeconds || 0;

  const insights = {
    trendRows: aggregateData.trendRows,
    topProjects: aggregateData.insightsBase.topProjects,
    topTasks: aggregateData.insightsBase.topTasks,
    productivity: aggregateData.insightsBase.productivity,
    utilization: totalSeconds ? Number(((billableSeconds / totalSeconds) * 100).toFixed(1)) : 0,
    comparison: {
      totalChange: calculateChange(totalSeconds, previousTotalSeconds),
      billableChange: calculateChange(billableSeconds, previousBillableSeconds),
      previousTotalSeconds,
      previousBillableSeconds,
    },
  };

  const filterOptions = {
    projects: projectRows.map((project) => ({ value: String(project._id), label: project.projectName, clientName: project.clientName || '', invoiceStatus: project.invoiceStatus || '' })),
    tasks: taskRows.map((task) => ({ value: String(task._id), label: task.title, projectId: String(task.project || '') })),
    entryTypes: [
      { value: 'all', label: 'All entries' },
      { value: 'manual', label: 'Manual' },
      { value: 'automatic', label: 'Automatic' },
    ],
    billableOptions: [
      { value: 'all', label: 'All billability' },
      { value: 'billable', label: 'Billable' },
      { value: 'non-billable', label: 'Non-billable' },
    ],
    presets: [
      { value: 'last-7-days', label: 'Last 7 days' },
      { value: 'last-30-days', label: 'Last 30 days' },
      { value: 'this-month', label: 'This month' },
      { value: 'last-90-days', label: 'Last 90 days' },
    ],
  };

  return {
    total,
    items: serializedLogs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
    allMatchingIds: allMatchingRows.map((row) => String(row._id)),
    summary: aggregateData.summary,
    dailySummary: aggregateData.dailySummary,
    insights,
    filterOptions,
    range,
    allLogs: serializedLogs,
    projectMeta,
    taskMeta,
    filter: fullFilter,
  };
}

function ensureAccess(req, targetUserId) {
  if (String(req.user.id) === String(targetUserId)) return true;
  return ['superadmin', 'admin', 'project_manager'].includes(req.user.role);
}

async function getTimesheets(req, res, targetUserId = req.user.id) {
  if (!ensureAccess(req, targetUserId)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const data = await loadTimesheetContext({ targetUserId, query: req.query });
  return res.json({ success: true, data: { ...data } });
}

const getMyTimesheets = asyncHandler(async (req, res) => getTimesheets(req, res, req.user.id));

const getEmployeeTimesheets = asyncHandler(async (req, res) => getTimesheets(req, res, req.params.id));

const getAllTimesheets = asyncHandler(async (req, res) => {
  if (!['superadmin', 'admin', 'project_manager'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const data = await loadTimesheetContext({ targetUserId: null, query: req.query });
  return res.json({ success: true, data: { ...data } });
});

const listTimesheetFilters = asyncHandler(async (req, res) => {
  const scope = String(req.query.scope || 'mine').trim() === 'employee' ? 'employee' : 'mine';
  const filters = await TimesheetFilter.find({ user: req.user.id, scope }).sort({ updatedAt: -1 }).lean();
  return res.json({ success: true, data: filters.map((item) => ({ ...item, id: item._id })) });
});

const createTimesheetFilter = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const scope = String(req.body.scope || 'mine').trim() === 'employee' ? 'employee' : 'mine';
  const existing = await TimesheetFilter.findOne({ user: req.user.id, scope, name });
  if (existing) {
    return res.status(409).json({ success: false, message: 'A saved filter with this name already exists' });
  }

  const payload = {
    user: req.user.id,
    name,
    scope,
    employee: req.body.employee || req.body.employeeId || undefined,
    preset: String(req.body.preset || '').trim(),
    start: req.body.start ? new Date(req.body.start) : undefined,
    end: req.body.end ? new Date(req.body.end) : undefined,
    project: req.body.project || undefined,
    task: req.body.task || undefined,
    entryType: String(req.body.entryType || 'all').trim(),
    billable: String(req.body.billable || 'all').trim(),
    search: String(req.body.search || '').trim(),
  };
  const filter = await TimesheetFilter.create(payload);
  return res.status(201).json({ success: true, data: { ...filter.toObject(), id: filter._id } });
});

const updateTimesheetFilter = asyncHandler(async (req, res) => {
  const filter = await TimesheetFilter.findOne({ _id: req.params.id, user: req.user.id });
  if (!filter) {
    return res.status(404).json({ success: false, message: 'Filter not found' });
  }

  ['name', 'scope', 'employee', 'preset', 'project', 'task', 'entryType', 'billable', 'search'].forEach((field) => {
    if (req.body[field] !== undefined) {
      filter[field] = req.body[field];
    }
  });

  if (req.body.start !== undefined) filter.start = req.body.start ? new Date(req.body.start) : undefined;
  if (req.body.end !== undefined) filter.end = req.body.end ? new Date(req.body.end) : undefined;

  await filter.save();
  return res.json({ success: true, data: { ...filter.toObject(), id: filter._id } });
});

const deleteTimesheetFilter = asyncHandler(async (req, res) => {
  const filter = await TimesheetFilter.findOneAndDelete({ _id: req.params.id, user: req.user.id });
  if (!filter) {
    return res.status(404).json({ success: false, message: 'Filter not found' });
  }
  return res.json({ success: true, message: 'Filter deleted' });
});

async function resolveBulkTargetLogs(req, targetUserId) {
  const ids = normalizeIdList(req.body.ids || req.body.logIds || req.query.ids);
  if (!ids.length) {
    return [];
  }

  const query = { _id: { $in: ids }, user: targetUserId };
  if (String(req.user.id) !== String(targetUserId) && !['superadmin', 'admin', 'project_manager'].includes(req.user.role)) {
    throw new Error('Forbidden');
  }

  return TimerLog.find(query).lean();
}

function canMutateOtherUsers(req, targetUserId) {
  return String(req.user.id) === String(targetUserId) || ['superadmin', 'admin', 'project_manager'].includes(req.user.role);
}

function validObjectIds(ids = []) {
  return ids.filter((id) => mongoose.isValidObjectId(id));
}

async function bulkUpdateTimesheets(req, res) {
  const targetUserId = req.params?.id || req.user.id;
  if (!canMutateOtherUsers(req, targetUserId)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const ids = normalizeIdList(req.body.ids || req.body.logIds || req.body.selectedIds);
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'No logs selected' });
  }
  const validIds = validObjectIds(ids);
  if (!validIds.length) {
    return res.status(400).json({ success: false, message: 'No valid logs selected' });
  }

  const updates = {};
  if (req.body.isBillable !== undefined) {
    updates.isBillable = Boolean(req.body.isBillable === true || req.body.isBillable === 'true' || req.body.isBillable === 1 || req.body.isBillable === '1');
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, message: 'No valid update provided' });
  }

  const logs = await TimerLog.find({ _id: { $in: validIds }, user: targetUserId }).lean();
  if (!logs.length) {
    return res.status(404).json({ success: false, message: 'Logs not found' });
  }

  const previous = logs.map((log) => ({ id: String(log._id), isBillable: Boolean(log.isBillable), duration: Number(log.duration || 0) }));
  await TimerLog.updateMany({ _id: { $in: logs.map((log) => log._id) } }, { $set: updates });

  try {
    await logActivity({
      actor: req.user.id,
      action: 'timesheet_bulk_update',
      entityType: 'timer',
      entityId: validIds.join(','),
      project: null,
      title: 'Timesheet bulk update',
      detail: `Updated ${logs.length} timesheet log${logs.length === 1 ? '' : 's'}`,
      tone: 'sky',
      link: String(targetUserId) === String(req.user.id) ? '/my-timesheets' : `/employees/${targetUserId}`,
      metadata: {
        targetUserId: String(targetUserId),
        ids: validIds,
        previous,
        updates,
      },
    });
  } catch (error) {
    console.warn('Failed to write timesheet bulk update activity:', error.message);
  }

  return res.json({ success: true, message: 'Timesheets updated', data: { ids: validIds, updates } });
}

async function bulkDeleteTimesheets(req, res) {
  const targetUserId = req.params?.id || req.user.id;
  if (!canMutateOtherUsers(req, targetUserId)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const ids = normalizeIdList(req.body.ids || req.body.logIds || req.body.selectedIds);
  if (!ids.length) {
    return res.status(400).json({ success: false, message: 'No logs selected' });
  }
  const validIds = validObjectIds(ids);
  if (!validIds.length) {
    return res.status(400).json({ success: false, message: 'No valid logs selected' });
  }

  const logs = await TimerLog.find({ _id: { $in: validIds }, user: targetUserId }).lean();
  if (!logs.length) {
    return res.status(404).json({ success: false, message: 'Logs not found' });
  }

  const activeLogs = logs.filter((log) => log.isActive);
  if (activeLogs.length) {
    return res.status(400).json({ success: false, message: 'Active timers cannot be deleted' });
  }

  if (req.body.name !== undefined) {
    const nextName = String(req.body.name || '').trim();
    const nextScope = req.body.scope !== undefined ? (String(req.body.scope || 'mine').trim() === 'employee' ? 'employee' : 'mine') : filter.scope;
    const duplicate = await TimesheetFilter.findOne({
      _id: { $ne: filter._id },
      user: req.user.id,
      scope: nextScope,
      name: nextName,
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'A saved filter with this name already exists' });
    }
  }

  const taskDurationMap = new Map();
  logs.forEach((log) => {
    if (!log.task) return;
    const taskId = String(log.task);
    taskDurationMap.set(taskId, (taskDurationMap.get(taskId) || 0) + Number(log.duration || 0));
  });
  await Promise.all(
    [...taskDurationMap.entries()].map(([taskId, duration]) =>
      Task.updateOne({ _id: taskId }, { $inc: { totalTimeLogged: -Math.abs(duration) } }),
    ),
  );

  await TimerLog.deleteMany({ _id: { $in: validIds }, user: targetUserId });

  try {
    await logActivity({
      actor: req.user.id,
      action: 'timesheet_bulk_delete',
      entityType: 'timer',
      entityId: validIds.join(','),
      project: null,
      title: 'Timesheet bulk delete',
      detail: `Deleted ${logs.length} timesheet log${logs.length === 1 ? '' : 's'}`,
      tone: 'rose',
      link: String(targetUserId) === String(req.user.id) ? '/my-timesheets' : `/employees/${targetUserId}`,
      metadata: {
        targetUserId: String(targetUserId),
        ids: validIds,
        previous: logs.map((log) => ({ id: String(log._id), duration: Number(log.duration || 0), isBillable: Boolean(log.isBillable) })),
      },
    });
  } catch (error) {
    console.warn('Failed to write timesheet bulk delete activity:', error.message);
  }

  return res.json({ success: true, message: 'Timesheets deleted', data: { ids: validIds } });
}

function buildSelectedRows(logs = []) {
  return logs.map((log) => ({
    date: formatDateKey(log.date || log.startTime || log.createdAt),
    startTime: log.startTime ? new Date(log.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
    endTime: log.endTime ? new Date(log.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
    project: log.projectName || log.project?.projectName || '',
    task: log.taskTitle || log.task?.title || '',
    action: log.actionLabel || '',
    reason: log.reason || log.switchReason || log.note || '',
    duration: formatDurationSeconds(log.duration || 0),
    billable: log.isBillable ? 'Yes' : 'No',
    manual: log.isManual ? 'Yes' : 'No',
  }));
}

async function exportTimesheets(req, res) {
  const targetUserId = req.params?.id || req.user.id;
  if (!canMutateOtherUsers(req, targetUserId) && String(req.user.id) !== String(targetUserId)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const selectedIds = normalizeIdList(req.body?.ids || req.query?.ids || req.body?.selectedIds);
  let query = { ...req.query };
  delete query.page;
  delete query.limit;
  delete query.pageSize;

  const { baseFilter, range } = await buildTimesheetFilter(query, targetUserId);
  const filter = { ...baseFilter, ...toDateFilter(range) };
  const validSelectedIds = validObjectIds(selectedIds);
  if (selectedIds.length) {
    if (!validSelectedIds.length) {
      return res.status(400).json({ success: false, message: 'No valid logs selected' });
    }
    filter._id = { $in: validSelectedIds };
  }

  const logs = await TimerLog.find(filter)
    .sort({ date: -1, startTime: -1, _id: -1 })
    .populate('task', 'title status project stage totalTimeLogged')
    .populate('project', 'projectName clientName currentStage overallStatus invoiceStatus')
    .populate('stage', 'stageName stageNo')
    .populate('user', 'name avatar role employeeId')
    .lean();

  const rows = buildSelectedRows(logs.map(serializeTimerLog));
  const csv = buildCsv(rows);
  const fileName = `${String(targetUserId) === String(req.user.id) ? 'my' : 'employee'}-timesheets.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(csv);
}

module.exports = {
  buildBasicFilter,
  buildComparison,
  buildCsv,
  buildDerivedMaps,
  buildPreviousRange,
  buildTrendRows,
  bulkDeleteTimesheets,
  bulkUpdateTimesheets,
  createTimesheetFilter,
  deleteTimesheetFilter,
  exportTimesheets,
  getAllTimesheets,
  getEmployeeTimesheets,
  getMyTimesheets,
  listTimesheetFilters,
  loadTimesheetContext,
  updateTimesheetFilter,
};



