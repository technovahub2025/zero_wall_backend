const asyncHandler = require('../utils/asyncHandler');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Stage = require('../models/Stage');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const TimerLog = require('../models/TimerLog');
const Client = require('../models/Client');
const Team = require('../models/Team');

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

function normalizeIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStatusBucket(value = '') {
  const text = String(value || '').toLowerCase();
  if (/(complete|done|closed|resolved)/.test(text)) return 'Completed';
  if (/(hold|paused|pause|waiting)/.test(text)) return 'On Hold';
  if (/(delay|delayed|late|overdue|risk|blocked|cancel)/.test(text)) return 'Delayed';
  return 'Active';
}

function filterProjectsByQuery(projects = [], query = {}) {
  const statusFilters = normalizeIdList(query.status || query.statuses || query.projectStatus);
  const priorityFilters = normalizeIdList(query.priority || query.priorities);

  if (!statusFilters.length && !priorityFilters.length) return projects;

  return projects.filter((project) => {
    const statusBucket = normalizeStatusBucket(project.overallStatus);
    const rawStatus = String(project.overallStatus || '').toLowerCase();
    const rawPriority = String(project.priority || '').toLowerCase();

    const statusMatch =
      !statusFilters.length ||
      statusFilters.some((status) => {
        const normalized = String(status || '').trim().toLowerCase();
        return normalized === rawStatus || normalizeStatusBucket(status) === statusBucket;
      });

    const priorityMatch =
      !priorityFilters.length ||
      priorityFilters.some((priority) => String(priority || '').trim().toLowerCase() === rawPriority);

    return statusMatch && priorityMatch;
  });
}

function filterTasksByQuery(tasks = [], query = {}) {
  const taskStatusFilters = normalizeIdList(query.taskStatus || query.taskStatuses);
  if (!taskStatusFilters.length) return tasks;

  return tasks.filter((task) =>
    taskStatusFilters.some((status) => String(status || '').trim().toLowerCase() === String(task.status || '').trim().toLowerCase()),
  );
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

function mergeIdSets(current, next) {
  const normalized = new Set((next || []).map(String).filter(Boolean));
  if (!normalized.size) return current;
  if (!current) return normalized;
  return new Set([...current].filter((id) => normalized.has(id)));
}

async function resolveScope(query = {}) {
  let projectIds = null;
  const memberIds = new Set();

  const directProjects = normalizeIdList(query.project || query.projectId);
  const hasDirectProjectScope = directProjects.length > 0;
  if (directProjects.length) {
    projectIds = mergeIdSets(projectIds, directProjects);
  }

  const clientIds = normalizeIdList(query.client || query.clientId);
  const hasClientScope = clientIds.length > 0;
  if (clientIds.length) {
    const clients = await Client.find({ _id: { $in: clientIds } }).select('_id clientName projectIds').lean();
    const clientProjectIds = clients.flatMap((client) => client.projectIds || []).map(String).filter(Boolean);
    const clientNames = clients.map((client) => String(client.clientName || '').trim()).filter(Boolean);

    if (clientNames.length) {
      const projectsByClientName = await Project.find({
        isArchived: { $ne: true },
        clientName: { $in: clientNames },
      })
        .select('_id')
        .lean();

      projectsByClientName.forEach((project) => clientProjectIds.push(String(project._id)));
    }

    projectIds = mergeIdSets(projectIds, clientProjectIds);
    if (!projectIds) projectIds = new Set();
  }

  const teamIds = normalizeIdList(query.team || query.teamId);
  const hasTeamScope = teamIds.length > 0;
  if (teamIds.length) {
    const teams = await Team.find({ _id: { $in: teamIds } }).select('_id projectIds members').lean();
    const teamProjectIds = teams.flatMap((team) => team.projectIds || []).map(String).filter(Boolean);
    projectIds = mergeIdSets(projectIds, teamProjectIds);
    teams.flatMap((team) => team.members || []).map(String).filter(Boolean).forEach((id) => memberIds.add(id));
  }

  if (!projectIds && memberIds.size) {
    const matchedProjects = await Project.find({
      isArchived: { $ne: true },
      $or: [
        { responsibleEngineer: { $in: [...memberIds] } },
        { assignedTeam: { $in: [...memberIds] } },
      ],
    })
      .select('_id')
      .lean();

    projectIds = new Set(matchedProjects.map((project) => String(project._id)));
  }

  return {
    projectIds: projectIds ? [...projectIds].filter(Boolean) : [],
    memberIds: [...memberIds].filter(Boolean),
    hasProjectScope: hasDirectProjectScope || hasClientScope || Boolean(projectIds) || (hasTeamScope && !memberIds.size),
    hasMemberScope: hasTeamScope && memberIds.size > 0,
  };
}

function buildProjectMatch(scope, query) {
  const match = {
    isArchived: { $ne: true },
    ...buildDateFilter(query, 'createdAt'),
  };

  if (scope.hasProjectScope || scope.projectIds.length) {
    match._id = { $in: scope.projectIds };
  } else if (scope.memberIds.length) {
    match.$or = [
      { responsibleEngineer: { $in: scope.memberIds } },
      { assignedTeam: { $in: scope.memberIds } },
    ];
  }

  return match;
}

function buildTaskMatch(scope, query) {
  const match = buildDateFilter(query, 'createdAt');

  if (scope.hasProjectScope || scope.projectIds.length) {
    match.project = { $in: scope.projectIds };
  } else if (scope.memberIds.length) {
    match.$or = [
      { assignee: { $in: scope.memberIds } },
      { reporter: { $in: scope.memberIds } },
      { assignedTeam: { $in: scope.memberIds } },
    ];
  }

  return match;
}

function buildInvoiceMatch(scope, query) {
  const match = buildDateFilter(query, 'createdAt');
  if (scope.hasProjectScope || scope.projectIds.length) {
    match.project = { $in: scope.projectIds };
  }
  return match;
}

function buildTimerMatch(scope, query) {
  const match = buildDateFilter(query, 'date');

  if (scope.hasProjectScope || scope.projectIds.length) {
    match.project = { $in: scope.projectIds };
  } else if (scope.memberIds.length) {
    match.user = { $in: scope.memberIds };
  }

  return match;
}

function stringifyDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function stringifyPeopleList(value = []) {
  if (!Array.isArray(value)) return stringifyEntity(value);
  return value.map((item) => stringifyEntity(item)).filter(Boolean).join(', ');
}

function stringifyEntity(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value || '');
  return (
    value.name ||
    value.projectName ||
    value.clientName ||
    value.stageName ||
    value.title ||
    value.email ||
    value.employeeId ||
    value.label ||
    value._id ||
    ''
  );
}

