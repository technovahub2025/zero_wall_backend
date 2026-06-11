const rateLimit = require('express-rate-limit');
const xss = require('xss');

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
  }

  if (typeof value === 'string') {
    return xss(value);
  }

  return value;
}

function sanitizeKeysInPlace(target) {
  if (!target || typeof target !== 'object') {
    return target;
  }

  for (const key of Object.keys(target)) {
    const safeKey = key.replace(/[\$\.]/g, '_');
    const nextValue = target[key];
    delete target[key];

    if (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) {
      sanitizeKeysInPlace(nextValue);
    }

    target[safeKey] = sanitizeValue(nextValue);
  }

  return target;
}

const sanitizeMongo = (req, _res, next) => {
  sanitizeKeysInPlace(req.body);
  sanitizeKeysInPlace(req.params);
  next();
};

const sanitizeXSS = (req, _res, next) => {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      req.query[key] = sanitizeValue(req.query[key]);
    }
  }
  next();
};

const securityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

const createRateLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message },
  });

const authRateLimit = createRateLimit(
  15 * 60 * 1000,
  process.env.NODE_ENV === 'production' ? 10 : 100,
  'Too many auth attempts. Try again in 15 minutes.',
);
const apiRateLimit = createRateLimit(
  15 * 60 * 1000,
  process.env.NODE_ENV === 'production' ? 200 : 1000,
  'Too many requests. Slow down.',
);
const uploadRateLimit = createRateLimit(60 * 60 * 1000, 50, 'Upload limit reached. Try again in an hour.');

module.exports = {
  sanitizeMongo,
  sanitizeXSS,
  securityHeaders,
  createRateLimit,
  authRateLimit,
  apiRateLimit,
  uploadRateLimit,
};
