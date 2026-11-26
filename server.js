// Mesa SMC — servidor local para a Bitget (Node 18+, sem dependências)
// Uso: crie um arquivo .env ao lado (veja .env.example) e rode: node server.js
// Depois abra http://localhost:8787
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

// --- .env simples ---
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
} catch {}

const PORT = +process.env.PORT || 8787;
const HTML = path.join(__dirname, 'index.html');
const BASE = 'https://api.bitget.com';

function creds(mode) {
  const p = mode === 'live' ? 'BITGET_' : 'BITGET_DEMO_';
  const c = { key: process.env[p + 'KEY'], secret: process.env[p + 'SECRET'], pass: process.env[p + 'PASSPHRASE'] };
  if (!c.key || !c.secret || !c.pass) throw new Error(`Chaves ${mode === 'live' ? 'reais' : 'demo'} ausentes no .env (${p}KEY, ${p}SECRET, ${p}PASSPHRASE)`);
  if (mode === 'live' && process.env.ALLOW_LIVE !== 'true') throw new Error('Conta real bloqueada. Defina ALLOW_LIVE=true no .env para liberar.');
  return c;
}
// Na conta demo da Bitget (V2) os contratos usam produto SUSDT-FUTURES e símbolos com S (ex.: SBTCSUSDT).
// Se sua conta demo usar os nomes normais, defina DEMO_PLAIN_SYMBOLS=true no .env.
function market(mode, sym) {
  if (mode === 'live' || process.env.DEMO_PLAIN_SYMBOLS === 'true' || (ACCT[mode] && (ACCT[mode].plain || ACCT[mode].kind === 'uta'))) return { productType: 'USDT-FUTURES', marginCoin: 'USDT', symbol: sym };
  return { productType: 'SUSDT-FUTURES', marginCoin: 'SUSDT', symbol: 'S' + sym.replace(/USDT$/, '') + 'SUSDT' };
}

