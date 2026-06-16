function normalizeHours(value, fallback) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : fallback;
}

function getTokenExpiryMs(envKey, fallbackHours) {
  const hours = normalizeHours(process.env[envKey], fallbackHours);
  return hours * 60 * 60 * 1000;
}

function formatTokenExpiryLabel(envKey, fallbackHours) {
  const hours = normalizeHours(process.env[envKey], fallbackHours);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

module.exports = {
  getTokenExpiryMs,
  formatTokenExpiryLabel,
};
