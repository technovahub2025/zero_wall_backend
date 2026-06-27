const crypto = require('crypto');

const CSRF_COOKIE = 'pg-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  };
}

function issueCsrfToken(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, createCsrfToken(), csrfCookieOptions());
  }
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const exemptPaths = new Set([
    '/api/auth/refresh-token',
    '/api/auth/logout',
  ]);
  if (exemptPaths.has(req.originalUrl || req.url)) {
    return next();
  }

  const hasCookieAuth = Boolean(req.cookies?.refreshToken || req.cookies?.accessToken);
  const hasBearerAuth = Boolean(String(req.headers.authorization || '').startsWith('Bearer '));
  if (!hasCookieAuth && !hasBearerAuth) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'] || req.headers['csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF token validation failed',
    });
  }

  return next();
}

module.exports = {
  CSRF_COOKIE,
  createCsrfToken,
  issueCsrfToken,
  requireCsrf,
};
