const express = require('express');
const {
  addTeamMembers,
  createTeam,
  deleteTeam,
  getTeamById,
  listTeams,
  removeTeamMember,
  updateTeam,
} = require('../controllers/teams.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, listTeams);
router.get('/:id', requireAuth, getTeamById);
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), createTeam);
router.put('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), updateTeam);
router.delete('/:id', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), deleteTeam);
router.post('/:id/members', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), addTeamMembers);
router.delete('/:id/members/:memberId', requireAuth, requireRole('superadmin', 'admin', 'project_manager'), removeTeamMember);

module.exports = router;
