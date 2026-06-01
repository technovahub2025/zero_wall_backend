const express = require('express');
const { reports } = require('../controllers/report.controller');

const router = express.Router();

router.get('/', reports);

module.exports = router;
