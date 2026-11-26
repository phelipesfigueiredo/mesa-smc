const { translate } = require('../lib/reader');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  try { const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; res.status(200).json({ texts: await translate(b.texts, 'pt') }); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
