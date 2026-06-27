const DEFAULT_CLIENT_URL = 'http://localhost:5173';
const DEFAULT_PRODUCTION_CLIENT_URLS = [
  'https://technovahub.in',
  'https://www.technovahub.in',
];

function normalizeOrigin(value) {
  const normalized = String(value || '').trim().replace(/[.,/]+$/, '');
  return normalized || '';
}

function getClientUrls() {
  const rawValues = [
    process.env.CLIENT_URL,
    process.env.CLIENT_URLS,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ORIGIN,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','));

  const urls = rawValues.map(normalizeOrigin).filter(Boolean);
  if (urls.length > 0) {
    const merged = process.env.NODE_ENV === 'production'
      ? [...urls, ...DEFAULT_PRODUCTION_CLIENT_URLS]
      : urls;
    return [...new Set(merged.map(normalizeOrigin).filter(Boolean))];
  }

  return process.env.NODE_ENV === 'production'
    ? DEFAULT_PRODUCTION_CLIENT_URLS
    : [DEFAULT_CLIENT_URL];
}

function getClientUrl() {
  return getClientUrls()[0] || DEFAULT_CLIENT_URL;
}

module.exports = {
  getClientUrl,
  getClientUrls,
  normalizeOrigin,
};
