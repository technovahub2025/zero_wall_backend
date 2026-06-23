const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createStageGuide,
  deleteStageGuide,
  listStageGuides,
  updateStageGuide,
} = require('../controllers/stageGuide.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager', 'employee'), listStageGuides);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('stageNo').notEmpty().trim(),
  body('stageName').notEmpty().trim(),
  validateRequest,
  createStageGuide,
);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), updateStageGuide);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteStageGuide);

module.exports = router;