async function bg(mode, method, reqPath, query, body) {
  const c = creds(mode), ts = Date.now().toString();
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const b = body ? JSON.stringify(body) : '';
  const sign = crypto.createHmac('sha256', c.secret).update(ts + method + reqPath + qs + b).digest('base64');
  const headers = { 'ACCESS-KEY': c.key, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': c.pass, 'Content-Type': 'application/json', locale: 'en-US' };
  if (mode !== 'live') headers.paptrading = '1';
  const r = await fetch(BASE + reqPath + qs, { method, headers, body: b || undefined });
  const j = await r.json().catch(() => ({}));
  if (j.code !== '00000') throw new Error(`Bitget ${j.code || r.status}: ${j.msg || 'erro desconhecido'}`);
  return j.data;
}
async function pub(reqPath, query) {
  const r = await fetch(BASE + reqPath + '?' + new URLSearchParams(query)); const j = await r.json();
  if (j.code !== '00000') throw new Error(`Bitget ${j.code}: ${j.msg}`); return j.data;
}
const round = (n, d) => { const f = 10 ** d; return Math.floor(n * f) / f; };
const roundP = (n, d) => Number(n.toFixed(d));

// Descobre onde está o saldo: conta clássica (V2, demo com S ou com nomes normais) ou Conta Unificada (UTA, V3)
const ACCT = {};
async function probe(mode) {
  const tries = [];
  const cands = mode === 'live' ? [['USDT-FUTURES', 'USDT', false]] : [['SUSDT-FUTURES', 'SUSDT', false], ['USDT-FUTURES', 'USDT', true]];
  for (const [productType, coin, plain] of cands) {
    try {
      const acc = await bg(mode, 'GET', '/api/v2/mix/account/accounts', { productType });
      const a = (acc || []).find(x => x.marginCoin === coin) || (acc || [])[0] || {};
      const av = +(a.available ?? a.crossedMaxAvailable ?? 0);
      tries.push(`V2 ${productType}: ${av}`);
      if (av > 0) return { kind: 'v2', plain, available: av, tries };
    } catch (e) { tries.push(`V2 ${productType}: ${e.message}`); }
  }
  try {
    const d = await bg(mode, 'GET', '/api/v3/account/assets');
    const list = (d && (d.assets || d.list || d.coins)) || (Array.isArray(d) ? d : []);
    const u = list.find(x => String(x.coin || x.marginCoin || x.coinName || '').toUpperCase() === 'USDT') || {};
    const num = v => (v === undefined || v === null || v === '' || isNaN(+v)) ? null : +v;
    const av = [u.available, u.availableBalance, u.free, u.balance, u.equity, u.usdtEquity, d && d.usdtEquity, d && d.accountEquity, d && d.unionAvailable].map(num).find(v => v !== null && v > 0) || 0;
    tries.push(`UTA V3: ${av}`);
    if (av > 0) return { kind: 'uta', available: av, tries };
  } catch (e) { tries.push(`UTA V3: ${e.message}`); }
  return { kind: 'none', available: 0, tries };
}
async function status(mode) {
  const p = await probe(mode); ACCT[mode] = p;
  console.log(`[${mode}] saldo:`, p.tries.join(' | '));
  return { ok: true, mode, available: String(p.available), account: p.kind, tries: p.tries };
}

async function placeOrder(o) {
  const mode = o.mode === 'live' ? 'live' : 'demo';
  if (!/^[A-Z0-9]{2,20}USDT$/.test(o.symbol)) throw new Error('Par inválido');
  const side = o.side === 'buy' ? 'buy' : o.side === 'sell' ? 'sell' : null; if (!side) throw new Error('Lado inválido');
  const price = +o.price, sl = +o.sl, tp = +o.tp, lev = Math.min(Math.max(+o.leverage || 1, 1), 50);
  if (!(price > 0 && sl > 0 && tp > 0)) throw new Error('Preços inválidos');
  if (side === 'buy' ? !(sl < price && tp > price) : !(sl > price && tp < price)) throw new Error('Stop/alvo do lado errado da entrada');
  const st0 = await status(mode);
  if (st0.account === 'none') throw new Error('Saldo zerado em todos os tipos de conta (' + st0.tries.join(' | ') + ')');
  const m = market(mode, o.symbol);
  if (st0.account === 'uta') return placeUta(mode, o, side, price, sl, tp, lev, +st0.available);

  const [ct] = await pub('/api/v2/mix/market/contracts', { productType: m.productType, symbol: m.symbol });
  if (!ct) throw new Error('Contrato não encontrado: ' + m.symbol);
  const pp = +ct.pricePlace, vp = +ct.volumePlace, min = +ct.minTradeNum;
  const size = round(+o.size, vp); if (!(size >= min)) throw new Error(`Quantidade ${size} abaixo do mínimo ${min}`);

  const st = st0;
  if (size * price / lev > +st.available) throw new Error(`Margem insuficiente: precisa ${(size * price / lev).toFixed(2)}, disponível ${(+st.available).toFixed(2)}`);

  const acct = await bg(mode, 'GET', '/api/v2/mix/account/account', { symbol: m.symbol, productType: m.productType, marginCoin: m.marginCoin });
  try { await bg(mode, 'POST', '/api/v2/mix/account/set-margin-mode', null, { symbol: m.symbol, productType: m.productType, marginCoin: m.marginCoin, marginMode: o.marginMode === 'crossed' ? 'crossed' : 'isolated' }); } catch (e) { console.warn('margem:', e.message); }
  await bg(mode, 'POST', '/api/v2/mix/account/set-leverage', null, { symbol: m.symbol, productType: m.productType, marginCoin: m.marginCoin, leverage: String(lev) });

  const body = {
    symbol: m.symbol, productType: m.productType, marginMode: o.marginMode === 'crossed' ? 'crossed' : 'isolated', marginCoin: m.marginCoin,
    size: String(size), price: String(roundP(price, pp)), side, orderType: 'limit', force: 'gtc',
    presetStopSurplusPrice: String(roundP(tp, pp)), presetStopLossPrice: String(roundP(sl, pp)),
    clientOid: 'smc' + Date.now()
  };
  if (acct?.posMode === 'hedge_mode') body.tradeSide = 'open';
  const r = await bg(mode, 'POST', '/api/v2/mix/order/place-order', null, body);
  console.log(new Date().toISOString(), mode.toUpperCase(), side, size, m.symbol, '@', body.price, 'SL', body.presetStopLossPrice, 'TP', body.presetStopSurplusPrice, '→', r.orderId);
  return { orderId: r.orderId, size, symbol: m.symbol };
}


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

// Conta Unificada (UTA) — API V3
async function placeUta(mode, o, side, price, sl, tp, lev, available) {
  const symbol = o.symbol, category = 'USDT-FUTURES';
  let pp = 2, vp = 3, min = 0;
  try {
    const d = await bg(mode, 'GET', '/api/v3/market/instruments', { category, symbol });
    const ins = (Array.isArray(d) ? d : (d && d.list) || [])[0] || {};
    pp = +(ins.pricePrecision ?? ins.pricePlace ?? pp); vp = +(ins.quantityPrecision ?? ins.volumePlace ?? vp); min = +(ins.minOrderQty ?? ins.minTradeNum ?? 0);
  } catch (e) { console.warn('instrumentos UTA:', e.message); }
  const qty = round(+o.size, vp);
  if (!(qty > 0) || qty < min) throw new Error(`Quantidade ${qty} abaixo do mínimo ${min}`);
  if (qty * price / lev > available) throw new Error(`Margem insuficiente: precisa ${(qty * price / lev).toFixed(2)}, disponível ${available.toFixed(2)}`);
  try { await bg(mode, 'POST', '/api/v3/account/set-leverage', null, { category, symbol, leverage: String(lev), coin: 'USDT' }); } catch (e) { console.warn('alavancagem UTA:', e.message); }
  const body = { category, symbol, qty: String(qty), price: String(roundP(price, pp)), side, orderType: 'limit', timeInForce: 'gtc',
    takeProfit: String(roundP(tp, pp)), stopLoss: String(roundP(sl, pp)), tpTriggerBy: 'market', slTriggerBy: 'mark', clientOid: 'smc' + Date.now() };
  const r = await bg(mode, 'POST', '/api/v3/trade/place-order', null, body);
  console.log(new Date().toISOString(), 'UTA', mode.toUpperCase(), side, qty, symbol, '@', body.price, 'SL', body.stopLoss, 'TP', body.takeProfit, '->', r && r.orderId);
  return { orderId: (r && (r.orderId || r.clientOid)) || '?', size: qty, symbol };
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
if (require.main === module) http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(HTML).pipe(res);
  }
  if (url.pathname.startsWith('/api/')) {
    // Só aceita chamadas da própria página (bloqueia outros sites tentando usar o servidor)
    const origin = req.headers.origin, host = req.headers.host || '';
    if ((origin && origin !== `http://${host}`) || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, { error: 'Origem não permitida' });
    try {
      if (url.pathname === '/api/news') { const n = await getNews(); return send(res, 200, { items: n.data, errors: n.errors, at: n.at }); }
      if (url.pathname === '/api/bitget/debug') {
        const mode = url.searchParams.get('mode') === 'live' ? 'live' : 'demo', out = {};
        const q = async (k, m, p, qs) => { try { out[k] = await bg(mode, m, p, qs); } catch (e) { out[k] = 'ERRO: ' + e.message; } };
        await q('v2_SUSDT', 'GET', '/api/v2/mix/account/accounts', { productType: 'SUSDT-FUTURES' });
        await q('v2_USDT', 'GET', '/api/v2/mix/account/accounts', { productType: 'USDT-FUTURES' });
        await q('v3_assets', 'GET', '/api/v3/account/assets');
        await q('v3_settings', 'GET', '/api/v3/account/settings');
        await q('spot_assets', 'GET', '/api/v2/spot/account/assets');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify(out, null, 2));
      }
      if (url.pathname === '/api/bitget/status') return send(res, 200, await status(url.searchParams.get('mode')));
      if (url.pathname === '/api/bitget/order' && req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'JSON esperado' });
        let raw = ''; for await (const ch of req) { raw += ch; if (raw.length > 1e4) throw new Error('Corpo grande demais'); }
        return send(res, 200, await placeOrder(JSON.parse(raw)));
      }
      return send(res, 404, { error: 'Rota inexistente' });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  send(res, 404, { error: 'não encontrado' });
}).listen(PORT, '127.0.0.1', () => console.log(`Mesa SMC rodando em http://localhost:${PORT}`));

module.exports = { parseRss };
