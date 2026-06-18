const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Team = require('../models/Team');
const { serializeEmployee } = require('./employee.controller');
const { getPresenceSnapshot } = require('../config/socket');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const ROLE_ORDER = {
  superadmin: 0,
  admin: 1,
  project_manager: 2,
  employee: 3,
};

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeFilter(value) {
  const normalized = normalizeText(value);
  return normalized && normalized !== 'all' ? normalized : 'all';
}

function normalizePresence(value) {
  const normalized = normalizeText(value);
  return normalized === 'online' || normalized === 'offline' ? normalized : 'all';
}

function buildTaskSummary() {
  return {
    total: 0,
    active: 0,
    todo: 0,
    inProgress: 0,
    review: 0,
    done: 0,
    overdue: 0,
    dueSoon: 0,
  };
}

function buildProjectKey(project) {
  return String(project?._id || project?.id || '');
}

function buildProjectCard(project) {
  return {
    id: buildProjectKey(project),
    projectName: project.projectName || project.name || 'Project',
    clientName: project.clientName || project.client || '',
    overallStatus: project.overallStatus || project.status || 'In Progress',
    currentStage: project.currentStage || project.stage || '',
    taskCount: Number(project.taskCount || 0),
  };
}

function sortProjects(projects = []) {
  return [...projects].sort((a, b) => {
    const taskDelta = Number(b.taskCount || 0) - Number(a.taskCount || 0);
    if (taskDelta !== 0) return taskDelta;
    return String(a.projectName || '').localeCompare(String(b.projectName || ''), undefined, { sensitivity: 'base' });
  });
}

