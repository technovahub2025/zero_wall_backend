const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { listAuditLogs } = require('../controllers/audit.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin'), listAuditLogs);

module.exports = router;
