const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createManualLog,
  deleteTimerLog,
  getActiveTimer,
  getMyLogs,
  startTimer,
  stopTimer,
} = require('../controllers/timer.controller');

const router = express.Router();

router.get('/active', requireAuth, getActiveTimer);
router.get('/logs/mine', requireAuth, getMyLogs);
router.post(
  '/start',
  requireAuth,
  body('projectId').notEmpty().trim(),
  validateRequest,
  startTimer,
);
router.put('/stop', requireAuth, stopTimer);
router.post('/manual', requireAuth, createManualLog);
router.delete('/:id', requireAuth, deleteTimerLog);

module.exports = router;
