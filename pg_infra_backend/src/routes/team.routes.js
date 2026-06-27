const express = require('express');
const { body } = require('express-validator');
const {
  changeMemberRole,
  createTeamMember,
  inviteMember,
  listMembers,
  listPendingInvites,
  listTeam,
  removeMember,
  resendInvite,
  revokeInvite,
} = require('../controllers/team.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const validateRequest = require('../middleware/validateRequest');

const router = express.Router();

router.get('/', requireAuth, listTeam);
router.post(
  '/',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('name').notEmpty().trim().isLength({ max: 120 }),
  body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
  body('role').optional().isIn(['superadmin', 'admin', 'project_manager', 'employee']),
  validateRequest,
  createTeamMember,
);
router.get('/members', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listMembers);
router.get('/invites', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listPendingInvites);
router.post(
  '/invite',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('email').notEmpty().trim().isEmail().normalizeEmail(),
  body('role').optional().isIn(['superadmin', 'admin', 'project_manager', 'employee']),
  body('name').optional().trim().isLength({ max: 120 }),
  validateRequest,
  inviteMember,
);
router.post('/:id/resend', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), resendInvite);
router.delete('/:id/invite', requireAuth, requireRole('superadmin'), revokeInvite);
router.put(
  '/:id/role',
  requireAuth,
  requireRole('superadmin', 'admin', 'project_manager'),
  body('role').notEmpty().isIn(['superadmin', 'admin', 'project_manager', 'employee']),
  validateRequest,
  changeMemberRole,
);
router.delete('/:id', requireAuth, requireRole('superadmin'), removeMember);

module.exports = router;
