const express = require('express');
const upload = require('../middleware/upload.middleware');
const { uploadAsset } = require('../controllers/upload.controller');

const router = express.Router();

router.post('/asset', upload.single('file'), uploadAsset);

module.exports = router;
