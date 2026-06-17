const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const crypto = require('crypto');
const { sendEmail, inviteEmailTemplate } = require('../utils/sendEmail');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification } = require('../utils/createNotification');
const { emitToUser } = require('../config/socket');
const { sanitizeUser } = require('../utils/sanitize');
const { getClientUrl } = require('../utils/env');
const { getTokenExpiryMs } = require('../utils/tokenExpiry');

function normalizeRole(role) {
  const allowed = ['superadmin', 'employee', 'admin', 'project_manager'];
  if (!role) return 'employee';
  return allowed.includes(role) ? role : 'employee';
}

function canAssignRole(actorRole, nextRole) {
  if (nextRole !== 'superadmin') return true;
  return actorRole === 'superadmin';
}

const listTeam = asyncHandler(async (req, res) => {
  const team = await TeamMember.find().sort({ name: 1 });
  return res.json({
    success: true,
    data: team.map((member) => ({
      id: member._id,
      initials: member.initials,
      name: member.name,
      role: member.role,
      projects: member.projects,
      color: member.color,
      online: member.online,
      email: member.email,
      phone: member.phone,
      isActive: member.isActive,
    })),
  });
});

const createTeamMember = asyncHandler(async (req, res) => {
  const member = await TeamMember.create(req.body);
  return res.status(201).json({
    success: true,
    data: {
      id: member._id,
      initials: member.initials,
      name: member.name,
      role: member.role,
      projects: member.projects,
      color: member.color,
      online: member.online,
      email: member.email,
      phone: member.phone,
      isActive: member.isActive,
    },
  });
});

function serializeUser(user) {
  const item = sanitizeUser(user) || {};
  return {
    id: item._id,
    name: item.name,
    email: item.email,
    role: item.role,
    avatar: item.avatar,
    phone: item.phone || '',
    designation: item.designation || '',
    department: item.department || '',
    employeeId: item.employeeId,
    joiningDate: item.joiningDate || null,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function buildInvite(user, inviter) {
  const rawToken = user.generateInviteToken();
  await user.save();

  const inviteUrl = `${getClientUrl()}/invite/${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'PG Infrastructure'} invitation for ${user.name}`,
    html: inviteEmailTemplate({
      inviteeName: user.name,
      inviterName: inviter?.name || 'A teammate',
      role: user.role,
      inviteUrl,
    }),
  });

  return inviteUrl;
}

