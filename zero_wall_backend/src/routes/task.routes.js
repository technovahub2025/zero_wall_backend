const express = require('express');
const { body } = require('express-validator');
const {
  addComment,
  createTask,
  deleteTask,
  getMyTasks,
  getTaskById,
  listTasks,
  reorderTasks,
  updateTask,
} = require('../controllers/task.controller');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/mine', requireAuth, getMyTasks);
router.get('/', requireAuth, requireRole('superadmin', 'admin'), listTasks);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin'),
  body('title').notEmpty().trim(),
  body('project').notEmpty().trim(),
  validateRequest,
  createTask,
);
router.put('/reorder', requireAuth, requireRole('superadmin', 'admin'), reorderTasks);
router.get('/:id', requireAuth, getTaskById);
router.put('/:id', requireAuth, updateTask);
router.delete('/:id', requireAuth, requireRole('superadmin', 'admin'), deleteTask);
router.post('/:id/comments', requireAuth, addComment);

module.exports = router;