function stringifyArray(value = []) {
  if (!Array.isArray(value)) return value ? String(value) : '';
  return value
    .map((item) => {
      if (item == null) return '';
      if (typeof item === 'string') return item;
      if (typeof item !== 'object') return String(item);
      return item.name || item.label || item.title || item.url || item._id || JSON.stringify(item);
    })
    .filter(Boolean)
    .join(', ');
}

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

function summarizeTaskProgress(tasks = []) {
  const now = Date.now();
  return tasks.reduce(
    (acc, task) => {
      const status = String(task.status || '').toLowerCase();
      const dueDate = task.dueDate ? new Date(task.dueDate).getTime() : null;

      if (status === 'done') {
        acc.completed += 1;
      } else if (status === 'in-progress' || status === 'review') {
        acc.inProgress += 1;
      } else {
        acc.pending += 1;
      }

      if (dueDate && dueDate < now && status !== 'done') {
        acc.overdue += 1;
      }

      return acc;
    },
    { completed: 0, inProgress: 0, pending: 0, overdue: 0 },
  );
}

function isBillableProject(project = {}) {
  const status = String(project.invoiceStatus || '').trim().toLowerCase();
  return Boolean(status) && status !== 'not started';
}

function getTeamMemberIds(project = {}) {
  const members = [];
  if (project.responsibleEngineer) members.push(String(project.responsibleEngineer));
  (project.assignedTeam || []).forEach((member) => {
    if (member) members.push(String(member));
  });
  return members.filter(Boolean);
}

