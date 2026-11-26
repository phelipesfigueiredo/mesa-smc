// Tweets das contas que mais movem cripto e mercado financeiro.
// Fonte 1: API oficial do X (precisa de X_BEARER_TOKEN, pago). Fonte 2: espelhos públicos Nitter por RSS (grátis, instáveis).
const ACCOUNTS = [
  // notícias rápidas e "breaking"
  ['WatcherGuru', 'Notícias'], ['tier10k', 'Notícias'], ['DeItaone', 'Macro'], ['WuBlockchain', 'Notícias'], ['BitcoinMagazine', 'Notícias'],
  // fluxo on-chain e baleias
  ['lookonchain', 'On-chain'], ['whale_alert', 'On-chain'], ['EmberCN', 'On-chain'],
  // macro e mercado tradicional
  ['KobeissiLetter', 'Macro'], ['zerohedge', 'Macro'], ['federalreserve', 'Fed'], ['NickTimiraos', 'Fed'],
  // pessoas que movem o mercado
  ['saylor', 'Institucional'], ['elonmusk', 'Influência'], ['cz_binance', 'Exchange'], ['VitalikButerin', 'Ethereum'], ['EricBalchunas', 'ETF'],
];
const NITTER = (process.env.NITTER_HOSTS || 'nitter.net,nitter.privacydev.net,nitter.poast.org,xcancel.com').split(',').map(s => s.trim()).filter(Boolean);
let cache = { at: 0, data: null };

const ent = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function viaX(token) {
  const users = ACCOUNTS.map(a => a[0]);
  // a busca aceita consultas curtas: divide as contas em grupos
  const groups = []; let cur = [];
  for (const u of users) { const q = [...cur, u].map(x => 'from:' + x).join(' OR '); if (q.length > 380) { groups.push(cur); cur = [u]; } else cur.push(u); }
  if (cur.length) groups.push(cur);
  const out = [];
  for (const g of groups) {
    const q = `(${g.map(x => 'from:' + x).join(' OR ')}) -is:retweet -is:reply`;
    const u = 'https://api.twitter.com/2/tweets/search/recent?max_results=50&tweet.fields=created_at,public_metrics,lang&expansions=author_id&user.fields=username,name,profile_image_url&query=' + encodeURIComponent(q);
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('X API ' + r.status + (j.title ? ': ' + j.title : ''));
    const users = new Map((j.includes?.users || []).map(x => [x.id, x]));
    for (const t of j.data || []) {
      const a = users.get(t.author_id) || {};
      out.push({ id: t.id, user: a.username, name: a.name, avatar: a.profile_image_url || '', text: t.text, at: Date.parse(t.created_at) / 1000,
        url: `https://x.com/${a.username}/status/${t.id}`, likes: t.public_metrics?.like_count || 0, rts: t.public_metrics?.retweet_count || 0, lang: t.lang });
    }
  }
  return out;
}

async function viaNitter() {
  const out = [], errors = [];
  let host = null;
  // descobre um espelho que esteja respondendo
  for (const hst of NITTER) {
    try { const r = await fetch(`https://${hst}/WatcherGuru/rss`, { headers: { 'User-Agent': 'Mozilla/5.0 MesaSMC' }, signal: AbortSignal.timeout(6000) });
      const t = await r.text(); if (r.ok && /<item>/.test(t)) { host = hst; break; } errors.push(hst + ' ' + r.status); } catch (e) { errors.push(hst + ' ' + e.message); }
  }
  if (!host) throw new Error('nenhum espelho público do X respondeu (' + errors.join(' · ') + ')');
  await Promise.all(ACCOUNTS.map(async ([u]) => {
    try {
      const r = await fetch(`https://${host}/${u}/rss`, { headers: { 'User-Agent': 'Mozilla/5.0 MesaSMC' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const xml = await r.text();
      const name = ent((xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/) || [, u])[1]).replace(/\s*\/\s*X$|\s*\/\s*Twitter$/i, '');
      for (const it of (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 8)) {
        const tag = n => (it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)) || [, ''])[1];
        const title = ent(tag('title'));
        if (/^RT by|^R to /i.test(title)) continue;
        const link = ent(tag('link')).replace(/https?:\/\/[^/]+\//, 'https://x.com/').replace(/#m$/, '');
        const at = Date.parse(ent(tag('pubDate'))) / 1000;
        out.push({ id: link.split('/').pop(), user: u, name, avatar: '', text: ent(tag('description')) || title, at, url: link, likes: 0, rts: 0, lang: '' });
      }
    } catch {}
  }));
  return { out, host };
}

async function getTweets() {
  if (cache.data && Date.now() - cache.at < 180000) return cache.data;
  const token = process.env.X_BEARER_TOKEN;
  let items = [], source = '', error = null;
  if (token) { try { items = await viaX(token); source = 'API oficial do X'; } catch (e) { error = e.message; } }
  if (!items.length) { try { const n = await viaNitter(); items = n.out; source = 'espelho público ' + n.host; error = null; } catch (e) { error = (error ? error + ' · ' : '') + e.message; } }
  const cat = Object.fromEntries(ACCOUNTS);
  const now = Date.now() / 1000;
  items = items.filter(t => t.text && now - t.at < 48 * 3600).map(t => ({ ...t, cat: cat[t.user] || '' }))
    .sort((a, b) => b.at - a.at).slice(0, 80);
  const data = { items, source, error, accounts: ACCOUNTS.map(a => a[0]), hasKey: !!token };
  cache = { at: Date.now(), data };
  return data;
}
module.exports = { getTweets, ACCOUNTS };
