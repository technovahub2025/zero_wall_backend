const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  bulkDeleteTimesheets,
  bulkUpdateTimesheets,
  createTimesheetFilter,
  deleteTimesheetFilter,
  exportTimesheets,
  getEmployeeTimesheets,
  getMyTimesheets,
  listTimesheetFilters,
  updateTimesheetFilter,
} = require('../controllers/timesheet.controller');

const router = express.Router();

router.get('/', requireAuth, listTimesheetFilters);
router.post('/', requireAuth, body('name').notEmpty().trim(), validateRequest, createTimesheetFilter);
router.put('/:id', requireAuth, updateTimesheetFilter);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteTimesheetFilter);
router.post('/bulk-update', requireAuth, bulkUpdateTimesheets);
router.post('/bulk-delete', requireAuth, requireRole('superadmin'), bulkDeleteTimesheets);
router.get('/export', requireAuth, exportTimesheets);

module.exports = router;
