const Project = require('../models/Project');
const asyncHandler = require('../utils/asyncHandler');

const reports = asyncHandler(async (req, res) => {
  const projects = await Project.find();
  const byStatus = projects.reduce((acc, project) => {
    acc[project.status] = (acc[project.status] || 0) + 1;
    return acc;
  }, {});

  const byPriority = projects.reduce((acc, project) => {
    acc[project.priority] = (acc[project.priority] || 0) + 1;
    return acc;
  }, {});

  const billing = projects.reduce(
    (acc, project) => {
      acc.received += Number(project.recv || 0);
      acc.balance += Number(project.balance || 0);
      acc.total += Number(project.value || 0);
      return acc;
    },
    { received: 0, balance: 0, total: 0 },
  );

  return res.json({
    success: true,
    data: {
      byStatus,
      byPriority,
      billing,
      totalProjects: projects.length,
    },
  });
});

module.exports = {
  reports,
};
