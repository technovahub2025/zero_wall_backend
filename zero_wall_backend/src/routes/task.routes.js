const express = require('express');
const { body } = require('express-validator');
const {
  addComment,
  approveTimeExtensionRequest,
  createTask,
  createTimeExtensionRequest,
  deleteTask,
  getMyTasks,
  getTaskCounts,
  getTaskById,
  listPendingTimeExtensionRequests,
  rejectTimeExtensionRequest,
  listTasks,
  reorderTasks,
  updateTask,
} = require('../controllers/task.controller');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/mine', requireAuth, getMyTasks);
router.get('/counts', requireAuth, getTaskCounts);
router.get('/time-extension-requests/pending', requireAuth, listPendingTimeExtensionRequests);
router.get('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listTasks);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('title').notEmpty().trim(),
  body('project').notEmpty().trim(),
  body('assignee').notEmpty().withMessage('Assignee is required'),
  body('startDate').notEmpty().withMessage('Start date is required').isISO8601({ strict: false }),
  body('dueDate').notEmpty().withMessage('Due date is required').isISO8601({ strict: false }),
  validateRequest,
  createTask,
);
router.put('/reorder', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), reorderTasks);
router.put('/time-extension-requests/:requestId/approve', requireAuth, approveTimeExtensionRequest);
router.put('/time-extension-requests/:requestId/reject', requireAuth, rejectTimeExtensionRequest);
router.get('/:id', requireAuth, getTaskById);
router.put('/:id', requireAuth, updateTask);
router.delete('/:id', requireAuth, requireRole('superadmin', 'admin'), deleteTask);
router.post('/:id/comments', requireAuth, addComment);
router.post('/:id/time-extension-requests', requireAuth, createTimeExtensionRequest);

module.exports = router;
