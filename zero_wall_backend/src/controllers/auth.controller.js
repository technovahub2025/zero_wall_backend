const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const asyncHandler = require('../utils/asyncHandler');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../utils/jwt');

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  };
}

function refreshCookieOptions() {
  return {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'viewer' } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    name,
    email,
    passwordHash,
    role,
  });

  const payload = { sub: user._id.toString(), email: user.email, role: user.role };
  const tokenId = crypto.randomUUID();
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ ...payload, jti: tokenId });

  await RefreshToken.create({
    user: user._id,
    tokenId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.cookie('accessToken', accessToken, cookieOptions());
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());

  return res.status(201).json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
    },
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const payload = { sub: user._id.toString(), email: user.email, role: user.role };
  const tokenId = crypto.randomUUID();
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ ...payload, jti: tokenId });

  await RefreshToken.create({
    user: user._id,
    tokenId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  res.cookie('accessToken', accessToken, cookieOptions());
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());

  return res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      accessToken,
    },
  });
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
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

  if (!tokenDoc) {
    return res.status(401).json({ success: false, message: 'Refresh token revoked' });
  }

  const user = await User.findById(decoded.sub);
  if (!user || !user.isActive) {
    return res.status(401).json({ success: false, message: 'User not active' });
  }

  const payload = { sub: user._id.toString(), email: user.email, role: user.role };
  const accessToken = signAccessToken(payload);
  res.cookie('accessToken', accessToken, cookieOptions());

  return res.json({
    success: true,
    data: { accessToken },
  });
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      await RefreshToken.updateOne(
        { tokenId: decoded.jti },
        { $set: { revokedAt: new Date() } },
      );
    } catch (error) {
      // ignore invalid token on logout
    }
  }

  res.clearCookie('accessToken', cookieOptions());
  res.clearCookie('refreshToken', refreshCookieOptions());

  return res.json({ success: true, message: 'Logged out' });
});

const me = asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const decoded = verifyAccessToken(token);
  const user = await User.findById(decoded.sub);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  return res.json({
    success: true,
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    },
  });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
};
