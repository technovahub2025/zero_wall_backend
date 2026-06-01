const TeamMember = require('../models/TeamMember');
const asyncHandler = require('../utils/asyncHandler');

const listTeam = asyncHandler(async (req, res) => {
  const team = await TeamMember.find().sort({ name: 1 });
  return res.json({
    success: true,
    data: team.map((member) => ({
      id: member._id,
      initials: member.initials,
      name: member.name,
      role: member.role,
      projects: member.projects,
      color: member.color,
      online: member.online,
      email: member.email,
      phone: member.phone,
      isActive: member.isActive,
    })),
  });
});

const createTeamMember = asyncHandler(async (req, res) => {
  const member = await TeamMember.create(req.body);
  return res.status(201).json({
    success: true,
    data: {
      id: member._id,
      initials: member.initials,
      name: member.name,
      role: member.role,
      projects: member.projects,
      color: member.color,
      online: member.online,
      email: member.email,
      phone: member.phone,
      isActive: member.isActive,
    },
  });
});

module.exports = {
  listTeam,
  createTeamMember,
};
