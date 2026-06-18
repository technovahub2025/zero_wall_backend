const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const {
  sendTokenResponse,
  generateAccessToken,
} = require('../utils/generateToken');
const {
  sendEmail,
  inviteEmailTemplate,
  resetEmailTemplate,
} = require('../utils/sendEmail');
const { verifyRefreshToken } = require('../utils/jwt');
const { getClientUrl } = require('../utils/env');

const allowedRoles = ['superadmin', 'admin', 'project_manager', 'employee'];

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  };
}

function accessCookieOptions() {
  return {
    ...cookieOptions(),
    maxAge: 15 * 60 * 1000,
  };
}

function refreshCookieOptions() {
  return {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeLoginIdentifier(value = '') {
  return String(value || '').trim();
}

function normalizePhoneValue(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    theme: user.theme || 'system',
    employeeId: user.employeeId,
    designation: user.designation,
    department: user.department,
    phone: user.phone,
    emergencyPhone: user.emergencyPhone,
    updatedAt: user.updatedAt,
  };
}

function normalizeRole(role) {
  if (!role) {
    return 'employee';
  }

  return allowedRoles.includes(role) ? role : 'employee';
}

async function loadInviteUser(token) {
  const hashedToken = hashToken(token);
  const now = new Date();
  return User.findOne({
    $or: [
      {
        inviteToken: hashedToken,
        inviteExpiry: { $gt: now },
      },
      {
        inviteTokenPrevious: hashedToken,
        inviteExpiryPrevious: { $gt: now },
      },
      {
        inviteTokenHistory: {
          $elemMatch: {
            token: hashedToken,
            expiry: { $gt: now },
          },
        },
      },
    ],
  })
    .select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory')
    .populate('createdBy', 'name email role');
}

async function loadResetUser(token) {
  const hashedToken = hashToken(token);
  return User.findOne({
    resetToken: hashedToken,
    resetExpiry: { $gt: new Date() },
  });
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required',
    });
  }

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: 'Email already registered',
    });
  }

  const user = new User({
    name,
    email,
    role: normalizeRole(role),
    isActive: true,
  });
  user.password = password;
  user.lastLogin = new Date();
  await user.save();

  return sendTokenResponse(user, 201, res);
});

const login = asyncHandler(async (req, res) => {
  const { identifier, email, password } = req.body;
  const loginValue = normalizeLoginIdentifier(identifier || email);

  if (!loginValue || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email or mobile number and password are required',
    });
  }

  const normalizedEmail = loginValue.toLowerCase();
  const normalizedPhone = normalizePhoneValue(loginValue);

  const query = [
    { email: normalizedEmail },
  ];

  if (normalizedPhone) {
    query.push({ phone: loginValue });
    query.push({ phone: normalizedPhone });
  }

  const candidates = await User.find({ $or: query }).select('+passwordHash');
  const user = candidates.find((item) => {
    const phoneMatch = normalizedPhone && normalizePhoneValue(item.phone) === normalizedPhone;
    const emailMatch = String(item.email || '').toLowerCase() === normalizedEmail;
    return emailMatch || phoneMatch;
  });

  if (!user || !user.passwordHash) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
    });
  }

  const valid = await user.matchPassword(password);
  if (!valid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials',
    });
  }

  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account is inactive',
    });
  }

  user.lastLogin = new Date();
  await user.save();

  return sendTokenResponse(user, 200, res);
});

const me = asyncHandler(async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const rolesParam = req.query.roles || req.query.role;
  if (rolesParam) {
    const roles = String(rolesParam)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (roles.length > 0 && !roles.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }

  return res.json({
    success: true,
    user: publicUser(user),
  });
});

