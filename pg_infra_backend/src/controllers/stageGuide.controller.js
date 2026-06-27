const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const StageGuide = require('../models/StageGuide');
const { logActivity } = require('../utils/logActivity');

function serializeStageGuide(stageGuide) {
  const doc = stageGuide.toObject ? stageGuide.toObject({ virtuals: true }) : stageGuide;
  return {
    id: doc._id,
    stageNo: doc.stageNo,
    stageName: doc.stageName,
    stageDescription: doc.stageDescription,
    keyDeliverables: doc.keyDeliverables,
    approvalRequired: doc.approvalRequired,
    disciplines: doc.disciplines,
    duration: doc.duration,
    sequenceOrder: doc.sequenceOrder,
    isActive: doc.isActive,
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeStageGuideInput(body = {}, existing = null) {
  return {
    stageNo: body.stageNo ?? existing?.stageNo ?? '',
    stageName: body.stageName ?? existing?.stageName ?? '',
    stageDescription: body.stageDescription ?? existing?.stageDescription ?? '',
    keyDeliverables: body.keyDeliverables ?? existing?.keyDeliverables ?? '',
    approvalRequired: body.approvalRequired ?? existing?.approvalRequired ?? '',
    disciplines: body.disciplines ?? existing?.disciplines ?? '',
    duration: body.duration ?? existing?.duration ?? '',
    sequenceOrder: Number.isFinite(Number(body.sequenceOrder ?? body.order))
      ? Number(body.sequenceOrder ?? body.order)
      : existing?.sequenceOrder || 0,
    isActive:
      body.isActive === undefined || body.isActive === null || body.isActive === ''
        ? existing?.isActive ?? true
        : ['true', '1', 'yes', true].includes(String(body.isActive).toLowerCase()),
  };
}

async function safeLogStageGuideActivity(payload) {
  try {
    await logActivity({
      ...payload,
      entityType: 'other',
    });
  } catch (_error) {
    // Stage guide persistence should not fail if activity logging does.
  }
}

const listStageGuides = asyncHandler(async (_req, res) => {
  const stageGuides = await StageGuide.find({}).sort({ sequenceOrder: 1, stageNo: 1, createdAt: 1 });

  return res.json({
    success: true,
    data: stageGuides.map(serializeStageGuide),
  });
});

const createStageGuide = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  const stageGuide = await StageGuide.create({
    ...normalizeStageGuideInput(req.body),
    createdBy: req.user?.id || null,
  });

  await safeLogStageGuideActivity({
    actor: req.user?.id || null,
    action: 'stage_guide_created',
    entityId: stageGuide._id,
    title: `${stageGuide.stageName} added`,
    detail: `${stageGuide.stageNo} was added to the stage guide.`,
    tone: 'emerald',
    link: '/stage-guide',
    metadata: {
      stageNo: stageGuide.stageNo,
      stageName: stageGuide.stageName,
    },
  });

  return res.status(201).json({
    success: true,
    message: 'Stage guide created',
    data: serializeStageGuide(stageGuide),
  });
});

const updateStageGuide = asyncHandler(async (req, res) => {
  const stageGuide = await StageGuide.findById(req.params.id);
  if (!stageGuide) {
    return res.status(404).json({ success: false, message: 'Stage guide not found' });
  }

  Object.assign(stageGuide, normalizeStageGuideInput(req.body, stageGuide));
  stageGuide.updatedBy = req.user?.id || null;
  await stageGuide.save();

  await safeLogStageGuideActivity({
    actor: req.user?.id || null,
    action: 'stage_guide_updated',
    entityId: stageGuide._id,
    title: `${stageGuide.stageName} updated`,
    detail: `${stageGuide.stageNo} stage guide was updated.`,
    tone: 'blue',
    link: '/stage-guide',
    metadata: {
      stageNo: stageGuide.stageNo,
      stageName: stageGuide.stageName,
    },
  });

  return res.json({
    success: true,
    message: 'Stage guide updated',
    data: serializeStageGuide(stageGuide),
  });
});

const deleteStageGuide = asyncHandler(async (req, res) => {
  const stageGuide = await StageGuide.findById(req.params.id);
  if (!stageGuide) {
    return res.status(404).json({ success: false, message: 'Stage guide not found' });
  }

  await stageGuide.deleteOne();

  await safeLogStageGuideActivity({
    actor: req.user?.id || null,
    action: 'stage_guide_deleted',
    entityId: stageGuide._id,
    title: `${stageGuide.stageName} deleted`,
    detail: `${stageGuide.stageNo} stage guide was removed.`,
    tone: 'rose',
    link: '/stage-guide',
    metadata: {
      stageNo: stageGuide.stageNo,
      stageName: stageGuide.stageName,
    },
  });

  return res.json({
    success: true,
    message: 'Stage guide deleted',
  });
});

module.exports = {
  listStageGuides,
  createStageGuide,
  updateStageGuide,
  deleteStageGuide,
  serializeStageGuide,
};
