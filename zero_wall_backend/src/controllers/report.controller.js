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

const reports = asyncHandler(async (req, res) => {
  const projects = await Project.find().populate('responsibleEngineer', 'name avatar role employeeId designation department');
  const tasks = await Task.find();
  const invoices = await Invoice.find();

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
  const projects = await Project.find();
  return res.json({ success: true, data: countBy(projects, 'overallStatus') });
});

const getPriorityReport = asyncHandler(async (req, res) => {
  const projects = await Project.find();
  return res.json({ success: true, data: countBy(projects, 'priority') });
});

const getTaskStatusReport = asyncHandler(async (req, res) => {
  const tasks = await Task.find();
  return res.json({ success: true, data: countBy(tasks, 'status') });
});

const getRevenueTrend = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find().sort({ createdAt: 1 });
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
  const projects = await Project.find().sort({ sNo: 1 });
  const stages = await Stage.find().sort({ stageNo: 1 });
  const matrix = projects.map((project) => {
    const projectStages = stages.filter((stage) => String(stage.project) === String(project._id));
    const byStage = projectStages.reduce((acc, stage) => {
      acc[stage.stageName] = Number(stage.completionPct || 0);
      return acc;
    }, {});
    return {
      projectId: project._id,
      projectName: project.projectName,
      stages: byStage,
    };
  });

  return res.json({ success: true, data: { stages: matrix } });
});

const getEngineerUtilization = asyncHandler(async (req, res) => {
  const engineers = await User.find({ role: { $in: ['admin', 'employee'] }, isActive: true }).sort({ name: 1 });
  const tasks = await Task.find().populate('assignee', 'name');
  const logs = await TimerLog.find().populate('user', 'name');

  const data = engineers.map((engineer) => {
    const projectCount = tasks.filter((task) => String(task.assignee?._id || task.assignee) === String(engineer._id)).length;
    const hours = logs
      .filter((log) => String(log.user?._id || log.user) === String(engineer._id))
      .reduce((sum, log) => sum + Number(log.duration || 0), 0) / 3600;

    return {
      id: engineer._id,
      name: engineer.name,
      projects: projectCount,
      hours: Number(hours.toFixed(1)),
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
};
