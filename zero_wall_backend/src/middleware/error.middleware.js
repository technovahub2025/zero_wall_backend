function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  res.status(404);
  next(error);
}

function errorHandler(error, req, res, next) {
  if (error?.code === 11000) {
    const duplicateField = Object.keys(error.keyValue || {})[0];
    const duplicateValue = duplicateField ? error.keyValue[duplicateField] : '';
    const fieldLabel = duplicateField ? duplicateField.replace(/([A-Z])/g, ' $1').toLowerCase() : 'record';

    return res.status(409).json({
      success: false,
      message: duplicateValue
        ? `${fieldLabel} already exists`
        : 'Duplicate record already exists',
    });
  }

  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(statusCode).json({
    success: false,
    message: error.message || 'Server error',
  });
}

module.exports = {
  notFound,
  errorHandler,
};
