const express = require('express');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const {
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient,
} = require('../controllers/client.controller');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager', 'employee'), listClients);
router.get('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager', 'employee'), getClient);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('clientName').notEmpty().trim(),
  validateRequest,
  createClient,
);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), updateClient);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteClient);

module.exports = router;
