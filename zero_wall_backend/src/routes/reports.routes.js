const express = require('express');
const {
  getClientContributionReport,
  getEngineerUtilization,
  getPriorityReport,
  getProjectStatusReport,
  getReportsBundle,
  getRevenueTrend,
  getStageCompletion,
  getTaskProgressReport,
  getTaskStatusReport,
  getTimesheetAnalyticsReport,
  reports,
} = require('../controllers/report.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), reports);
router.get('/bundle', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getReportsBundle);
router.get('/project-status', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getProjectStatusReport);
router.get('/priority', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getPriorityReport);
router.get('/task-status', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getTaskStatusReport);
router.get('/task-progress', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getTaskProgressReport);
router.get('/revenue-trend', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getRevenueTrend);
router.get('/stage-completion', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getStageCompletion);
router.get('/engineer-utilization', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEngineerUtilization);
router.get('/client-contribution', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getClientContributionReport);
router.get('/timesheet-analytics', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getTimesheetAnalyticsReport);

module.exports = router;
