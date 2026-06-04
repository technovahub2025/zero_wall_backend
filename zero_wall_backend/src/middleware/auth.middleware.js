const { verifyAccessToken } = require('../utils/jwt');
const { requireRole } = require('./role.middleware');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = {
      id: decoded.id || decoded.sub,
      role: decoded.role,
      email: decoded.email,
    };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = {
  requireAuth,
  requireRole,
};
