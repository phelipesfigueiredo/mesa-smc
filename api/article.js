const { article } = require('../lib/reader');
const { getNews, findNews } = require('../lib/news');
module.exports = async (req, res) => {
  const u = String(req.query.url || '');
  try { let fb = findNews(u); if (!fb) { try { await getNews(); fb = findNews(u); } catch {} }
    res.setHeader('Cache-Control', 's-maxage=3600'); res.status(200).json(await article(u, fb)); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
