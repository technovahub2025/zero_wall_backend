const Project = require('../models/Project');
const Stage = require('../models/Stage');
const Task = require('../models/Task');
const TeamMember = require('../models/TeamMember');
const ActivityLog = require('../models/ActivityLog');
const asyncHandler = require('../utils/asyncHandler');
const { serializeProject } = require('./project.controller');
const { serializeStage } = require('./stage.controller');
const { serializeTask } = require('./task.controller');
const { serializeActivity } = require('../utils/logActivity');

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildActionRows(tasks = []) {
  return tasks
    .filter((task) => task.status !== 'done')
    .sort((a, b) => {
      const dueA = safeDate(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      const dueB = safeDate(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER;
      return dueA - dueB;
    })
    .slice(0, 6)
    .map((task, index) => {
      const project = task.project || {};
      const assignee = task.assignee || {};
      return {
        id: task.id,
        n: String(index + 1).padStart(2, '0'),
        projectName: project.projectName || task.projectName || 'Project',
        projectClient: project.clientName || task.projectClient || '',
        status: task.status,
        projectStatus: project.overallStatus || task.projectStatus || '',
        priority: task.priority,
        projectStage: project.currentStage || task.projectStage || task.stage?.stageName || '',
        nextAction: task.description || task.title,
        assigneeName: assignee.name || task.assigneeName || project.engineer || 'Unassigned',
        dueDate: task.dueDate || null,
        decision: task.backupReviewerName || 'Pending',
        proj: project.projectName || task.projectName || 'Project',
        client: project.clientName || task.projectClient || '',
        pri: task.priority,
        stage: project.currentStage || task.projectStage || task.stage?.stageName || '',
        action: task.description || task.title,
        resp: assignee.name || task.assigneeName || project.engineer || 'Unassigned',
        target: task.dueDate || null,
      };
    });
}

function buildRevenueSummary(projects = []) {
  return projects
    .map((project) => ({
      name: project.projectName,
      received: Number(project.recv || 0),
      balance: Number(project.balance || 0),
    }))
    .sort((a, b) => b.received + b.balance - (a.received + a.balance));
}

function buildStageHeatmap(stages = []) {
  const byProject = new Map();

  stages.forEach((stage) => {
    const projectId = String(stage.project?._id || stage.project || '');
    if (!projectId) return;

    if (!byProject.has(projectId)) {
      byProject.set(projectId, {
        projectId,
        projectName: stage.project?.projectName || 'Project',
        stages: {},
      });
    }

    byProject.get(projectId).stages[stage.stageName || stage.stageNo || 'Stage'] = Number(stage.completionPct || 0);
  });

  return Array.from(byProject.values());
}

function buildTeamRows(projects = [], teamMembers = []) {
  if (teamMembers.length) {
    return teamMembers.map((member) => ({
      id: String(member._id),
      initials: member.initials,
      name: member.name,
      role: member.role,
      projects: Number(member.projects || 0),
      color: member.color || '#2E83F5',
      online: Boolean(member.online),
    }));
  }

  const map = new Map();
  projects.forEach((project) => {
    const engineer = project.engineer || project.responsibleEngineer?.name || 'Unassigned';
    if (!map.has(engineer)) {
      map.set(engineer, { name: engineer, projects: 0, color: '#2E83F5', online: true });
    }
    map.get(engineer).projects += 1;
  });
  return Array.from(map.values());
}

function buildKpis(projects = [], tasks = [], role = 'superadmin') {
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const overdueTasks = openTasks.filter((task) => {
    if (!task.dueDate) return false;
    return safeDate(task.dueDate)?.getTime() < Date.now();
  });
  const dueSoonTasks = openTasks.filter((task) => {
    const due = safeDate(task.dueDate)?.getTime();
    if (!due) return false;
    return due >= Date.now() && due - Date.now() <= 48 * 60 * 60 * 1000;
  });
  const totalValue = projects.reduce((sum, project) => sum + Number(project.value || 0), 0);
  const receivedTotal = projects.reduce((sum, project) => sum + Number(project.recv || 0), 0);
  const balanceTotal = projects.reduce((sum, project) => sum + Number(project.balance || 0), 0);

  if (role === 'employee') {
    return [
      { label: 'My Projects', value: projects.length, tone: 'blue', note: 'Assigned portfolio' },
      { label: 'My Tasks', value: tasks.length, tone: 'sky', note: 'Open and completed' },
      { label: 'Due Soon', value: dueSoonTasks.length, tone: 'amber', note: 'Next 48 hours' },
      { label: 'Overdue', value: overdueTasks.length, tone: 'rose', note: 'Needs attention' },
      { label: 'Completed', value: tasks.filter((task) => task.status === 'done').length, tone: 'emerald', note: 'Finished work' },
      { label: 'Open Tasks', value: openTasks.length, tone: 'sky', note: 'Active work' },
    ];
  }

  return [
    { label: 'Total Projects', value: projects.length, tone: 'blue', note: 'Active portfolio' },
    { label: 'In Progress', value: projects.filter((project) => project.status === 'progress' || project.status === 'In Progress').length, tone: 'sky', note: 'Active now' },
    { label: 'Completed', value: projects.filter((project) => project.status === 'done' || project.status === 'Completed').length, tone: 'emerald', note: 'This cycle' },
    { label: 'On Hold', value: projects.filter((project) => project.status === 'hold' || project.status === 'On Hold').length, tone: 'amber', note: 'Awaiting' },
    { label: 'Critical', value: projects.filter((project) => String(project.priority).toLowerCase() === 'critical').length, tone: 'rose', note: 'Needs action' },
    { label: 'Avg Completion', value: `${projects.length ? Math.round(projects.reduce((sum, project) => sum + Number(project.completion || 0), 0) / projects.length) : 0}%`, tone: 'amber', note: 'Portfolio avg' },
    { label: 'Tasks Due Soon', value: dueSoonTasks.length, tone: 'sky', note: 'Next 48 hours' },
    { label: 'Open Tasks', value: openTasks.length, tone: 'blue', note: 'Open decisions' },
  ];
}

function buildSummary(projects = [], tasks = [], role = 'superadmin') {
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const overdueTasks = openTasks.filter((task) => task.dueDate && safeDate(task.dueDate)?.getTime() < Date.now());
  const dueSoonTasks = openTasks.filter((task) => {
    const due = safeDate(task.dueDate)?.getTime();
    return due && due >= Date.now() && due - Date.now() <= 48 * 60 * 60 * 1000;
  });

  if (role === 'employee') {
    return {
      totalProjects: projects.length,
      myTasks: tasks.length,
      overdueTasks: overdueTasks.length,
      dueSoonTasks: dueSoonTasks.length,
      openTasks: openTasks.length,
      completedTasks: tasks.filter((task) => task.status === 'done').length,
      totalValue: projects.reduce((sum, project) => sum + Number(project.value || 0), 0),
      receivedTotal: projects.reduce((sum, project) => sum + Number(project.recv || 0), 0),
      balanceTotal: projects.reduce((sum, project) => sum + Number(project.balance || 0), 0),
    };
  }

  return {
    totalProjects: projects.length,
    inProgress: projects.filter((project) => project.status === 'progress' || project.status === 'In Progress').length,
    completed: projects.filter((project) => project.status === 'done' || project.status === 'Completed').length,
    openTasks: openTasks.length,
    overdueTasks: overdueTasks.length,
    dueSoonTasks: dueSoonTasks.length,
    pendingApprovals: projects.filter((project) => project.approval !== 'Approved').length,
    totalValue: projects.reduce((sum, project) => sum + Number(project.value || 0), 0),
    receivedTotal: projects.reduce((sum, project) => sum + Number(project.recv || 0), 0),
    balanceTotal: projects.reduce((sum, project) => sum + Number(project.balance || 0), 0),
  };
}

async function buildDashboardPayload({ role = 'superadmin', userId = null } = {}) {
  const employeeMode = role === 'employee';
  const projectFilter = employeeMode
    ? {
        isArchived: { $ne: true },
        $or: [
          { responsibleEngineer: userId },
          { assignedTeam: userId },
          { createdBy: userId },
        ],
      }
    : { isArchived: { $ne: true } };

  const taskFilter = employeeMode
    ? {
        $or: [
          { assignee: userId },
          { createdBy: userId },
        ],
      }
    : {};

  const [projectDocs, taskDocs, stageDocs, teamDocs, activityDocs] = await Promise.all([
    Project.find(projectFilter)
      .sort({ sNo: 1, createdAt: -1 })
      .populate('responsibleEngineer', 'name email role avatar employeeId designation department')
      .populate('assignedTeam', 'name email role avatar employeeId designation department')
      .populate('createdBy', 'name email role avatar employeeId designation department'),
    Task.find(taskFilter)
      .sort({ dueDate: 1, order: 1, createdAt: -1 })
      .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment recv balance invoiceStatus priority responsibleEngineer')
      .populate('stage', 'stageName stageNo')
      .populate('assignee', 'name email role avatar employeeId designation department')
      .populate('backupReviewer', 'name email role avatar employeeId designation department')
      .populate('createdBy', 'name email role avatar employeeId designation department'),
    Stage.find({})
      .sort({ stageNo: 1, createdAt: 1 })
      .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment'),
    TeamMember.find({}).sort({ name: 1 }),
    ActivityLog.find(employeeMode ? { actor: userId } : {})
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(12)
      .populate('actor', 'name avatar role employeeId designation department')
      .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment'),
  ]);

  const projects = projectDocs.map(serializeProject);
  const tasks = taskDocs.map(serializeTask);
  const stages = stageDocs.map(serializeStage);
  const activity = activityDocs.map(serializeActivity);

  const projectIds = new Set(projectDocs.map((project) => String(project._id)));
  const stageHeatmap = buildStageHeatmap(stages.filter((stage) => !employeeMode || projectIds.has(String(stage.project?._id || stage.project || ''))));
  const revenueSummary = buildRevenueSummary(projects);
  const team = buildTeamRows(projects, teamDocs);
  const actions = buildActionRows(tasks);
  const summary = buildSummary(projects, tasks, role);
  const kpis = buildKpis(projects, tasks, role);

  return {
    role,
    kpis,
    summary,
    projects,
    actions,
    revenueSummary,
    team,
    stages: stageHeatmap,
    recentActivity: activity,
    tasks,
  };
}

const getDashboard = asyncHandler(async (req, res) => {
  const payload = await buildDashboardPayload({ role: req.user?.role, userId: req.user?.id });
  return res.json({ success: true, data: payload });
});

const getSuperadminDashboard = asyncHandler(async (req, res) => {
  const payload = await buildDashboardPayload({ role: 'superadmin', userId: req.user?.id });
  return res.json({ success: true, data: payload });
});

const getEmployeeDashboard = asyncHandler(async (req, res) => {
  const payload = await buildDashboardPayload({ role: 'employee', userId: req.user?.id });
  return res.json({ success: true, data: payload });
});

module.exports = {
  getDashboard,
  getSuperadminDashboard,
  getEmployeeDashboard,
  buildDashboardPayload,
};
