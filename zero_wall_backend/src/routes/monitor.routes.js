const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { getMonitorOverview } = require('../controllers/monitor.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin'), getMonitorOverview);

module.exports = router;
