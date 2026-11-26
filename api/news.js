// Vercel: notícias por RSS (mesma lógica do servidor local)
const { getNews } = require('../lib/news');
module.exports = async (req, res) => {
  try {
    const n = await getNews();
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ items: n.data, errors: n.errors, at: n.at });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
