const ActionItem = require('../models/ActionItem');
const asyncHandler = require('../utils/asyncHandler');

const listActions = asyncHandler(async (req, res) => {
  const actions = await ActionItem.find().sort({ target: 1 });
  return res.json({
    success: true,
    data: actions.map((action) => ({
      id: action._id,
      n: action.n,
      proj: action.proj,
      client: action.client,
      status: action.status,
      pri: action.pri,
      stage: action.stage,
      action: action.action,
      resp: action.resp,
      target: action.target,
      decision: action.decision,
      isClosed: action.isClosed,
    })),
  });
});

module.exports = {
  listActions,
};
