const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth } = require('../middleware/auth.middleware');
const {
  createManualLog,
  deleteTimerLog,
  getActiveTimer,
  startTimer,
  switchTimer,
  resumeTimer,
  pauseTimer,
  stopTimer,
} = require('../controllers/timer.controller');
const {
  bulkDeleteTimesheets,
  bulkUpdateTimesheets,
  exportTimesheets,
  getMyTimesheets,
} = require('../controllers/timesheet.controller');

const router = express.Router();

router.get('/active', requireAuth, getActiveTimer);
router.get('/logs/mine', requireAuth, getMyTimesheets);
router.get('/logs/export', requireAuth, exportTimesheets);
router.post(
  '/start',
  requireAuth,
  body('projectId').notEmpty().trim(),
  validateRequest,
  startTimer,
);
router.post(
  '/switch',
  requireAuth,
  body('projectId').notEmpty().trim(),
  body('taskId').notEmpty().trim(),
  body('note').notEmpty().trim(),
  validateRequest,
  switchTimer,
);
router.post(
  '/resume',
  requireAuth,
  body('taskId').notEmpty().trim(),
  validateRequest,
  resumeTimer,
);
router.put('/pause', requireAuth, body('reason').notEmpty().trim(), validateRequest, pauseTimer);
router.put('/stop', requireAuth, body('reason').notEmpty().trim(), validateRequest, stopTimer);
router.post('/manual', requireAuth, createManualLog);
router.post('/logs/bulk-update', requireAuth, bulkUpdateTimesheets);
router.post('/logs/bulk-delete', requireAuth, bulkDeleteTimesheets);
router.delete('/:id', requireAuth, deleteTimerLog);

module.exports = router;