function buildPreviousQuery(query = {}) {
  const range = resolveDateRange(query);
  if (!range?.from || !range?.to) return null;

  const duration = range.to.getTime() - range.from.getTime();
  if (duration <= 0) return null;

  const previousTo = new Date(range.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration);
  return {
    ...query,
    period: undefined,
    range: undefined,
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
}

function buildProjectStatusRows(statusMap = {}) {
  const buckets = {
    Active: 0,
    Completed: 0,
    Delayed: 0,
    'On Hold': 0,
  };

  Object.entries(statusMap || {}).forEach(([label, value]) => {
    buckets[normalizeStatusBucket(label)] += Number(value || 0);
  });

  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

function buildTaskProgressRows(taskProgress = {}) {
  return [
    { name: 'completed', label: 'Completed', value: Number(taskProgress.completed || 0) },
    { name: 'inProgress', label: 'In Progress', value: Number(taskProgress.inProgress || 0) },
    { name: 'pending', label: 'Pending', value: Number(taskProgress.pending || 0) },
    { name: 'overdue', label: 'Overdue', value: Number(taskProgress.overdue || 0) },
  ];
}

function summarizeOverview({ projects = [], tasks = [], invoices = [], logs = [], employeeCount = 0 } = {}) {
  const byStatus = countBy(projects, 'overallStatus');
  const byPriority = countBy(projects, 'priority');
  const byTaskStatus = countBy(tasks, 'status');
  const taskProgress = summarizeTaskProgress(tasks);

  const billing = invoices.reduce(
    (acc, invoice) => {
      acc.received += Number(invoice.amountReceived || 0);
      acc.balance += Number(invoice.balance || 0);
      acc.total += Number(invoice.amountTotal || 0);
      return acc;
    },
    { received: 0, balance: 0, total: 0 },
  );

  const projectMap = new Map(projects.map((project) => [String(project._id), project]));
  const billableHours = logs.reduce((sum, log) => {
    const project = projectMap.get(String(log.project));
    if (!project || !isBillableProject(project)) return sum;
    return sum + Number(log.duration || 0) / 3600;
  }, 0);

  return {
    byStatus,
    byPriority,
    byTaskStatus,
    taskProgress,
    billing,
    totalProjects: projects.length,
    activeTasks: tasks.filter((task) => String(task.status || '').toLowerCase() !== 'done').length,
    totalEmployees: employeeCount,
    revenue: Number(billing.received.toFixed(2)),
    billableHours: Number(billableHours.toFixed(1)),
    pendingInvoices: invoices.filter((invoice) => Number(invoice.balance || 0) > 0 || String(invoice.billingStatus || '').toLowerCase() !== 'paid').length,
  };
}

async function loadScopedReportData(query = {}) {
  const scope = await resolveScope(query);
  const projectMatch = buildProjectMatch(scope, query);
  const taskMatch = buildTaskMatch(scope, query);
  const invoiceMatch = buildInvoiceMatch(scope, query);
  const timerMatch = buildTimerMatch(scope, query);

  const [projects, tasks, invoices, logs, employees, clients, teams] = await Promise.all([
    Project.find(projectMatch)
      .select(
        '_id sNo projectName clientName companySegment projectType location startDate targetDate actualEnd projectValue overallStatus currentStage stageCompletion clientApprovalStatus clientApprovalDate nextActionRequired responsibleEngineer assignedTeam remarks blockers remarksOrBlockers ceoMdReview priority invoiceStatus estimatedCompletion recv balance isArchived createdBy createdAt updatedAt',
      )
      .lean(),
    Task.find(taskMatch)
      .select(
        '_id title description startDate project stage assignee team assignedTeam backupReviewer priority status dueDate completedAt estimatedDurationMinutes timerStartedAt timerExpiresAt timerStatus extraTimeMinutesGranted activeTimerLog nextAction tags attachments comments order totalTimeLogged createdBy reporter createdAt updatedAt',
      )
      .lean(),
    Invoice.find(invoiceMatch)
      .select(
        '_id project invoiceNo billingStatus amountTotal amountReceived balance dueDate paidDate remarks paymentHistory createdBy updatedBy createdAt updatedAt',
      )
      .lean(),
    TimerLog.find(timerMatch)
      .select('_id user task project stage startTime endTime pausedAt duration note switchReason switchFromLog switchFromTask switchToTask date isManual isActive createdAt updatedAt')
      .lean(),
    User.find({ role: { $in: ['admin', 'project_manager', 'employee'] }, isActive: true })
      .select('_id name email role avatar employeeId phone emergencyPhone designation department joiningDate isActive createdAt updatedAt')
      .sort({ name: 1 })
      .lean(),
    Client.find({}).select('_id clientName contactPerson email phone companyName segment address city status notes projectIds createdAt updatedAt').lean(),
    Team.find({ isActive: true })
      .select('_id name description color members projectIds createdBy isActive createdAt updatedAt')
      .sort({ name: 1 })
      .lean(),
  ]);

  const filteredProjects = filterProjectsByQuery(projects, query);
  const filteredTasks = filterTasksByQuery(tasks, query);
  const filteredProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredInvoices = invoices.filter((invoice) => filteredProjectIds.has(String(invoice.project)));
  const filteredLogs = logs.filter((log) => filteredProjectIds.has(String(log.project)));
  const scopedEmployeeIds = new Set();

  if (scope.memberIds.length) {
    scope.memberIds.forEach((id) => scopedEmployeeIds.add(String(id)));
  } else if (scope.hasProjectScope || scope.projectIds.length) {
    filteredProjects.forEach((project) => getTeamMemberIds(project).forEach((id) => scopedEmployeeIds.add(id)));
    filteredTasks.forEach((task) => {
      if (task.assignee) scopedEmployeeIds.add(String(task.assignee));
      if (task.reporter) scopedEmployeeIds.add(String(task.reporter));
      (task.assignedTeam || []).forEach((member) => {
        if (member) scopedEmployeeIds.add(String(member));
      });
    });
    filteredLogs.forEach((log) => {
      if (log.user) scopedEmployeeIds.add(String(log.user));
    });
  }

  const filteredEmployees = scopedEmployeeIds.size
    ? employees.filter((employee) => scopedEmployeeIds.has(String(employee._id)))
    : employees;

  const scopedProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredClients = clients.filter((client) => {
    if (!scopedProjectIds.size) return true;
    const linkedProjects = Array.isArray(client.projectIds) ? client.projectIds.map(String) : [];
    return linkedProjects.some((projectId) => scopedProjectIds.has(projectId));
  });
  const filteredTeams = teams.filter((team) => {
    if (!scopedProjectIds.size) return true;
    const linkedProjects = Array.isArray(team.projectIds) ? team.projectIds.map(String) : [];
    return linkedProjects.some((projectId) => scopedProjectIds.has(projectId));
  });

  return {
    scope,
    projects: filteredProjects,
    tasks: filteredTasks,
    invoices: filteredInvoices,
    logs: filteredLogs,
    employees: filteredEmployees,
    clients: filteredClients,
    teams: filteredTeams,
    employeeCount: filteredEmployees.length,
  };
}

function buildRevenueTrendRows(invoices = []) {
  const byMonth = invoices.reduce((acc, invoice) => {
    const key = monthKey(invoice.createdAt);
    if (!acc[key]) acc[key] = { month: key, revenue: 0, collections: 0, balance: 0, received: 0, total: 0 };
    acc[key].revenue += Number(invoice.amountTotal || 0);
    acc[key].collections += Number(invoice.amountReceived || 0);
    acc[key].balance += Number(invoice.balance || 0);
    acc[key].received = acc[key].collections;
    acc[key].total = acc[key].revenue;
    return acc;
  }, {});

  return Object.values(byMonth)
    .map((row) => ({
      ...row,
      revenue: Number(row.revenue.toFixed(2)),
      collections: Number(row.collections.toFixed(2)),
      balance: Number(row.balance.toFixed(2)),
      received: Number(row.received.toFixed(2)),
      total: Number(row.total.toFixed(2)),
    }))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

function buildEngineerUtilizationRows({ employees = [], tasks = [], logs = [] } = {}) {
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

  const totalHours = Object.values(hoursByEngineer).reduce((sum, value) => sum + Number(value || 0), 0) || 1;

  return employees
    .map((engineer) => {
      const id = String(engineer._id);
      const seconds = Number(hoursByEngineer[id] || 0);
      return {
        id: engineer._id,
        name: engineer.name || 'Unknown',
        projects: Number(taskCountByEngineer[id] || 0),
        hours: Number((seconds / 3600).toFixed(1)),
        utilization: Number(((seconds / totalHours) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => Number(b.utilization || 0) - Number(a.utilization || 0));
}

function buildClientContributionRows({ projects = [], invoices = [] } = {}) {
  const clientMap = projects.reduce((acc, project) => {
    const clientName = String(project.clientName || 'Unknown').trim() || 'Unknown';
    acc[String(project._id)] = clientName;
    return acc;
  }, {});

  const summary = invoices.reduce((acc, invoice) => {
    const clientName = clientMap[String(invoice.project)] || 'Unknown';
    if (!acc[clientName]) {
      acc[clientName] = { clientName, revenue: 0, billed: 0, outstanding: 0, projects: new Set() };
    }
    acc[clientName].revenue += Number(invoice.amountReceived || 0);
    acc[clientName].billed += Number(invoice.amountTotal || 0);
    acc[clientName].outstanding += Number(invoice.balance || 0);
    acc[clientName].projects.add(String(invoice.project));
    return acc;
  }, {});

  return Object.values(summary)
    .map((row) => ({
      clientName: row.clientName,
      revenue: Number(row.revenue.toFixed(2)),
      billed: Number(row.billed.toFixed(2)),
      outstanding: Number(row.outstanding.toFixed(2)),
      projectCount: row.projects.size,
    }))
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
}

function buildTimesheetRows({ projects = [], logs = [] } = {}) {
  const billableProjects = new Set(projects.filter(isBillableProject).map((project) => String(project._id)));
  const byMonth = logs.reduce((acc, log) => {
    const key = monthKey(log.date || log.createdAt);
    if (!acc[key]) acc[key] = { month: key, loggedHours: 0, billableHours: 0 };
    const hours = Number(log.duration || 0) / 3600;
    acc[key].loggedHours += hours;
    if (billableProjects.has(String(log.project))) {
      acc[key].billableHours += hours;
    }
    return acc;
  }, {});

  return Object.values(byMonth)
    .map((row) => ({
      month: row.month,
      loggedHours: Number(row.loggedHours.toFixed(1)),
      billableHours: Number(row.billableHours.toFixed(1)),
    }))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

function buildBundleFromData(data, query = {}, previousOverview = null) {
  const overview = summarizeOverview(data);
  const generatedAt = new Date().toISOString();

  const rawProjects = (data.projects || []).map((project) => ({
    id: String(project._id || ''),
    sNo: project.sNo ?? '',
    projectName: project.projectName || '',
    clientName: project.clientName || '',
    companySegment: project.companySegment || '',
    projectType: stringifyArray(project.projectType || []),
    location: project.location || '',
    startDate: stringifyDate(project.startDate),
    targetDate: stringifyDate(project.targetDate),
    actualEnd: stringifyDate(project.actualEnd),
    projectValue: Number(project.projectValue || 0),
    overallStatus: project.overallStatus || '',
    currentStage: project.currentStage || '',
    stageCompletion: Number(project.stageCompletion || 0),
    clientApprovalStatus: project.clientApprovalStatus || '',
    clientApprovalDate: stringifyDate(project.clientApprovalDate),
    nextActionRequired: project.nextActionRequired || '',
    responsibleEngineer: stringifyEntity(project.responsibleEngineer),
    assignedTeam: stringifyPeopleList(project.assignedTeam || []),
    remarks: project.remarks || '',
    blockers: project.blockers || '',
    remarksOrBlockers: project.remarksOrBlockers || '',
    ceoMdReview: project.ceoMdReview || '',
    priority: project.priority || '',
    invoiceStatus: project.invoiceStatus || '',
    estimatedCompletion: Number(project.estimatedCompletion || 0),
    recv: Number(project.recv || 0),
    balance: Number(project.balance || 0),
    isArchived: Boolean(project.isArchived),
    createdBy: stringifyEntity(project.createdBy),
    createdAt: stringifyDate(project.createdAt),
    updatedAt: stringifyDate(project.updatedAt),
  }));

  const rawTasks = (data.tasks || []).map((task) => ({
    id: String(task._id || ''),
    title: task.title || '',
    description: task.description || '',
    startDate: stringifyDate(task.startDate),
    project: stringifyEntity(task.project),
    stage: stringifyEntity(task.stage),
    assignee: stringifyEntity(task.assignee),
    team: stringifyEntity(task.team),
    assignedTeam: stringifyPeopleList(task.assignedTeam || []),
    backupReviewer: stringifyEntity(task.backupReviewer),
    priority: task.priority || '',
    status: task.status || '',
    dueDate: stringifyDate(task.dueDate),
    completedAt: stringifyDate(task.completedAt),
    estimatedDurationMinutes: Number(task.estimatedDurationMinutes || 0),
    timerStartedAt: stringifyDate(task.timerStartedAt),
    timerExpiresAt: stringifyDate(task.timerExpiresAt),
    timerStatus: task.timerStatus || '',
    extraTimeMinutesGranted: Number(task.extraTimeMinutesGranted || 0),
    activeTimerLog: stringifyEntity(task.activeTimerLog),
    nextAction: task.nextAction || '',
    tags: stringifyArray(task.tags || []),
    attachments: stringifyArray(task.attachments || []),
    comments: stringifyArray(task.comments || []),
    order: Number(task.order || 0),
    totalTimeLogged: Number(task.totalTimeLogged || 0),
    createdBy: stringifyEntity(task.createdBy),
    reporter: stringifyEntity(task.reporter),
    createdAt: stringifyDate(task.createdAt),
    updatedAt: stringifyDate(task.updatedAt),
  }));

  const rawInvoices = (data.invoices || []).map((invoice) => ({
    id: String(invoice._id || ''),
    project: stringifyEntity(invoice.project),
    invoiceNo: invoice.invoiceNo || '',
    billingStatus: invoice.billingStatus || '',
    amountTotal: Number(invoice.amountTotal || 0),
    amountReceived: Number(invoice.amountReceived || 0),
    balance: Number(invoice.balance || 0),
    dueDate: stringifyDate(invoice.dueDate),
    paidDate: stringifyDate(invoice.paidDate),
    remarks: invoice.remarks || '',
    paymentHistory: stringifyArray(invoice.paymentHistory || []),
    createdBy: stringifyEntity(invoice.createdBy),
    updatedBy: stringifyEntity(invoice.updatedBy),
    createdAt: stringifyDate(invoice.createdAt),
    updatedAt: stringifyDate(invoice.updatedAt),
  }));

  const rawTimerLogs = (data.logs || []).map((log) => {
    const actionMeta = getTimerLogAction(log);
    return {
      id: String(log._id || ''),
      user: stringifyEntity(log.user),
      task: stringifyEntity(log.task),
      project: stringifyEntity(log.project),
      stage: stringifyEntity(log.stage),
      startTime: stringifyDate(log.startTime),
      endTime: stringifyDate(log.endTime),
      pausedAt: stringifyDate(log.pausedAt),
      durationSeconds: Number(log.duration || 0),
      action: actionMeta.action,
      actionLabel: actionMeta.actionLabel,
      reason: getTimerLogReason(log),
      note: log.note || '',
      switchReason: log.switchReason || '',
      date: stringifyDate(log.date),
      isManual: Boolean(log.isManual),
      isActive: Boolean(log.isActive),
      createdAt: stringifyDate(log.createdAt),
      updatedAt: stringifyDate(log.updatedAt),
    };
  });

  const rawEmployees = (data.employees || []).map((employee) => ({
    id: String(employee._id || ''),
    employeeId: employee.employeeId || '',
    name: employee.name || '',
    email: employee.email || '',
    role: employee.role || '',
    avatar: employee.avatar || '',
    phone: employee.phone || '',
    emergencyPhone: employee.emergencyPhone || '',
    designation: employee.designation || '',
    department: employee.department || '',
    joiningDate: stringifyDate(employee.joiningDate),
    isActive: Boolean(employee.isActive),
    createdAt: stringifyDate(employee.createdAt),
    updatedAt: stringifyDate(employee.updatedAt),
  }));

  const rawClients = (data.clients || []).map((client) => ({
    id: String(client._id || ''),
    clientName: client.clientName || '',
    contactPerson: client.contactPerson || '',
    email: client.email || '',
    phone: client.phone || '',
    companyName: client.companyName || '',
    segment: client.segment || '',
    address: client.address || '',
    city: client.city || '',
    status: client.status || '',
    notes: client.notes || '',
    projectIds: stringifyArray(client.projectIds || []),
    createdAt: stringifyDate(client.createdAt),
    updatedAt: stringifyDate(client.updatedAt),
  }));

  const rawTeams = (data.teams || []).map((team) => ({
    id: String(team._id || ''),
    name: team.name || '',
    description: team.description || '',
    color: team.color || '',
    members: stringifyArray(team.members || []),
    projectIds: stringifyArray(team.projectIds || []),
    createdBy: stringifyEntity(team.createdBy),
    isActive: Boolean(team.isActive),
    createdAt: stringifyDate(team.createdAt),
    updatedAt: stringifyDate(team.updatedAt),
  }));

  return {
    meta: {
      generatedAt,
      filters: {
        period: query.period || query.range || 'all',
        from: query.from || '',
        to: query.to || '',
        projectIds: normalizeIdList(query.project || query.projectId),
        clientIds: normalizeIdList(query.client || query.clientId),
        teamIds: normalizeIdList(query.team || query.teamId),
        projectStatuses: normalizeIdList(query.status || query.statuses || query.projectStatus),
        priorities: normalizeIdList(query.priority || query.priorities),
        taskStatuses: normalizeIdList(query.taskStatus || query.taskStatuses),
      },
      counts: {
        projects: data.projects.length,
        tasks: data.tasks.length,
        invoices: data.invoices.length,
        timerLogs: data.logs.length,
        employees: data.employees.length,
        clients: data.clients.length,
        teams: data.teams.length,
      },
    },
    overview,
    previousOverview,
    projectStatus: buildProjectStatusRows(overview.byStatus),
    taskProgress: buildTaskProgressRows(overview.taskProgress),
    revenueTrend: buildRevenueTrendRows(data.invoices),
    engineerUtilization: buildEngineerUtilizationRows(data),
    clientContribution: buildClientContributionRows(data),
    timesheetAnalytics: buildTimesheetRows(data),
    rawData: {
      projects: rawProjects,
      tasks: rawTasks,
      invoices: rawInvoices,
      timerLogs: rawTimerLogs,
      employees: rawEmployees,
      clients: rawClients,
      teams: rawTeams,
    },
  };
}

async function buildReportBundle(query = {}) {
  const currentData = await loadScopedReportData(query);
  const previousQuery = buildPreviousQuery(query);
  const previousOverview = previousQuery ? summarizeOverview(await loadScopedReportData(previousQuery)) : null;
  return buildBundleFromData(currentData, query, previousOverview);
}

const getReportsBundle = asyncHandler(async (req, res) => {
  const bundle = await buildReportBundle(req.query);
  return res.json({ success: true, data: bundle });
});

const reports = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projectMatch = buildProjectMatch(scope, req.query);
  const taskMatch = buildTaskMatch(scope, req.query);
  const invoiceMatch = buildInvoiceMatch(scope, req.query);
  const timerMatch = buildTimerMatch(scope, req.query);

  const [projects, tasks, invoices, logs, employeeCount] = await Promise.all([
    Project.find(projectMatch)
      .select('overallStatus priority projectValue recv balance createdAt currentStage clientApprovalStatus invoiceStatus estimatedCompletion responsibleEngineer assignedTeam')
      .lean(),
    Task.find(taskMatch)
      .select('status priority dueDate completedAt assignee reporter assignedTeam project createdAt')
      .lean(),
    Invoice.find(invoiceMatch)
      .select('amountReceived amountTotal balance billingStatus createdAt project')
      .lean(),
    TimerLog.find(timerMatch)
      .select('user project duration date createdAt')
      .lean(),
    User.countDocuments({ role: { $in: ['admin', 'project_manager', 'employee'] }, isActive: true }),
  ]);

  const filteredProjects = filterProjectsByQuery(projects, req.query);
  const filteredTasks = filterTasksByQuery(tasks, req.query);
  const filteredProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredInvoices = invoices.filter((invoice) => filteredProjectIds.has(String(invoice.project)));
  const filteredLogs = logs.filter((log) => filteredProjectIds.has(String(log.project)));

  const byStatus = countBy(filteredProjects, 'overallStatus');
  const byPriority = countBy(filteredProjects, 'priority');
  const byTaskStatus = countBy(filteredTasks, 'status');
  const taskProgress = summarizeTaskProgress(filteredTasks);

  const billing = filteredInvoices.reduce(
    (acc, invoice) => {
      acc.received += Number(invoice.amountReceived || 0);
      acc.balance += Number(invoice.balance || 0);
      acc.total += Number(invoice.amountTotal || 0);
      return acc;
    },
    { received: 0, balance: 0, total: 0 },
  );

  const projectMap = new Map(filteredProjects.map((project) => [String(project._id), project]));
  const billableHours = filteredLogs.reduce((sum, log) => {
    const project = projectMap.get(String(log.project));
    if (!project || !isBillableProject(project)) return sum;
    return sum + Number(log.duration || 0) / 3600;
  }, 0);

  const employeeIds = new Set();
  filteredProjects.forEach((project) => {
    if (project.responsibleEngineer) employeeIds.add(String(project.responsibleEngineer));
    (project.assignedTeam || []).forEach((member) => {
      if (member) employeeIds.add(String(member));
    });
  });
  filteredTasks.forEach((task) => {
    if (task.assignee) employeeIds.add(String(task.assignee));
    if (task.reporter) employeeIds.add(String(task.reporter));
    (task.assignedTeam || []).forEach((member) => {
      if (member) employeeIds.add(String(member));
    });
  });
  filteredLogs.forEach((log) => {
    if (log.user) employeeIds.add(String(log.user));
  });

  return res.json({
    success: true,
    data: {
      byStatus,
      byPriority,
      byTaskStatus,
      taskProgress,
      billing,
      totalProjects: filteredProjects.length,
      activeTasks: filteredTasks.filter((task) => String(task.status || '').toLowerCase() !== 'done').length,
      totalEmployees: employeeIds.size || employeeCount,
      revenue: billing.received,
      billableHours: Number(billableHours.toFixed(1)),
      pendingInvoices: filteredInvoices.filter((invoice) => Number(invoice.balance || 0) > 0 || String(invoice.billingStatus || '').toLowerCase() !== 'paid').length,
    },
  });
});

const getProjectStatusReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projects = await Project.find(buildProjectMatch(scope, req.query))
    .select('overallStatus createdAt')
    .lean();
  return res.json({ success: true, data: countBy(filterProjectsByQuery(projects, req.query), 'overallStatus') });
});

const getPriorityReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projects = await Project.find(buildProjectMatch(scope, req.query))
    .select('priority createdAt')
    .lean();
  return res.json({ success: true, data: countBy(filterProjectsByQuery(projects, req.query), 'priority') });
});

const getTaskStatusReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const tasks = await Task.find(buildTaskMatch(scope, req.query))
    .select('status createdAt')
    .lean();
  return res.json({ success: true, data: countBy(filterTasksByQuery(tasks, req.query), 'status') });
});

const getTaskProgressReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const tasks = await Task.find(buildTaskMatch(scope, req.query))
    .select('status dueDate createdAt')
    .lean();
  return res.json({ success: true, data: summarizeTaskProgress(filterTasksByQuery(tasks, req.query)) });
});

const getRevenueTrend = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projects = filterProjectsByQuery(
    await Project.find(buildProjectMatch(scope, req.query))
      .select('_id overallStatus priority')
      .lean(),
    req.query,
  );
  const allowedProjectIds = new Set(projects.map((project) => String(project._id)));
  const invoices = await Invoice.find(buildInvoiceMatch(scope, req.query))
    .select('amountReceived amountTotal balance createdAt')
    .sort({ createdAt: 1 })
    .lean();
  const filteredInvoices = invoices.filter((invoice) => allowedProjectIds.has(String(invoice.project)));

  const byMonth = filteredInvoices.reduce((acc, invoice) => {
    const key = monthKey(invoice.createdAt);
    if (!acc[key]) acc[key] = { month: key, revenue: 0, collections: 0, balance: 0, received: 0, total: 0 };
    acc[key].revenue += Number(invoice.amountTotal || 0);
    acc[key].collections += Number(invoice.amountReceived || 0);
    acc[key].balance += Number(invoice.balance || 0);
    acc[key].received = acc[key].collections;
    acc[key].total = acc[key].revenue;
    return acc;
  }, {});

  return res.json({
    success: true,
    data: Object.values(byMonth),
  });
});

