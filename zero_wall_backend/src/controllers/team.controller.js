const TeamMember = require('../models/TeamMember');
const User = require('../models/User');
const crypto = require('crypto');
const { sendEmail, inviteEmailTemplate } = require('../utils/sendEmail');
const asyncHandler = require('../utils/asyncHandler');
const { createNotification } = require('../utils/createNotification');
const { emitToUser } = require('../config/socket');
const { sanitizeUser } = require('../utils/sanitize');
const { getClientUrl } = require('../utils/env');

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
  };
}

async function buildInvite(user, inviter) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  user.inviteToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.inviteExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
  user.isActive = false;
  await user.save();

  const inviteUrl = `${getClientUrl()}/invite/${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'ZEROWALL'} invitation`,
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
  return res.json({
    success: true,
    data: members.map(serializeUser),
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
  const { name, email, role = 'employee', phone = '', designation = '', department = '', sendInvite = true } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  const user = existing || new User({ email });
  user.name = name || user.name || email.split('@')[0];
  user.role = role === 'admin' ? 'admin' : 'employee';
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

  return res.status(201).json({
    success: true,
    message: sendInvite ? 'Invite sent' : 'Member added',
    data: serializeUser(user),
  });
});

const resendInvite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Invite not found' });
  }

  await buildInvite(user, req.user);
  return res.json({ success: true, message: 'Invite resent', data: serializeUser(user) });
});

const revokeInvite = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Invite not found' });
  }

  user.inviteToken = undefined;
  user.inviteExpiry = undefined;
  user.isActive = false;
  await user.save();
  return res.json({ success: true, message: 'Invite revoked' });
});

const changeMemberRole = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Member not found' });
  }

  user.role = req.body.role === 'admin' ? 'admin' : 'employee';
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
