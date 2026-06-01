const express = require('express');
const { createTeamMember, listTeam } = require('../controllers/team.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', listTeam);
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'manager'), createTeamMember);

module.exports = router;
