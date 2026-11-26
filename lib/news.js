// --- Notícias (RSS) — o navegador não consegue ler RSS de outros sites, então o servidor busca e junta ---
const FEEDS = [
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/', 'en'],
  ['Cointelegraph', 'https://cointelegraph.com/rss', 'en'],
  ['Decrypt', 'https://decrypt.co/feed', 'en'],
  ['The Block', 'https://www.theblock.co/rss.xml', 'en'],
  ['Bitcoin Magazine', 'https://bitcoinmagazine.com/.rss/full/', 'en'],
  ['Livecoins', 'https://livecoins.com.br/feed/', 'pt'],
  ['Portal do Bitcoin', 'https://portaldobitcoin.uol.com.br/feed/', 'pt'],
  ['InfoMoney Cripto', 'https://www.infomoney.com.br/mercados/criptomoedas/feed/', 'pt'],
];
const decode = t => (t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function parseRss(xml, source, lang) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g) || [];
  return items.map(it => {
    const tag = n => { const m = it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)); return m ? m[1] : ''; };
    let url = decode(tag('link')); if (!url) { const m = it.match(/<link[^>]*href="([^"]+)"/); url = m ? m[1] : ''; }
    const date = Date.parse(decode(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')));
    return { title: decode(tag('title')), url, body: decode(tag('description') || tag('summary')).slice(0, 400), published_on: Math.floor((isNaN(date) ? Date.now() : date) / 1000), source, lang };
  }).filter(n => n.title && /^https:\/\//.test(n.url));
}
let newsCache = { at: 0, data: [], errors: [] };
async function getNews() {
  if (Date.now() - newsCache.at < 120000) return newsCache;
  const errors = [];
  const results = await Promise.all(FEEDS.map(async ([name, url, lang]) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 MesaSMC', Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseRss(await r.text(), name, lang);
    } catch (e) { errors.push(name + ': ' + e.message); return []; }
  }));
  const seen = new Set();
  const data = results.flat().filter(n => { const k = n.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.published_on - a.published_on).slice(0, 80);
  newsCache = { at: Date.now(), data, errors };
  if (errors.length) console.warn('Feeds com erro:', errors.join(' | '));
  return newsCache;
}

module.exports = { getNews, parseRss };
