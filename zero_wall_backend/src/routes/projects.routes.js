const express = require('express');
const {
  createProject,
  deleteProject,
  getProject,
  getProjectSummary,
  listProjects,
  listProjectStages,
  exportProjects,
  reorderProjects,
  updateProject,
} = require('../controllers/project.controller');
const { getProjectDocuments } = require('../controllers/upload.controller');
const { body } = require('express-validator');
const validateRequest = require('../middleware/validateRequest');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/export/excel', requireAuth, requireRole('superadmin', 'admin'), exportProjects);
router.get('/', requireAuth, requireRole('superadmin', 'admin'), listProjects);
router.put('/reorder', requireAuth, requireRole('superadmin', 'admin'), reorderProjects);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin'),
  body('projectName').notEmpty().trim(),
  body('clientName').notEmpty().trim(),
  validateRequest,
  createProject,
);
router.get('/:id/summary', requireAuth, requireRole('superadmin', 'admin', 'employee'), getProjectSummary);
router.get('/:id/documents', requireAuth, requireRole('superadmin', 'admin', 'employee'), getProjectDocuments);
router.get('/:id', requireAuth, requireRole('superadmin', 'admin', 'employee'), getProject);
router.get('/:projectId/stages', requireAuth, requireRole('superadmin', 'admin', 'employee'), listProjectStages);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin'), updateProject);
router.delete('/:id', requireAuth, requireRole('superadmin'), deleteProject);

module.exports = router;
