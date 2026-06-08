const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const legacyUpload = require('../middleware/upload.middleware');
const { uploadSingle, uploadAvatar } = require('../middleware/uploadMiddleware');
const {
  deleteDocument,
  getProjectDocuments,
  uploadAsset,
  uploadAvatar: uploadAvatarController,
  uploadDocument,
  updateDocument,
} = require('../controllers/upload.controller');

const router = express.Router();

router.post('/asset', legacyUpload.single('file'), uploadAsset);
router.post('/avatar', requireAuth, uploadAvatar, uploadAvatarController);
router.post('/document', requireAuth, uploadSingle, uploadDocument);
router.put('/:publicId', requireAuth, requireRole('superadmin', 'admin'), uploadSingle, updateDocument);
router.delete('/:publicId', requireAuth, requireRole('superadmin', 'admin'), deleteDocument);
router.get('/project/:id', requireAuth, getProjectDocuments);

module.exports = router;
