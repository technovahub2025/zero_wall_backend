const jwt = require('jsonwebtoken');

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || process.env.JWT_ACCESS_SECRET;
}

function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET_KEY;
}

function getAccessExpiry() {
  return process.env.JWT_EXPIRE || process.env.JWT_ACCESS_EXPIRES_IN || '15m';
}

function getRefreshExpiry() {
  return process.env.JWT_REFRESH_EXPIRE || process.env.JWT_REFRESH_EXPIRES_IN || '7d';
}

function signAccessToken(payload) {
  return jwt.sign(payload, getAccessSecret(), {
    expiresIn: getAccessExpiry(),
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, getRefreshSecret(), {
    expiresIn: getRefreshExpiry(),
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getAccessSecret,
  getRefreshSecret,
  getAccessExpiry,
  getRefreshExpiry,
};
