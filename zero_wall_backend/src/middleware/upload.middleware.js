const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const configureCloudinary = require('../config/cloudinary');

const cloudinary = configureCloudinary();

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'pg_infrastructure',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
  },
});

const upload = multer({ storage });

module.exports = upload;