function compareStrings(a, b, direction = 1) {
  return direction * String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

function compareNumbers(a, b, direction = 1) {
  return direction * ((Number(a || 0) || 0) - (Number(b || 0) || 0));
}

function compareDates(a, b, direction = 1) {
  const first = a ? new Date(a).getTime() : 0;
  const second = b ? new Date(b).getTime() : 0;
  return direction * ((Number.isNaN(first) ? 0 : first) - (Number.isNaN(second) ? 0 : second));
}

function getSortComparator(sort) {
  switch (sort) {
    case 'name_desc':
      return (a, b) => compareStrings(a.name, b.name, -1) || compareStrings(a.employeeId, b.employeeId, -1);
    case 'role_asc':
      return (a, b) => compareNumbers(ROLE_ORDER[a.role] ?? 99, ROLE_ORDER[b.role] ?? 99, 1) || compareStrings(a.name, b.name, 1);
    case 'role_desc':
      return (a, b) => compareNumbers(ROLE_ORDER[a.role] ?? 99, ROLE_ORDER[b.role] ?? 99, -1) || compareStrings(a.name, b.name, 1);
    case 'department_asc':
      return (a, b) => compareStrings(a.department, b.department, 1) || compareStrings(a.name, b.name, 1);
    case 'department_desc':
      return (a, b) => compareStrings(a.department, b.department, -1) || compareStrings(a.name, b.name, 1);
    case 'projects_asc':
      return (a, b) => compareNumbers(a.currentProjectCount, b.currentProjectCount, 1) || compareStrings(a.name, b.name, 1);
    case 'projects_desc':
      return (a, b) => compareNumbers(a.currentProjectCount, b.currentProjectCount, -1) || compareStrings(a.name, b.name, 1);
    case 'last_login_asc':
      return (a, b) => compareDates(a.lastLogin, b.lastLogin, 1) || compareStrings(a.name, b.name, 1);
    case 'last_login_desc':
      return (a, b) => compareDates(a.lastLogin, b.lastLogin, -1) || compareStrings(a.name, b.name, 1);
    case 'online_asc':
      return (a, b) => compareNumbers(Number(Boolean(a.online)), Number(Boolean(b.online)), 1) || compareStrings(a.name, b.name, 1);
    case 'online_desc':
      return (a, b) => compareNumbers(Number(Boolean(a.online)), Number(Boolean(b.online)), -1) || compareStrings(a.name, b.name, 1);
    case 'default':
    default:
      return (a, b) => compareNumbers(Number(Boolean(b.online)), Number(Boolean(a.online)), 1) || compareNumbers(ROLE_ORDER[a.role] ?? 99, ROLE_ORDER[b.role] ?? 99, 1) || compareStrings(a.name, b.name, 1);
  }
}

function buildSearchFilter(search) {
  if (!search) return {};
  const pattern = new RegExp(escapeRegExp(search), 'i');
  return {
    $or: [
      { name: pattern },
      { email: pattern },
      { employeeId: pattern },
      { phone: pattern },
      { emergencyPhone: pattern },
      { designation: pattern },
      { department: pattern },
      { role: pattern },
    ],
  };
}

function buildRowSearchText(row) {
  const projectText = (row.currentProjects || [])
    .map((project) => [project.projectName, project.clientName, project.currentStage, project.overallStatus].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ');

  return normalizeText([
    row.name,
    row.employeeId,
    row.email,
    row.phone,
    row.emergencyPhone,
    row.designation,
    row.department,
    row.role,
    row.online ? 'online' : 'offline',
    row.currentProjectCount,
    row.activeTaskCount,
    row.totalTaskCount,
    row.taskSummary?.active,
    row.taskSummary?.overdue,
    projectText,
  ].filter(Boolean).join(' '));
}

function buildEmptyPayload(pageSize, filters) {
  return {
    summary: {
      totalEmployees: 0,
      onlineEmployees: 0,
      offlineEmployees: 0,
      trackedProjects: 0,
      activeAssignments: 0,
      totalTaskMentions: 0,
    },
    rows: [],
    pagination: {
      page: 1,
      pageSize,
      totalRows: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    },
    generatedAt: new Date().toISOString(),
    filters,
  };
}

function buildSummary(rows = []) {
  const totalProjects = new Set();
  rows.forEach((row) => {
    (row.currentProjects || []).forEach((project) => {
      if (project?.id) totalProjects.add(String(project.id));
    });
  });

  return {
    totalEmployees: rows.length,
    onlineEmployees: rows.filter((row) => row.online).length,
    offlineEmployees: rows.filter((row) => !row.online).length,
    trackedProjects: totalProjects.size,
    activeAssignments: rows.reduce((sum, row) => sum + Number(row.taskSummary?.active || 0), 0),
    totalTaskMentions: rows.reduce((sum, row) => sum + Number(row.totalTaskCount || 0), 0),
  };
}

const getMonitorOverview = asyncHandler(async (req, res) => {
  const search = normalizeText(req.query.search);
  const presence = normalizePresence(req.query.presence);
  const roleFilter = normalizeFilter(req.query.role);
  const sort = String(req.query.sort || 'default').trim().toLowerCase();
  const pageSize = parseBoundedInt(req.query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const requestedPage = parseBoundedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const filters = { search, presence, role: roleFilter, sort };

  const visibleUsersFilter = {};
  const requesterRole = req.user?.role || '';

  if (requesterRole !== 'superadmin') {
    visibleUsersFilter.role = { $ne: 'superadmin' };
    if (roleFilter === 'superadmin') {
      return res.json({
        success: true,
        data: buildEmptyPayload(pageSize, filters),
      });
    }
  }

  if (roleFilter !== 'all') {
    visibleUsersFilter.role = roleFilter;
  }

  Object.assign(visibleUsersFilter, buildSearchFilter(search));

  const [presenceSnapshotRaw, users, teams] = await Promise.all([
    Promise.resolve(getPresenceSnapshot()),
    User.find(visibleUsersFilter)
      .select('_id name email role avatar avatarPublicId isActive phone emergencyPhone designation department employeeId joiningDate createdBy createdAt updatedAt lastLogin')
      .sort({ isActive: -1, role: 1, name: 1 })
      .lean(),
    Team.find({}).select('_id members').lean(),
  ]);

  const presenceSnapshot = Array.isArray(presenceSnapshotRaw) ? presenceSnapshotRaw : [];
  const presenceMap = presenceSnapshot.reduce((acc, entry) => {
    acc[String(entry.userId)] = entry;
    return acc;
  }, {});

  const candidateUsers = users.filter((user) => {
    const isOnline = Boolean(presenceMap[String(user._id)]);
    if (presence === 'online') return isOnline;
    if (presence === 'offline') return !isOnline;
    return true;
  });

  if (!candidateUsers.length) {
    return res.json({
      success: true,
      data: buildEmptyPayload(pageSize, filters),
    });
  }

  const visibleUserIds = candidateUsers.map((user) => String(user._id));
  const membersByTeam = new Map();

  teams.forEach((team) => {
    const memberIds = Array.isArray(team.members) ? team.members.map((member) => String(member)) : [];
    membersByTeam.set(String(team._id), new Set(memberIds));
  });

  const [projects, tasks] = await Promise.all([
    Project.find({
      $or: [
        { responsibleEngineer: { $in: visibleUserIds } },
        { assignedTeam: { $in: visibleUserIds } },
      ],
    })
      .select('projectName clientName overallStatus currentStage stageCompletion projectValue companySegment responsibleEngineer assignedTeam createdAt')
      .sort({ createdAt: -1 })
      .populate('responsibleEngineer', 'name email role avatar employeeId designation department')
      .populate('assignedTeam', 'name email role avatar employeeId designation department')
      .lean({ virtuals: true }),
    Task.find({
      $or: [
        { assignee: { $in: visibleUserIds } },
        { reporter: { $in: visibleUserIds } },
        { assignedTeam: { $in: visibleUserIds } },
        ...(teams.length ? [{ team: { $in: teams.map((team) => team._id) } }] : []),
      ],
    })
      .select('project dueDate status assignee assignedTeam team reporter createdAt')
      .sort({ dueDate: 1, createdAt: -1 })
      .populate('project', 'projectName clientName overallStatus currentStage stageCompletion projectValue companySegment')
      .populate('assignee', 'name email role avatar employeeId designation department')
      .populate('assignedTeam', 'name email role avatar employeeId designation department')
      .populate('team', 'members')
      .populate('reporter', 'name email role avatar employeeId designation department')
      .lean({ virtuals: true }),
  ]);

  const userBuckets = new Map(
    candidateUsers.map((user) => [
      String(user._id),
      {
        projects: new Map(),
        summary: buildTaskSummary(),
      },
    ]),
  );

  const registerProject = (userId, project) => {
    const bucket = userBuckets.get(String(userId));
    if (!bucket || !project) return;
    const key = buildProjectKey(project);
    if (!key) return;

    const existing = bucket.projects.get(key);
    if (existing) {
      existing.taskCount = Number(existing.taskCount || 0) + 1;
      bucket.projects.set(key, existing);
      return;
    }

    bucket.projects.set(key, {
      ...buildProjectCard(project),
      taskCount: 0,
    });
  };

  const registerTask = (userId, task) => {
    const bucket = userBuckets.get(String(userId));
    if (!bucket || !task) return;

    bucket.summary.total += 1;

    const status = normalizeText(task.status);
    if (status === 'done' || status === 'completed') bucket.summary.done += 1;
    else if (status === 'review' || status === 'in review') bucket.summary.review += 1;
    else if (status === 'in-progress' || status === 'in progress' || status === 'progress') bucket.summary.inProgress += 1;
    else bucket.summary.todo += 1;

    if (status !== 'done' && status !== 'completed') {
      bucket.summary.active += 1;
      const dueDate = task.dueDate ? new Date(task.dueDate).getTime() : null;
      const now = Date.now();
      if (dueDate && !Number.isNaN(dueDate) && dueDate < now) {
        bucket.summary.overdue += 1;
      } else if (dueDate && !Number.isNaN(dueDate) && dueDate - now <= 48 * 60 * 60 * 1000 && dueDate >= now) {
        bucket.summary.dueSoon += 1;
      }
    }
  };

  const resolveRelatedUsersFromTask = (task) => {
    const related = new Set();
    if (task.assignee?._id) related.add(String(task.assignee._id));
    if (task.reporter?._id) related.add(String(task.reporter._id));

    if (Array.isArray(task.assignedTeam)) {
      task.assignedTeam.forEach((member) => {
        if (member?._id) related.add(String(member._id));
      });
    }

    const teamId = String(task.team?._id || task.team || '');
    if (teamId && membersByTeam.has(teamId)) {
      membersByTeam.get(teamId).forEach((memberId) => related.add(memberId));
    }

    return [...related].filter((userId) => userBuckets.has(userId));
  };

  projects.forEach((project) => {
    const relatedUsers = new Set();
    if (project.responsibleEngineer?._id) {
      relatedUsers.add(String(project.responsibleEngineer._id));
    }

    if (Array.isArray(project.assignedTeam)) {
      project.assignedTeam.forEach((member) => {
        if (member?._id) relatedUsers.add(String(member._id));
      });
    }

    relatedUsers.forEach((userId) => {
      if (userBuckets.has(userId)) {
        registerProject(userId, project);
      }
    });
  });

  tasks.forEach((task) => {
    const relatedUsers = resolveRelatedUsersFromTask(task);
    const project = task.project || null;

    relatedUsers.forEach((userId) => {
      registerTask(userId, task);
      if (project) {
        registerProject(userId, project);
      }
    });
  });

  const rows = candidateUsers.map((user) => {
    const userId = String(user._id);
    const presenceEntry = presenceMap[userId] || null;
    const bucket = userBuckets.get(userId) || { projects: new Map(), summary: buildTaskSummary() };
    const currentProjects = sortProjects(Array.from(bucket.projects.values()));
    const summary = bucket.summary;
    const row = {
      ...serializeEmployee(user),
      online: Boolean(presenceEntry),
      connectedAt: presenceEntry?.connectedAt || null,
      lastSeenAt: null,
      currentProjectCount: currentProjects.length,
      currentProjects,
      taskSummary: summary,
      activeTaskCount: summary.active,
      totalTaskCount: summary.total,
    };

    return {
      ...row,
      searchText: buildRowSearchText(row),
    };
  });

  const filteredRows = search
    ? rows.filter((row) => row.searchText.includes(search))
    : rows;

  const sortedRows = [...filteredRows].sort(getSortComparator(sort));
  const totalRows = sortedRows.length;
  const totalPages = totalRows ? Math.ceil(totalRows / pageSize) : 0;
  const currentPage = totalPages ? Math.min(requestedPage, totalPages) : 1;
  const start = totalRows ? (currentPage - 1) * pageSize : 0;
  const pageRows = totalRows ? sortedRows.slice(start, start + pageSize) : [];
  const summary = buildSummary(sortedRows);

  return res.json({
    success: true,
    data: {
      summary,
      rows: pageRows.map(({ searchText, ...row }) => row),
      pagination: {
        page: currentPage,
        pageSize,
        totalRows,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
      generatedAt: new Date().toISOString(),
      filters,
    },
  });
});

module.exports = {
  getMonitorOverview,
};
