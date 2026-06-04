const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createInvoice,
  deleteInvoice,
  getBillingSummary,
  getInvoiceByProject,
  listInvoices,
  updateInvoice,
} = require('../controllers/billing.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin'), listInvoices);
router.get('/summary', requireAuth, requireRole('superadmin', 'admin'), getBillingSummary);
router.get('/project/:projectId', requireAuth, requireRole('superadmin', 'admin', 'employee'), getInvoiceByProject);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin'),
  body('project').notEmpty().trim(),
  validateRequest,
  createInvoice,
);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), updateInvoice);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteInvoice);

module.exports = router;
