const streamifier = require('streamifier');
const asyncHandler = require('../utils/asyncHandler');
const configureCloudinary = require('../config/cloudinary');
const Document = require('../models/Document');
const User = require('../models/User');
const Project = require('../models/Project');
const Stage = require('../models/Stage');
const { getFileType } = require('../models/Document');
const { logAuditEvent, logUploadAttempt } = require('../middleware/auditLog');

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

  await logUploadAttempt({
    req,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    outcome: 'attempt',
  });

  const result = await uploadToCloudinary(req.file.buffer, {
    folder: 'pg_infra/assets',
    use_filename: true,
    unique_filename: true,
    resource_type: 'auto',
  });
  await logUploadAttempt({
    req,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    outcome: 'success',
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'file_uploaded',
    resource: 'upload',
    resourceId: result.public_id,
    metadata: { filename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size },
  });

  return res.status(201).json({
    success: true,
    data: {
      url: result.secure_url,
      publicId: result.public_id,
      mimetype: req.file.mimetype,
      size: req.file.size,
    },
  });
});

const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const { employeeId } = req.body;
  const targetUserId = employeeId ? String(employeeId) : String(req.user.id);
  const canEditTarget = !employeeId || targetUserId === String(req.user.id) || ['superadmin', 'admin', 'project_manager'].includes(req.user.role);
  if (!canEditTarget) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }

  const user = await User.findById(targetUserId).select('+avatarPublicId');
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
    folder: 'pg_infra/avatars',
    public_id: `avatar_${user._id}`,
    overwrite: true,
    resource_type: 'image',
    transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }],
  });

  user.avatar = result.secure_url;
  user.avatarPublicId = result.public_id;
  await user.save();
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'file_uploaded',
    resource: 'avatar',
    resourceId: result.public_id,
    metadata: { employeeId: targetUserId, mimeType: req.file.mimetype, size: req.file.size },
  });

  return res.json({
    success: true,
    message: employeeId ? 'Employee avatar uploaded' : 'Avatar uploaded',
    avatarUrl: result.secure_url,
    data: { avatarUrl: result.secure_url, employeeId: targetUserId, updatedAt: user.updatedAt },
  });
});

const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const { projectId, stageId, employeeId, category = 'other' } = req.body;
  const folder = projectId
    ? `pg_infra/projects/${projectId}`
    : employeeId
      ? `pg_infra/employees/${employeeId}`
      : 'pg_infra/general';

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

  await logUploadAttempt({
    req,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    outcome: 'success',
  });
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'file_uploaded',
    resource: 'document',
    resourceId: String(document._id),
    metadata: { filename: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size },
  });

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
  await logAuditEvent({
    req,
    userId: req.user?.id || null,
    action: 'file_deleted',
    resource: 'document',
    resourceId: publicId,
  });

  return res.json({
    success: true,
    message: 'Document deleted',
  });
});

const updateDocument = asyncHandler(async (req, res) => {
  const publicId = decodeURIComponent(req.params.publicId);
  const document = await Document.findOne({ publicId });

  if (!document) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  const { originalName, category } = req.body;
  if (originalName !== undefined) {
    document.originalName = String(originalName || '').trim() || document.originalName;
  }
  if (category !== undefined) {
    document.category = category || document.category;
  }

  if (req.file) {
    const folder = document.project
      ? `pg_infra/projects/${document.project}`
      : document.employee
        ? `pg_infra/employees/${document.employee}`
        : 'pg_infra/general';

    const replacement = await uploadToCloudinary(req.file.buffer, {
      folder,
      use_filename: true,
      unique_filename: true,
      resource_type: 'auto',
    });

    try {
      await cloudinary.uploader.destroy(document.publicId, { resource_type: 'auto' });
    } catch (error) {
      // ignore cleanup failure
    }

    document.filename = replacement.original_filename || req.file.originalname;
    document.originalName = String(originalName || req.file.originalname || document.originalName).trim();
    document.cloudinaryUrl = replacement.secure_url;
    document.publicId = replacement.public_id;
    document.fileType = getFileType(req.file.mimetype);
    document.mimeType = req.file.mimetype;
    document.size = req.file.size;
    await logAuditEvent({
      req,
      userId: req.user?.id || null,
      action: 'file_uploaded',
      resource: 'document',
      resourceId: String(document._id),
      metadata: { filename: document.originalName, mimeType: req.file.mimetype, size: req.file.size },
    });
  }

  await document.save();

  const populated = await Document.findById(document._id)
    .populate('uploadedBy', 'name avatar role employeeId')
    .populate('project', 'projectName clientName')
    .populate('stage', 'stageName stageNo')
    .populate('employee', 'name avatar role employeeId');

  return res.json({
    success: true,
    message: 'Document updated',
    data: serializeDocument(populated),
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
  updateDocument,
  getProjectDocuments,
  getEmployeeDocuments,
  uploadToCloudinary,
  serializeDocument,
};
