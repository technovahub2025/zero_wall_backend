const asyncHandler = require('../utils/asyncHandler');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Stage = require('../models/Stage');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const TimerLog = require('../models/TimerLog');

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = item[field] || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveDateRange(query = {}) {
  const fromInput = parseDate(query.from);
  const toInput = parseDate(query.to);

  if (fromInput || toInput) {
    return {
      from: fromInput ? startOfDay(fromInput) : null,
      to: toInput ? endOfDay(toInput) : null,
    };
  }

  const period = String(query.period || query.range || 'all').toLowerCase();
  const now = new Date();

  switch (period) {
    case 'last-12-months':
    case 'last12':
    case '12m': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 12);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'this-year':
    case 'year': {
      return {
        from: startOfDay(new Date(now.getFullYear(), 0, 1)),
        to: endOfDay(now),
      };
    }
    case 'last-30-days': {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'all':
    default:
      return null;
  }
}

function buildDateFilter(query, field = 'createdAt') {
  const range = resolveDateRange(query);
  if (!range) return {};

  return {
    [field]: {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.to ? { $lte: range.to } : {}),
    },
  };
}

const reports = asyncHandler(async (req, res) => {
  const projectFilter = buildDateFilter(req.query, 'createdAt');
  const taskFilter = buildDateFilter(req.query, 'createdAt');
  const invoiceFilter = buildDateFilter(req.query, 'createdAt');

  const [projects, tasks, invoices] = await Promise.all([
    Project.find(projectFilter)
      .select('overallStatus priority projectValue recv balance createdAt targetDate startDate actualEnd currentStage clientApprovalStatus invoiceStatus estimatedCompletion responsibleEngineer')
      .lean(),
    Task.find(taskFilter)
      .select('status priority dueDate completedAt assignee project createdAt')
      .lean(),
    Invoice.find(invoiceFilter)
      .select('amountReceived amountTotal balance createdAt')
      .lean(),
  ]);

  const byStatus = countBy(projects, 'overallStatus');
  const byPriority = countBy(projects, 'priority');
  const byTaskStatus = countBy(tasks, 'status');

  const billing = invoices.reduce(
    (acc, invoice) => {
      acc.received += Number(invoice.amountReceived || 0);
      acc.balance += Number(invoice.balance || 0);
      acc.total += Number(invoice.amountTotal || 0);
      return acc;
    },
    { received: 0, balance: 0, total: 0 },
  );

  return res.json({
    success: true,
    data: {
      byStatus,
      byPriority,
      byTaskStatus,
      billing,
      totalProjects: projects.length,
    },
  });
});

const getProjectStatusReport = asyncHandler(async (req, res) => {
  const projects = await Project.find(buildDateFilter(req.query, 'createdAt'))
    .select('overallStatus createdAt')
    .lean();
  return res.json({ success: true, data: countBy(projects, 'overallStatus') });
});

const getPriorityReport = asyncHandler(async (req, res) => {
  const projects = await Project.find(buildDateFilter(req.query, 'createdAt'))
    .select('priority createdAt')
    .lean();
  return res.json({ success: true, data: countBy(projects, 'priority') });
});

const getTaskStatusReport = asyncHandler(async (req, res) => {
  const tasks = await Task.find(buildDateFilter(req.query, 'createdAt'))
    .select('status createdAt')
    .lean();
  return res.json({ success: true, data: countBy(tasks, 'status') });
});

const getRevenueTrend = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find(buildDateFilter(req.query, 'createdAt'))
    .select('amountReceived amountTotal balance createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const byMonth = invoices.reduce((acc, invoice) => {
    const key = monthKey(invoice.createdAt);
    if (!acc[key]) acc[key] = { month: key, received: 0, balance: 0, total: 0 };
    acc[key].received += Number(invoice.amountReceived || 0);
    acc[key].balance += Number(invoice.balance || 0);
    acc[key].total += Number(invoice.amountTotal || 0);
    return acc;
  }, {});

  return res.json({
    success: true,
    data: Object.values(byMonth),
  });
});

const getStageCompletion = asyncHandler(async (req, res) => {
  const projectFilter = buildDateFilter(req.query, 'createdAt');
  const projects = await Project.find(projectFilter).select('_id projectName createdAt').lean();
  const projectIds = projects.map((project) => project._id);

  const stages = projectIds.length
    ? await Stage.find({ project: { $in: projectIds }, ...buildDateFilter(req.query, 'createdAt') })
        .select('project stageName completionPct createdAt')
        .lean()
    : [];

  const stageByProject = stages.reduce((acc, stage) => {
    const projectId = String(stage.project);
    if (!acc[projectId]) acc[projectId] = {};
    acc[projectId][stage.stageName] = Number(stage.completionPct || 0);
    return acc;
  }, {});

  const matrix = projects.map((project) => {
    const byStage = stageByProject[String(project._id)] || {};
    const values = Object.values(byStage).map((value) => Number(value || 0));
    const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    const peakEntry = Object.entries(byStage).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];

    return {
      projectId: project._id,
      projectName: project.projectName,
      average,
      peakStage: peakEntry?.[0] || 'No stage',
      stages: byStage,
    };
  });

  return res.json({ success: true, data: { stages: matrix } });
});

const getEngineerUtilization = asyncHandler(async (req, res) => {
  const engineers = await User.find({ role: { $in: ['admin', 'project_manager', 'employee'] }, isActive: true })
    .select('name')
    .sort({ name: 1 })
    .lean();

  const taskFilter = buildDateFilter(req.query, 'createdAt');
  const logFilter = buildDateFilter(req.query, 'date');
  const [tasks, logs] = await Promise.all([
    Task.find(taskFilter).select('assignee createdAt').lean(),
    TimerLog.find(logFilter).select('user duration date createdAt').lean(),
  ]);

  const taskCountByEngineer = tasks.reduce((acc, task) => {
    const key = String(task.assignee || '');
    if (!key || key === 'undefined') return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const hoursByEngineer = logs.reduce((acc, log) => {
    const key = String(log.user || '');
    if (!key || key === 'undefined') return acc;
    acc[key] = (acc[key] || 0) + Number(log.duration || 0);
    return acc;
  }, {});

  const data = engineers.map((engineer) => {
    const id = String(engineer._id);
    const hours = Number(((hoursByEngineer[id] || 0) / 3600).toFixed(1));

    return {
      id: engineer._id,
      name: engineer.name,
      projects: Number(taskCountByEngineer[id] || 0),
      hours,
    };
  });

  return res.json({ success: true, data });
});

module.exports = {
  reports,
  getProjectStatusReport,
  getPriorityReport,
  getTaskStatusReport,
  getRevenueTrend,
  getStageCompletion,
  getEngineerUtilization,
  resolveDateRange,
};
