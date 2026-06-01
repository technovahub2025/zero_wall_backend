const express = require('express');
const { listStages } = require('../controllers/stage.controller');

const router = express.Router();

router.get('/', listStages);

module.exports = router;
