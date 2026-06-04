const multer = require('multer');

const storage = multer.memoryStorage();

const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function fileFilter(req, file, cb) {
  if (allowedTypes.has(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('File type not allowed'), false);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = {
  upload,
  uploadSingle: upload.single('file'),
  uploadAvatar: upload.single('avatar'),
};
