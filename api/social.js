const { getTweets } = require('../lib/social');
module.exports = async (req, res) => {
  try { res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300'); res.status(200).json(await getTweets()); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