const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Refresh token missing' });
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }

  const tokenDoc = await RefreshToken.findOne({
    tokenId: decoded.jti,
    revokedAt: null,
  });

  if (tokenDoc) {
    const user = await User.findById(decoded.id || decoded.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not active' });
    }

    const accessToken = generateAccessToken(user._id, user.role);
    res.cookie('accessToken', accessToken, accessCookieOptions());
    return res.json({ success: true, accessToken });
  }

  const user = await User.findById(decoded.id || decoded.sub);
  if (!user || !user.isActive) {
    return res.status(401).json({ success: false, message: 'User not active' });
  }

  const accessToken = generateAccessToken(user._id, user.role);
  res.cookie('accessToken', accessToken, accessCookieOptions());
  return res.json({ success: true, accessToken });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      await RefreshToken.updateOne(
        { tokenId: decoded.jti },
        { $set: { revokedAt: new Date() } },
      );
    } catch (error) {
      // Ignore invalid token on logout.
    }
  }

  res.clearCookie('accessToken', accessCookieOptions());
  res.clearCookie('refreshToken', refreshCookieOptions());

  return res.json({ success: true, message: 'Logged out' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user) {
    return res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  }

  const token = user.generateResetToken();
  await user.save();

  const resetUrl = `${getClientUrl()}/reset-password/${token}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'ZEROWALL'} password reset`,
    html: resetEmailTemplate({ name: user.name, resetUrl }),
  });

  return res.json({ success: true, message: 'Reset link sent' });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  if (!/(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}/.test(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters and include uppercase, number, and special character',
    });
  }

  const user = await loadResetUser(token);
  if (!user) {
    return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
  }

  user.password = password;
  user.resetToken = undefined;
  user.resetExpiry = undefined;
  user.lastLogin = new Date();
  await user.save();

  return sendTokenResponse(user, 200, res);
});

const inviteMember = asyncHandler(async (req, res) => {
  const { email, name, role, phone, designation, department } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const inviteRole = normalizeRole(role);
  let user = await User.findOne({ email: String(email).toLowerCase() })
    .select('+inviteToken +inviteExpiry +inviteTokenPrevious +inviteExpiryPrevious +inviteTokenHistory');

  if (user && user.isActive && user.passwordHash && !user.inviteToken) {
    return res.status(409).json({ success: false, message: 'User already exists' });
  }

  if (!user) {
    user = new User({
      name: name || email.split('@')[0],
      email,
      role: inviteRole,
      phone: phone || '',
      designation: designation || '',
      department: department || '',
      createdBy: req.user?.id || null,
    });
  } else {
    user.name = name || user.name;
    user.role = inviteRole;
    user.phone = phone ?? user.phone;
    user.designation = designation ?? user.designation;
    user.department = department ?? user.department;
    user.createdBy = req.user?.id || user.createdBy;
  }

  const inviteToken = user.generateInviteToken();
  await user.save();

  const inviteUrl = `${getClientUrl()}/invite/${inviteToken}`;
  await sendEmail({
    to: user.email,
    subject: `${process.env.APP_NAME || 'PG Infrastructure'} invitation for ${user.name}`,
    html: inviteEmailTemplate({
      inviteeName: user.name,
      inviterName: req.user?.name || 'A teammate',
      role: user.role,
      inviteUrl,
    }),
  });

  return res.status(201).json({
    success: true,
    message: 'Invitation sent',
    data: {
      email: user.email,
      role: user.role,
    },
  });
});

const validateInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = await loadInviteUser(token);

  if (!user) {
    return res.status(400).json({ success: false, message: 'This invite has expired or is invalid' });
  }

  return res.json({
    success: true,
    data: {
      email: user.email,
      role: user.role,
      inviterName: user.createdBy?.name || 'A teammate',
      inviteeName: user.name,
    },
  });
});

const acceptInvite = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { name, phone, password, confirmPassword } = req.body;

  if (!name || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'Name, password, and confirm password are required',
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Passwords do not match' });
  }

  if (!/(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}/.test(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters and include uppercase, number, and special character',
    });
  }

  const user = await loadInviteUser(token);
  if (!user) {
    return res.status(400).json({ success: false, message: 'This invite has expired or is invalid' });
  }

  user.name = name;
  user.phone = phone || '';
  user.isActive = true;
  user.inviteToken = undefined;
  user.inviteExpiry = undefined;
  user.inviteTokenPrevious = undefined;
  user.inviteExpiryPrevious = undefined;
  user.inviteTokenHistory = [];
  user.password = password;
  user.lastLogin = new Date();
  await user.save();

  return sendTokenResponse(user, 200, res);
});

const refresh = refreshToken;

module.exports = {
  register,
  login,
  me,
  refresh,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  inviteMember,
  validateInvite,
  acceptInvite,
};
