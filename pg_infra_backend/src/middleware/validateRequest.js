const { validationResult } = require('express-validator');

function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return next();
  }

  return res.status(400).json({
    success: false,
    errors: result.array().map((error) => ({
      field: error.path || error.param || 'unknown',
      message: error.msg || 'Invalid value',
    })),
  });
}

module.exports = validateRequest;
