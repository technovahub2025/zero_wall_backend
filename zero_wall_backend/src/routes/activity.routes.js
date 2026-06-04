const express = require('express');
const { listActivityLogs } = require('../controllers/activity.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'employee'), listActivityLogs);

module.exports = router;