const getStageCompletion = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projects = filterProjectsByQuery(
    await Project.find(buildProjectMatch(scope, req.query))
      .select('_id projectName createdAt overallStatus priority')
      .lean(),
    req.query,
  );
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
  const scope = await resolveScope(req.query);
  const timerMatch = buildTimerMatch(scope, req.query);
  const taskMatch = buildTaskMatch(scope, req.query);

  const [engineers, tasks, logs] = await Promise.all([
    User.find({ role: { $in: ['admin', 'project_manager', 'employee'] }, isActive: true })
      .select('name')
      .sort({ name: 1 })
      .lean(),
    Task.find(taskMatch)
      .select('assignee project createdAt')
      .lean(),
    TimerLog.find(timerMatch)
      .select('user project duration date createdAt')
      .lean(),
  ]);

  const filteredProjects = filterProjectsByQuery(
    await Project.find(buildProjectMatch(scope, req.query))
      .select('_id overallStatus priority')
      .lean(),
    req.query,
  );
  const filteredProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredTasks = filterTasksByQuery(tasks, req.query);
  const filteredLogs = logs.filter((log) => filteredProjectIds.has(String(log.project)));

  const taskCountByEngineer = filteredTasks.reduce((acc, task) => {
    const key = String(task.assignee || '');
    if (!key || key === 'undefined') return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const hoursByEngineer = filteredLogs.reduce((acc, log) => {
    const key = String(log.user || '');
    if (!key || key === 'undefined') return acc;
    acc[key] = (acc[key] || 0) + Number(log.duration || 0);
    return acc;
  }, {});

  const totalHours = Object.values(hoursByEngineer).reduce((sum, value) => sum + Number(value || 0), 0) || 1;

  const data = engineers.map((engineer) => {
    const id = String(engineer._id);
    const hours = Number(((hoursByEngineer[id] || 0) / 3600).toFixed(1));

    return {
      id: engineer._id,
      name: engineer.name,
      projects: Number(taskCountByEngineer[id] || 0),
      hours,
      utilization: Number((((hoursByEngineer[id] || 0) / totalHours) * 100).toFixed(1)),
    };
  });

  return res.json({ success: true, data });
});

const getClientContributionReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const projectMatch = buildProjectMatch(scope, req.query);
  const invoiceMatch = buildInvoiceMatch(scope, req.query);

  const [projects, invoices] = await Promise.all([
    Project.find(projectMatch).select('_id clientName').lean(),
    Invoice.find(invoiceMatch).select('project amountTotal amountReceived balance createdAt').lean(),
  ]);

  const filteredProjects = filterProjectsByQuery(projects, req.query);
  const allowedProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredInvoices = invoices.filter((invoice) => allowedProjectIds.has(String(invoice.project)));

  const clientMap = projects.reduce((acc, project) => {
    const clientName = String(project.clientName || 'Unknown').trim() || 'Unknown';
    const projectId = String(project._id);
    if (!acc[projectId]) acc[projectId] = clientName;
    return acc;
  }, {});

  const summary = filteredInvoices.reduce((acc, invoice) => {
    const clientName = clientMap[String(invoice.project)] || 'Unknown';
    if (!acc[clientName]) {
      acc[clientName] = { clientName, revenue: 0, billed: 0, outstanding: 0, projects: new Set() };
    }
    acc[clientName].revenue += Number(invoice.amountReceived || 0);
    acc[clientName].billed += Number(invoice.amountTotal || 0);
    acc[clientName].outstanding += Number(invoice.balance || 0);
    acc[clientName].projects.add(String(invoice.project));
    return acc;
  }, {});

  return res.json({
    success: true,
    data: Object.values(summary)
      .map((row) => ({
        clientName: row.clientName,
        revenue: Number(row.revenue.toFixed(2)),
        billed: Number(row.billed.toFixed(2)),
        outstanding: Number(row.outstanding.toFixed(2)),
        projectCount: row.projects.size,
      }))
      .sort((a, b) => b.revenue - a.revenue),
  });
});

