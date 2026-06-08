const Team = require('../models/Team');
const Project = require('../models/Project');
const Task = require('../models/Task');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');

const MEMBER_SELECT = 'name email role avatar employeeId designation department isActive';
const PROJECT_SELECT = 'projectName clientName overallStatus currentStage stageCompletion';
const TASK_SELECT = 'title status dueDate priority project projectName projectClient projectStage projectStatus';

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function normalizeMemberIds(value) {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  if (!input.length) return [];

  const users = await User.find({ _id: { $in: input } }).select('_id');
  return users.map((user) => String(user._id));
}

async function normalizeProjectIds(value) {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim()).filter(Boolean)
      : [];

  if (!input.length) return [];

  const projects = await Project.find({ _id: { $in: input } }).select('_id');
  return projects.map((project) => String(project._id));
}

function serializeMember(member) {
  if (!member) return null;
  const item = member.toObject ? member.toObject({ virtuals: true }) : member;
  return {
    id: item._id,
    name: item.name,
    email: item.email,
    role: item.role,
    avatar: item.avatar,
    employeeId: item.employeeId,
    designation: item.designation,
    department: item.department,
    isActive: item.isActive,
  };
}

function serializeProject(project) {
  if (!project) return null;
  const item = project.toObject ? project.toObject({ virtuals: true }) : project;
  return {
    id: item._id,
    projectName: item.projectName,
    clientName: item.clientName,
    overallStatus: item.overallStatus,
    currentStage: item.currentStage,
    stageCompletion: item.stageCompletion,
  };
}

function serializeTask(task) {
  if (!task) return null;
  const item = task.toObject ? task.toObject({ virtuals: true }) : task;
  return {
    id: item._id,
    title: item.title,
    status: item.status,
    dueDate: item.dueDate,
    priority: item.priority,
    projectName: item.project?.projectName || item.projectName || '',
    projectClient: item.project?.clientName || item.projectClient || '',
    projectStage: item.project?.currentStage || item.projectStage || '',
    projectStatus: item.project?.overallStatus || item.projectStatus || '',
  };
}

async function buildTeamSnapshot(teamDoc) {
  const team = teamDoc.toObject ? teamDoc.toObject({ virtuals: true }) : teamDoc;
  const members = Array.isArray(team.members) ? team.members.map(serializeMember).filter(Boolean) : [];
  const memberIds = members.map((member) => member.id);
  const linkedProjects = Array.isArray(team.projectIds) ? team.projectIds.map(serializeProject).filter(Boolean) : [];
  const linkedProjectIds = linkedProjects.map((project) => project.id);
  const memberBasedProjectsQuery = memberIds.length
    ? {
        $or: [
          { responsibleEngineer: { $in: memberIds } },
          { assignedTeam: { $in: memberIds } },
        ],
      }
    : null;
  const taskMatch = {
    $or: [
      ...(linkedProjectIds.length ? [{ project: { $in: linkedProjectIds } }] : []),
      ...(memberIds.length
        ? [
            { assignee: { $in: memberIds } },
            { reporter: { $in: memberIds } },
            { assignedTeam: { $in: memberIds } },
          ]
        : []),
      { team: team._id },
    ],
  };

  const [projectCount, taskCount, currentProjects, currentTasks] = await Promise.all([
    linkedProjectIds.length
      ? linkedProjectIds.length
      : memberBasedProjectsQuery
        ? Project.countDocuments(memberBasedProjectsQuery)
        : 0,
    Task.countDocuments(taskMatch),
    linkedProjectIds.length
      ? Project.find({ _id: { $in: linkedProjectIds } })
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(4)
          .select(PROJECT_SELECT)
      : memberBasedProjectsQuery
        ? Project.find(memberBasedProjectsQuery)
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(4)
          .select(PROJECT_SELECT)
        : [],
    Task.find(taskMatch)
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(4)
          .populate('project', PROJECT_SELECT),
  ]);

  return {
    id: team._id,
    name: team.name,
    description: team.description || '',
    color: team.color || '#3b82f6',
    members,
    projectIds: linkedProjects.map((project) => project.id),
    memberCount: members.length,
    projectCount,
    taskCount,
    currentProjects: currentProjects.map(serializeProject),
    currentTasks: currentTasks.map(serializeTask),
    createdBy: team.createdBy,
    isActive: team.isActive,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

const listTeams = asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: escapeRegex(search), $options: 'i' } },
      { description: { $regex: escapeRegex(search), $options: 'i' } },
    ];
  }

  const teams = await Team.find(filter)
    .sort({ name: 1 })
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  const data = await Promise.all(teams.map(buildTeamSnapshot));

  return res.json({ success: true, data });
});

