const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createEmployee,
  deleteEmployee,
  getEmployee,
  getEmployeeTasks,
  getEmployeeWorkload,
  listEmployees,
  updateEmployee,
  updateEmployeeRole,
} = require('../controllers/employee.controller');
const {
  bulkDeleteTimesheets,
  bulkUpdateTimesheets,
  exportTimesheets,
  getEmployeeTimesheets,
} = require('../controllers/timesheet.controller');
const { getEmployeeDocuments } = require('../controllers/upload.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listEmployees);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('email').notEmpty().trim(),
  validateRequest,
  createEmployee,
);
router.get('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEmployee);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), updateEmployee);
router.put('/:id/role', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), updateEmployeeRole);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteEmployee);
router.get('/:id/tasks', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEmployeeTasks);
router.get('/:id/workload', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEmployeeWorkload);
router.get('/:id/timesheets', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEmployeeTimesheets);
router.get('/:id/timesheets/export', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), exportTimesheets);
router.post('/:id/timesheets/bulk-update', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), bulkUpdateTimesheets);
router.post('/:id/timesheets/bulk-delete', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), bulkDeleteTimesheets);
router.get('/:id/documents', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), getEmployeeDocuments);

module.exports = router;
