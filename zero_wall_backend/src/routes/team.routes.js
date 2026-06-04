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
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'manager'), createTeamMember);
router.get('/members', requireAuth, requireRole('superadmin', 'admin'), listMembers);
router.get('/invites', requireAuth, requireRole('superadmin', 'admin'), listPendingInvites);
router.post('/invite', requireAuth, requireRole('superadmin', 'admin'), inviteMember);
router.post('/:id/resend', requireAuth, requireRole('superadmin', 'admin'), resendInvite);
router.delete('/:id/invite', requireAuth, requireRole('superadmin', 'admin'), revokeInvite);
router.put('/:id/role', requireAuth, requireRole('superadmin'), changeMemberRole);
router.delete('/:id', requireAuth, requireRole('superadmin', 'admin'), removeMember);

module.exports = router;
