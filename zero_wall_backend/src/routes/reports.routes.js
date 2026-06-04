const express = require('express');
const {
  getEngineerUtilization,
  getPriorityReport,
  getProjectStatusReport,
  getRevenueTrend,
  getStageCompletion,
  getTaskStatusReport,
  reports,
} = require('../controllers/report.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin'), reports);
router.get('/project-status', requireAuth, requireRole('superadmin', 'admin'), getProjectStatusReport);
router.get('/priority', requireAuth, requireRole('superadmin', 'admin'), getPriorityReport);
router.get('/task-status', requireAuth, requireRole('superadmin', 'admin'), getTaskStatusReport);
router.get('/revenue-trend', requireAuth, requireRole('superadmin', 'admin'), getRevenueTrend);
router.get('/stage-completion', requireAuth, requireRole('superadmin', 'admin'), getStageCompletion);
router.get('/engineer-utilization', requireAuth, requireRole('superadmin', 'admin'), getEngineerUtilization);

module.exports = router;
