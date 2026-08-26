const app = require('../server');

module.exports = (req, res) => {
  const forwarded = req.headers['x-forwarded-uri'] || req.headers['x-original-uri'];
  if (typeof forwarded === 'string' && forwarded.startsWith('/')) {
    req.url = forwarded;
  }
  return app(req, res);
};