const getTeamById = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id)
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  return res.json({ success: true, data: await buildTeamSnapshot(team) });
});

const createTeam = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Team name is required' });
  }

  const existing = await Team.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  if (existing) {
    return res.status(409).json({ success: false, message: 'Team already exists' });
  }

  const members = await normalizeMemberIds(req.body.members);
  const projectIds = await normalizeProjectIds(req.body.projectIds);
  const team = await Team.create({
    name,
    description: String(req.body.description || '').trim(),
    color: String(req.body.color || '#3b82f6').trim() || '#3b82f6',
    members,
    projectIds,
    createdBy: req.user?.id || null,
    isActive: typeof req.body.isActive === 'boolean' ? req.body.isActive : true,
  });

  const populated = await Team.findById(team._id)
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  return res.status(201).json({ success: true, message: 'Team created', data: await buildTeamSnapshot(populated) });
});

const updateTeam = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  if (req.body.name !== undefined) {
    const nextName = String(req.body.name || '').trim();
    if (!nextName) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }
    const duplicate = await Team.findOne({
      _id: { $ne: team._id },
      name: { $regex: `^${escapeRegex(nextName)}$`, $options: 'i' },
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'Team already exists' });
    }
    team.name = nextName;
  }

  if (req.body.description !== undefined) {
    team.description = String(req.body.description || '').trim();
  }
  if (req.body.color !== undefined) {
    team.color = String(req.body.color || '#3b82f6').trim() || '#3b82f6';
  }
  if (req.body.isActive !== undefined) {
    team.isActive = Boolean(req.body.isActive);
  }
  if (req.body.members !== undefined) {
    team.members = await normalizeMemberIds(req.body.members);
  }
  if (req.body.projectIds !== undefined) {
    team.projectIds = await normalizeProjectIds(req.body.projectIds);
  }

  await team.save();

  const populated = await Team.findById(team._id)
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  return res.json({ success: true, message: 'Team updated', data: await buildTeamSnapshot(populated) });
});

const deleteTeam = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  await Promise.all([
    Task.updateMany({ team: team._id }, { $unset: { team: '' } }),
    team.deleteOne(),
  ]);

  return res.json({ success: true, message: 'Team deleted' });
});

const addTeamMembers = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  const memberIds = await normalizeMemberIds(req.body.members || req.body.memberIds);
  const existing = new Set((team.members || []).map((id) => String(id)));
  memberIds.forEach((id) => existing.add(String(id)));
  team.members = [...existing];
  await team.save();

  const populated = await Team.findById(team._id)
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  return res.json({ success: true, message: 'Members added', data: await buildTeamSnapshot(populated) });
});

const removeTeamMember = asyncHandler(async (req, res) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  const memberId = String(req.params.memberId || '').trim();
  team.members = (team.members || []).filter((id) => String(id) !== memberId);
  await team.save();

  const populated = await Team.findById(team._id)
    .populate('members', MEMBER_SELECT)
    .populate('projectIds', PROJECT_SELECT)
    .populate('createdBy', 'name email role avatar');

  return res.json({ success: true, message: 'Member removed', data: await buildTeamSnapshot(populated) });
});

module.exports = {
  listTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMembers,
  removeTeamMember,
};