const listMembers = asyncHandler(async (req, res) => {
  const members = await User.find({ role: { $ne: 'superadmin' }, isActive: true }).sort({ createdAt: -1 });
  const memberIds = members.map((member) => member._id);

  const [projectRows, taskRows] = await Promise.all([
    memberIds.length
      ? Project.aggregate([
          {
            $match: {
              $or: [{ responsibleEngineer: { $in: memberIds } }, { assignedTeam: { $in: memberIds } }],
            },
          },
          {
            $project: {
              projectName: 1,
              overallStatus: 1,
              currentStage: 1,
              responsibleEngineer: 1,
              assignedTeam: 1,
            },
          },
          {
            $addFields: {
              members: {
                $concatArrays: [
                  {
                    $cond: [
                      { $ifNull: ['$responsibleEngineer', false] },
                      ['$responsibleEngineer'],
                      [],
                    ],
                  },
                  { $ifNull: ['$assignedTeam', []] },
                ],
              },
            },
          },
          { $unwind: '$members' },
          {
            $group: {
              _id: '$members',
              projectCount: { $sum: 1 },
              projects: {
                $push: {
                  id: '$_id',
                  name: '$projectName',
                  status: '$overallStatus',
                  stage: '$currentStage',
                },
              },
            },
          },
        ])
      : [],
    memberIds.length
      ? Task.aggregate([
          {
            $match: {
              $or: [{ assignee: { $in: memberIds } }, { reporter: { $in: memberIds } }, { assignedTeam: { $in: memberIds } }],
            },
          },
          {
            $lookup: {
              from: 'projects',
              localField: 'project',
              foreignField: '_id',
              as: 'projectDoc',
            },
          },
          {
            $unwind: {
              path: '$projectDoc',
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $project: {
              title: 1,
              status: 1,
              dueDate: 1,
              projectName: '$projectDoc.projectName',
              projectStatus: '$projectDoc.overallStatus',
              projectStage: '$projectDoc.currentStage',
              assignee: 1,
              reporter: 1,
              assignedTeam: 1,
            },
          },
          {
            $addFields: {
              members: {
                $concatArrays: [
                  { $cond: [{ $ifNull: ['$assignee', false] }, ['$assignee'], []] },
                  { $cond: [{ $ifNull: ['$reporter', false] }, ['$reporter'], []] },
                  { $ifNull: ['$assignedTeam', []] },
                ],
              },
            },
          },
          { $unwind: '$members' },
          {
            $group: {
              _id: '$members',
              taskCount: { $sum: 1 },
              tasks: {
                $push: {
                  id: '$_id',
                  title: '$title',
                  status: '$status',
                  dueDate: '$dueDate',
                  projectName: '$projectName',
                  projectStatus: '$projectStatus',
                  projectStage: '$projectStage',
                },
              },
            },
          },
        ])
      : [],
  ]);

  const projectMap = new Map(projectRows.map((row) => [String(row._id), row]));
  const taskMap = new Map(taskRows.map((row) => [String(row._id), row]));
  return res.json({
    success: true,
    data: members.map((member) => {
      const memberId = String(member._id);
      const projectRow = projectMap.get(memberId) || {};
      const taskRow = taskMap.get(memberId) || {};
      const projects = Array.isArray(projectRow.projects) ? projectRow.projects : [];
      const tasks = Array.isArray(taskRow.tasks) ? taskRow.tasks : [];
      return {
        ...serializeUser(member),
        teamName: member.department || 'Unassigned',
        projectCount: Number(projectRow.projectCount || 0),
        taskCount: Number(taskRow.taskCount || 0),
        currentProjects: projects.slice(0, 3),
        currentTasks: tasks.slice(0, 3),
      };
    }),
  });
});

const listPendingInvites = asyncHandler(async (req, res) => {
  const invites = await User.find({ inviteToken: { $exists: true, $ne: null }, isActive: false }).sort({ updatedAt: -1 });
  return res.json({
    success: true,
    data: invites.map(serializeUser),
  });
});

const inviteMember = asyncHandler(async (req, res) => {
  const {
    name,
    email,
    role = 'employee',
    phone = '',
    designation = '',
    department = '',
    sendInvite = true,
    projectIds = [],
  } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() })
    .select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
  const user = existing || new User({ email });
  user.name = name || user.name || email.split('@')[0];
  if (!canAssignRole(req.user?.role, role)) {
    return res.status(403).json({ success: false, message: 'Only superadmin can invite a superadmin' });
  }
  user.role = normalizeRole(role);
  user.phone = phone;
  user.designation = designation;
  user.department = department;
  user.createdBy = req.user?.id || user.createdBy || null;

  if (sendInvite) {
    await buildInvite(user, req.user);
  } else {
    user.isActive = true;
  }

  await user.save();

  const normalizedProjectIds = Array.isArray(projectIds)
    ? projectIds
        .map((item) => String(item).trim())
        .filter(Boolean)
    : typeof projectIds === 'string'
      ? projectIds
          .split(',')
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];

  if (normalizedProjectIds.length) {
    await Project.updateMany({ _id: { $in: normalizedProjectIds } }, { $addToSet: { assignedTeam: user._id } });
  }

  return res.status(201).json({
    success: true,
    message: sendInvite ? 'Invite sent' : 'Member added',
    data: serializeUser(user),
  });
});

const resendInvite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
  if (!user) {
    return res.status(404).json({ success: false, message: 'Invite not found' });
  }

  await buildInvite(user, req.user);
  return res.json({ success: true, message: 'Invite resent', data: serializeUser(user) });
});

const revokeInvite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');
  if (!user) {
    return res.status(404).json({ success: false, message: 'Invite not found' });
  }

  user.inviteToken = undefined;
  user.inviteExpiry = undefined;
  user.inviteTokenPrevious = undefined;
  user.inviteExpiryPrevious = undefined;
  user.inviteTokenHistory = [];
  user.isActive = false;
  await user.save();
  return res.json({ success: true, message: 'Invite revoked' });
});

const changeMemberRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Member not found' });
  }

  if (!canAssignRole(req.user?.role, req.body.role)) {
    return res.status(403).json({ success: false, message: 'Only superadmin can assign the superadmin role' });
  }
  user.role = normalizeRole(req.body.role);
  await user.save();

  emitToUser(String(user._id), 'role:changed', { role: user.role });
  await createNotification({
    recipient: user._id,
    sender: req.user?.id || null,
    type: 'role_changed',
    title: 'Role updated',
    message: `Your role has been updated to ${user.role}`,
    link: '/profile',
    metadata: {},
  });

  return res.json({ success: true, message: 'Role updated', data: serializeUser(user) });
});

const removeMember = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Member not found' });
  }

  await Project.updateMany(
    { assignedTeam: user._id },
    { $pull: { assignedTeam: user._id }, $set: { updatedAt: new Date() } },
  );

  user.isActive = false;
  await user.save();
  return res.json({ success: true, message: 'Member deactivated', data: serializeUser(user) });
});

module.exports = {
  listTeam,
  createTeamMember,
  listMembers,
  listPendingInvites,
  inviteMember,
  resendInvite,
  revokeInvite,
  changeMemberRole,
  removeMember,
};
