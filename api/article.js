const { article } = require('../lib/reader');
module.exports = async (req, res) => {
  try { res.setHeader('Cache-Control', 's-maxage=3600'); res.status(200).json(await article(String(req.query.url || ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
