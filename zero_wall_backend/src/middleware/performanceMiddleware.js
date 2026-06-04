const requestTimer = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 2000) {
      console.warn(`SLOW REQUEST: ${req.method} ${req.originalUrl} - ${duration}ms`);
    }
  });
  next();
};

const cacheControl = (maxAge = 0) => (req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  }
  next();
};

const jsonSizeLimit = (req, res, next) => {
  const contentLength = Number.parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 5 * 1024 * 1024) {
    return res.status(413).json({
      success: false,
      message: 'Request payload too large',
    });
  }
  next();
};

module.exports = {
  requestTimer,
  cacheControl,
  jsonSizeLimit,
};
