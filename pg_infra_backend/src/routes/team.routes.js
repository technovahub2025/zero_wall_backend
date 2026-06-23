const express = require('express');
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

const router = express.Router();

router.get('/', listTeam);
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), createTeamMember);
router.get('/members', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listMembers);
router.get('/invites', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), listPendingInvites);
router.post('/invite', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), inviteMember);
router.post('/:id/resend', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), resendInvite);
router.delete('/:id/invite', requireAuth, requireRole('superadmin'), revokeInvite);
router.put('/:id/role', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), changeMemberRole);
router.delete('/:id', requireAuth, requireRole('superadmin'), removeMember);

module.exports = router;
