const asyncHandler = require('../utils/asyncHandler');

const uploadAsset = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  return res.status(201).json({
    success: true,
    data: {
      url: req.file.path,
      publicId: req.file.filename || req.file.public_id || '',
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
  });
});

module.exports = {
  uploadAsset,
};
