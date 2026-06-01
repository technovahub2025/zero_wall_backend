const StageLog = require('../models/StageLog');
const asyncHandler = require('../utils/asyncHandler');

const listStages = asyncHandler(async (req, res) => {
  const stages = await StageLog.find().sort({ start: 1 });
  return res.json({
    success: true,
    data: stages.map((stage) => ({
      id: stage._id,
      proj: stage.proj,
      client: stage.client,
      stageNo: stage.stageNo,
      stageName: stage.stageName,
      start: stage.start,
      endPlan: stage.endPlan,
      endActual: stage.endActual,
      status: stage.status,
      deliverable: stage.deliverable,
      approval: stage.approval,
      next: stage.next,
    })),
  });
});

module.exports = {
  listStages,
};
