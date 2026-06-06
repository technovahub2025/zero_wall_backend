const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { getKanbanColumns, saveKanbanColumns } = require('../controllers/kanban.controller');

const router = express.Router();

router.get('/columns', requireAuth, getKanbanColumns);
router.put('/columns', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), saveKanbanColumns);

module.exports = router;
