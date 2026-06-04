const express = require('express');
const {
  getDashboard,
  getEmployeeDashboard,
  getSuperadminDashboard,
} = require('../controllers/dashboard.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'employee'), getDashboard);
router.get('/superadmin', requireAuth, requireRole('superadmin', 'admin'), getSuperadminDashboard);
router.get('/employee', requireAuth, requireRole('superadmin', 'admin', 'employee'), getEmployeeDashboard);

module.exports = router;