const getTimesheetAnalyticsReport = asyncHandler(async (req, res) => {
  const scope = await resolveScope(req.query);
  const timerMatch = buildTimerMatch(scope, req.query);
  const [projects, logs] = await Promise.all([
    Project.find(buildProjectMatch(scope, req.query))
      .select('_id invoiceStatus')
      .lean(),
    TimerLog.find(timerMatch)
      .select('project duration date createdAt')
      .lean(),
  ]);

  const filteredProjects = filterProjectsByQuery(projects, req.query);
  const allowedProjectIds = new Set(filteredProjects.map((project) => String(project._id)));
  const filteredLogs = logs.filter((log) => allowedProjectIds.has(String(log.project)));
  const billableProjects = new Set(filteredProjects.filter(isBillableProject).map((project) => String(project._id)));

  const byMonth = filteredLogs.reduce((acc, log) => {
    const key = monthKey(log.date || log.createdAt);
    if (!acc[key]) acc[key] = { month: key, loggedHours: 0, billableHours: 0 };
    const hours = Number(log.duration || 0) / 3600;
    acc[key].loggedHours += hours;
    if (billableProjects.has(String(log.project))) {
      acc[key].billableHours += hours;
    }
    return acc;
  }, {});

  return res.json({
    success: true,
    data: Object.values(byMonth).map((row) => ({
      month: row.month,
      loggedHours: Number(row.loggedHours.toFixed(1)),
      billableHours: Number(row.billableHours.toFixed(1)),
    })),
  });
});

module.exports = {
  reports,
  getReportsBundle,
  getProjectStatusReport,
  getPriorityReport,
  getTaskStatusReport,
  getTaskProgressReport,
  getRevenueTrend,
  getStageCompletion,
  getEngineerUtilization,
  getClientContributionReport,
  getTimesheetAnalyticsReport,
  buildReportBundle,
  resolveDateRange,
};
