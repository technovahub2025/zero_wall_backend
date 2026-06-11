const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET;
}

function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET_KEY;
}

function generateAccessToken(userId, role) {
  return jwt.sign({ id: userId, role }, getAccessSecret(), {
    expiresIn: process.env.JWT_EXPIRE || process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

function generateRefreshToken(userId, tokenId = crypto.randomUUID()) {
  return jwt.sign({ id: userId, jti: tokenId }, getRefreshSecret(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

async function sendTokenResponse(user, statusCode, res) {
  const tokenId = crypto.randomUUID();
  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id, tokenId);

  await RefreshToken.create({
    user: user._id,
    tokenId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  res.cookie('accessToken', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, cookieOptions);

  return res.status(statusCode).json({
    success: true,
    accessToken,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      employeeId: user.employeeId,
      designation: user.designation,
      department: user.department,
      phone: user.phone,
      emergencyPhone: user.emergencyPhone,
    },
  });
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  sendTokenResponse,
};
