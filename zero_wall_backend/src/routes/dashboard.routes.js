const express = require('express');
const { overview } = require('../controllers/dashboard.controller');

const router = express.Router();

router.get('/', overview);

module.exports = router;
