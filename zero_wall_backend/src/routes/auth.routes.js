const express = require('express');
const {
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
} = require('../controllers/auth.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.get('/me', requireAuth, me);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.post('/invite', requireAuth, requireRole('superadmin', 'admin'), inviteMember);
router.get('/invite/:token', validateInvite);
router.post('/accept-invite/:token', acceptInvite);

module.exports = router;
