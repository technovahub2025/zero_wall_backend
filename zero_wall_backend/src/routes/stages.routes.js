const express = require('express');
const {
  approveStage,
  createStage,
  deleteStage,
  listStages,
  updateStage,
} = require('../controllers/stage.controller');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'employee'), listStages);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin'),
  body('stageNo').notEmpty().trim(),
  body('stageName').notEmpty().trim(),
  validateRequest,
  createStage,
);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), updateStage);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteStage);
router.put('/:id/approval', requireAuth, requireRole('superadmin'), approveStage);

module.exports = router;
