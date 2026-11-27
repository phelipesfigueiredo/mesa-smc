const { candles } = require('../../lib/market');
module.exports = async (req, res) => {
  try { const q = req.query; res.setHeader('Cache-Control', 's-maxage=3');
    res.status(200).json(await candles(String(q.symbol || ''), String(q.tf || ''), +q.limit || 500, q.mode === 'demo' ? 'demo' : 'live')); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
