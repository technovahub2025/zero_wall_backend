const express = require('express');
const { listActions } = require('../controllers/action.controller');

const router = express.Router();

router.get('/', listActions);

module.exports = router;
