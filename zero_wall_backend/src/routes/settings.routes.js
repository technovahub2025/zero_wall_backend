const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  changePassword,
  getMyProfile,
  getOrganizationSettings,
  getThemeSettings,
  updateMyProfile,
  updateThemeSettings,
} = require('../controllers/settings.controller');

const router = express.Router();

router.get('/profile', requireAuth, getMyProfile);
router.put('/profile', requireAuth, updateMyProfile);
router.put(
  '/password',
  requireAuth,
  body('currentPassword').notEmpty().trim(),
  body('newPassword').isLength({ min: 8 }),
  validateRequest,
  changePassword,
);
router.get('/theme', requireAuth, getThemeSettings);
router.put(
  '/theme',
  requireAuth,
  body('theme').isIn(['light', 'dark', 'system']),
  validateRequest,
  updateThemeSettings,
);
router.get('/org', requireAuth, requireRole('superadmin'), getOrganizationSettings);

module.exports = router;
