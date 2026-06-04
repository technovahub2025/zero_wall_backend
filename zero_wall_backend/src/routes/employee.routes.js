const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createEmployee,
  deactivateEmployee,
  getEmployee,
  getEmployeeTasks,
  getEmployeeWorkload,
  getEmployeeTimesheets,
  listEmployees,
  updateEmployee,
  updateEmployeeRole,
} = require('../controllers/employee.controller');
const { getEmployeeDocuments } = require('../controllers/upload.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin'), listEmployees);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin'),
  body('email').notEmpty().trim(),
  validateRequest,
  createEmployee,
);
router.get('/:id', requireAuth, requireRole('superadmin', 'admin'), getEmployee);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), updateEmployee);
router.put('/:id/role', requireAuth, requireRole('superadmin'), updateEmployeeRole);
router.delete('/:id', requireAuth, requireRole('superadmin'), deactivateEmployee);
router.get('/:id/tasks', requireAuth, requireRole('superadmin', 'admin'), getEmployeeTasks);
router.get('/:id/workload', requireAuth, requireRole('superadmin', 'admin'), getEmployeeWorkload);
router.get('/:id/timesheets', requireAuth, requireRole('superadmin', 'admin'), getEmployeeTimesheets);
router.get('/:id/documents', requireAuth, requireRole('superadmin', 'admin'), getEmployeeDocuments);

module.exports = router;
