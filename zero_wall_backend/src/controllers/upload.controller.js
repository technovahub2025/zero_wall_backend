const streamifier = require('streamifier');
const asyncHandler = require('../utils/asyncHandler');
const configureCloudinary = require('../config/cloudinary');
const Document = require('../models/Document');
const User = require('../models/User');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const { getFileType } = require('../models/Document');

const cloudinary = configureCloudinary();

function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });

    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function serializeDocument(doc) {
  const item = doc.toObject ? doc.toObject({ virtuals: true }) : doc;
  return {
    id: item._id,
    project: item.project,
    stage: item.stage,
    employee: item.employee,
    filename: item.filename,
    originalName: item.originalName,
    cloudinaryUrl: item.cloudinaryUrl,
    publicId: item.publicId,
    fileType: item.fileType,
    mimeType: item.mimeType,
    size: item.size,
    category: item.category,
    uploadedBy: item.uploadedBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

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

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const user = await User.findById(req.user.id).select('+avatarPublicId');
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (user.avatarPublicId) {
    try {
      await cloudinary.uploader.destroy(user.avatarPublicId);
    } catch (error) {
      // ignore cleanup failure
    }
  }

  const result = await uploadToCloudinary(req.file.buffer, {
    folder: 'zerowall/avatars',
    public_id: `avatar_${user._id}`,
    overwrite: true,
    resource_type: 'image',
    transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }],
  });

  user.avatar = result.secure_url;
  user.avatarPublicId = result.public_id;
  await user.save();

  return res.json({
    success: true,
    message: 'Avatar uploaded',
    avatarUrl: result.secure_url,
    data: { avatarUrl: result.secure_url },
  });
});

const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const { projectId, stageId, employeeId, category = 'other' } = req.body;
  const folder = projectId
    ? `zerowall/projects/${projectId}`
    : employeeId
      ? `zerowall/employees/${employeeId}`
      : 'zerowall/general';

  if (projectId) {
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
  }

  if (stageId) {
    const stage = await Stage.findById(stageId);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }
  }

  if (employeeId) {
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
  }

  const result = await uploadToCloudinary(req.file.buffer, {
    folder,
    use_filename: true,
    unique_filename: true,
    resource_type: 'auto',
  });

  const document = await Document.create({
    project: projectId || undefined,
    stage: stageId || undefined,
    employee: employeeId || undefined,
    filename: result.original_filename || req.file.originalname,
    originalName: req.file.originalname,
    cloudinaryUrl: result.secure_url,
    publicId: result.public_id,
    fileType: getFileType(req.file.mimetype),
    mimeType: req.file.mimetype,
    size: req.file.size,
    category,
    uploadedBy: req.user.id,
  });

  const populated = await Document.findById(document._id)
    .populate('uploadedBy', 'name avatar role employeeId')
    .populate('project', 'projectName clientName')
    .populate('stage', 'stageName stageNo')
    .populate('employee', 'name avatar role employeeId');

  return res.status(201).json({
    success: true,
    message: 'Document uploaded',
    data: serializeDocument(populated),
  });
});

const deleteDocument = asyncHandler(async (req, res) => {
  const publicId = decodeURIComponent(req.params.publicId);
  const document = await Document.findOne({ publicId }).populate('project', '_id');

  if (!document) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  if (req.user.role === 'admin' && !document.project) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
  await document.deleteOne();

  return res.json({
    success: true,
    message: 'Document deleted',
  });
});

const getProjectDocuments = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const documents = await Document.find({ project: id })
    .sort({ createdAt: -1 })
    .populate('uploadedBy', 'name avatar role employeeId')
    .populate('project', 'projectName clientName')
    .populate('stage', 'stageName stageNo')
    .populate('employee', 'name avatar role employeeId');

  return res.json({
    success: true,
    data: documents.map(serializeDocument),
  });
});

const getEmployeeDocuments = asyncHandler(async (req, res) => {
  const documents = await Document.find({ employee: req.params.id })
    .sort({ createdAt: -1 })
    .populate('uploadedBy', 'name avatar role employeeId')
    .populate('project', 'projectName clientName')
    .populate('stage', 'stageName stageNo')
    .populate('employee', 'name avatar role employeeId');

  return res.json({
    success: true,
    data: documents.map(serializeDocument),
  });
});

module.exports = {
  uploadAsset,
  uploadAvatar,
  uploadDocument,
  deleteDocument,
  getProjectDocuments,
  getEmployeeDocuments,
  uploadToCloudinary,
  serializeDocument,
};
