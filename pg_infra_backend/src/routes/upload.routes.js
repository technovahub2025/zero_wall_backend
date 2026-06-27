const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { uploadSingle, uploadAvatar } = require('../middleware/uploadMiddleware');
const { requireUploadContentType, rejectUnsupportedUploadType } = require('../middleware/uploadValidation');
const {
  deleteDocument,
  getProjectDocuments,
  uploadAsset,
  uploadAvatar: uploadAvatarController,
  uploadDocument,
  updateDocument,
} = require('../controllers/upload.controller');

const router = express.Router();

router.post('/asset', requireAuth, requireUploadContentType, uploadSingle, rejectUnsupportedUploadType, uploadAsset);
router.post('/avatar', requireAuth, uploadAvatar, uploadAvatarController);
router.post('/document', requireAuth, uploadSingle, uploadDocument);
router.put('/:publicId', requireAuth, requireRole('superadmin', 'admin'), uploadSingle, updateDocument);
router.delete('/:publicId', requireAuth, requireRole('superadmin'), deleteDocument);
router.get('/project/:id', requireAuth, getProjectDocuments);

module.exports = router;
