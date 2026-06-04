function getClientUrl() {
  const value = process.env.CLIENT_URL || 'http://localhost:5173';
  const normalized = String(value).trim().replace(/[.,]+$/, '');
  return normalized || 'http://localhost:5173';
}

module.exports = {
  getClientUrl,
};
