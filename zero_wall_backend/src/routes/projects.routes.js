const express = require('express');
const {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} = require('../controllers/project.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', listProjects);
router.post('/', requireAuth, createProject);
router.get('/:id', getProject);
router.put('/:id', requireAuth, updateProject);
router.delete('/:id', requireAuth, deleteProject);

module.exports = router;
