const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const { getClientUrl } = require('../utils/env');

function serializeProfile(user) {
  const item = user.toObject ? user.toObject({ virtuals: true }) : user;
  return {
    id: item._id,
    name: item.name,
    email: item.email,
    role: item.role,
    avatar: item.avatar,
    avatarPublicId: item.avatarPublicId,
    theme: item.theme || 'system',
    phone: item.phone || '',
    emergencyPhone: item.emergencyPhone || '',
    designation: item.designation || '',
    department: item.department || '',
    employeeId: item.employeeId,
    joiningDate: item.joiningDate || null,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

const getMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  return res.json({ success: true, data: serializeProfile(user) });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  ['name', 'phone', 'emergencyPhone', 'designation', 'department', 'avatar', 'avatarPublicId', 'joiningDate'].forEach((field) => {
    if (req.body[field] !== undefined) {
      user[field] = field === 'joiningDate' && req.body[field] ? new Date(req.body[field]) : req.body[field];
    }
  });

  await user.save();
  return res.json({ success: true, message: 'Profile updated', data: serializeProfile(user) });
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current and new password are required' });
  }

  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const matched = await user.matchPassword(currentPassword);
  if (!matched) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  user.password = newPassword;
  await user.save();

  return res.json({ success: true, message: 'Password updated' });
});

const getThemeSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  return res.json({
    success: true,
    data: {
      theme: user.theme || 'system',
    },
  });
});

const updateThemeSettings = asyncHandler(async (req, res) => {
  const theme = ['light', 'dark', 'system'].includes(req.body.theme) ? req.body.theme : 'system';
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  user.theme = theme;
  await user.save();

  return res.json({
    success: true,
    message: 'Theme updated',
    data: {
      theme: user.theme,
    },
  });
});

const getOrganizationSettings = asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  return res.json({
    success: true,
    data: {
      name: process.env.APP_NAME || 'ZEROWALL',
      email: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
      clientUrl: getClientUrl(),
    },
  });
});

module.exports = {
  getMyProfile,
  updateMyProfile,
  changePassword,
  getThemeSettings,
  updateThemeSettings,
  getOrganizationSettings,
  serializeProfile,
};
