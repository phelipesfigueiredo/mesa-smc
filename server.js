// Mesa SMC — servidor local para a Bitget (Node 18+, sem dependências)
// Uso: crie um arquivo .env ao lado (veja .env.example) e rode: node server.js
// Depois abra http://localhost:8787
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { getNews, parseRss } = require('./lib/news');
const reader = require('./lib/reader');

// --- .env simples ---
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
} catch {}

const PORT = +process.env.PORT || 8787;
const BOOT = Date.now();
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

// ---------- Posições e ordens abertas (para fechar / cancelar pelo app) ----------
async function ensureAcct(mode) { if (!ACCT[mode]) await status(mode); }
async function openState(mode) {
  await ensureAcct(mode);
  const m = market(mode, 'BTCUSDT');
  const pos = await bg(mode, 'GET', '/api/v2/mix/position/all-position', { productType: m.productType, marginCoin: m.marginCoin });
  const positions = (pos || []).filter(p => +(p.total || 0) > 0).map(p => ({
    symbol: p.symbol, holdSide: p.holdSide, total: +p.total, available: +(p.available ?? p.total), entry: +(p.openPriceAvg || p.averageOpenPrice || 0),
    mark: +(p.markPrice || 0), pnl: +(p.unrealizedPL || 0), margin: +(p.marginSize || p.margin || 0), leverage: +(p.leverage || 0), liq: +(p.liquidationPrice || 0),
  }));
  let orders = [];
  try {
    const d = await bg(mode, 'GET', '/api/v2/mix/order/orders-pending', { productType: m.productType });
    orders = (d?.entrustedList || []).map(o => ({ orderId: o.orderId, symbol: o.symbol, side: o.side, tradeSide: o.tradeSide, price: +o.price, size: +o.size,
      tp: +(o.presetStopSurplusPrice || 0), sl: +(o.presetStopLossPrice || 0), created: +(o.cTime || 0) }));
  } catch (e) { console.warn('ordens pendentes:', e.message); }
  // lucro realizado hoje (posições fechadas desde 00:00 de Brasília)
  let today = null;
  try {
    const brt = new Date(Date.now() - 3 * 3600e3); brt.setUTCHours(0, 0, 0, 0);
    const start = brt.getTime() + 3 * 3600e3;
    const hist = await bg(mode, 'GET', '/api/v2/mix/position/history-position', { productType: m.productType, startTime: String(start), endTime: String(Date.now()), limit: '100' });
    const list = hist?.list || hist || [];
    today = { pnl: list.reduce((t, x) => t + +(x.netProfit ?? x.pnl ?? 0), 0), count: list.length,
      wins: list.filter(x => +(x.netProfit ?? x.pnl ?? 0) > 0).length };
  } catch (e) { console.warn('histórico de hoje:', e.message); }
  return { positions, orders, today };
}
async function closePosition(o) {
  const mode = o.mode === 'live' ? 'live' : 'demo';
  await ensureAcct(mode);
  const pct = Math.round(+o.percent);
  if (![25, 50, 75, 100].includes(pct) && !(pct > 0 && pct <= 100)) throw new Error('Porcentagem inválida');
  const holdSide = o.holdSide === 'short' ? 'short' : 'long';
  const base = market(mode, 'BTCUSDT'); const sym = String(o.symbol || '');
  if (!/^[A-Z0-9]{2,30}$/.test(sym)) throw new Error('Par inválido');
  const m = { ...base, symbol: sym };
  const st = await openState(mode);
  const p = st.positions.find(x => x.symbol === sym && x.holdSide === holdSide);
  if (!p) throw new Error(`Não há posição ${holdSide} aberta em ${sym}`);
  if (pct === 100) {
    const r = await bg(mode, 'POST', '/api/v2/mix/order/close-positions', null, { symbol: sym, productType: m.productType, holdSide });
    console.log(new Date().toISOString(), mode.toUpperCase(), 'FECHAR 100%', sym, holdSide, JSON.stringify(r));
    return { closed: p.total, percent: 100 };
  }
  const [ct] = await pub('/api/v2/mix/market/contracts', { productType: m.productType, symbol: sym });
  const vp = +(ct?.volumePlace ?? 3), min = +(ct?.minTradeNum ?? 0);
  const size = round(p.available * pct / 100, vp);
  if (!(size > 0) || size < min) throw new Error(`${pct}% dá ${size}, abaixo do mínimo de ${min}. Use uma porcentagem maior ou feche 100%.`);
  const acct = await bg(mode, 'GET', '/api/v2/mix/account/account', { symbol: sym, productType: m.productType, marginCoin: m.marginCoin });
  const hedge = acct?.posMode === 'hedge_mode';
  // Modo hedge: lado = lado da posição + tradeSide "close". Modo único: lado oposto + reduceOnly.
  const body = { symbol: sym, productType: m.productType, marginMode: acct?.marginMode || 'isolated', marginCoin: m.marginCoin, size: String(size), orderType: 'market', clientOid: 'smcclose' + Date.now() };
  if (hedge) { body.side = holdSide === 'long' ? 'buy' : 'sell'; body.tradeSide = 'close'; }
  else { body.side = holdSide === 'long' ? 'sell' : 'buy'; body.reduceOnly = 'YES'; }
  const r = await bg(mode, 'POST', '/api/v2/mix/order/place-order', null, body);
  console.log(new Date().toISOString(), mode.toUpperCase(), `FECHAR ${pct}%`, sym, holdSide, size, '->', r?.orderId);
  // fechamento manual parcial não deve ser confundido com TP1 pelo acompanhamento
  WATCH.filter(w => w.symbol === sym && w.state === 'managing' && w.mode === mode).forEach(w => { w.size = round(w.size - size, vp); wlog(w, `fechamento manual de ${size} (${pct}%)`); });
  saveWatch();
  return { closed: size, percent: pct, orderId: r?.orderId };
}
async function cancelOrder(o) {
  const mode = o.mode === 'live' ? 'live' : 'demo';
  await ensureAcct(mode);
  const m = market(mode, 'BTCUSDT'); const sym = String(o.symbol || '');
  if (!/^[A-Z0-9]{2,30}$/.test(sym) || !/^[0-9A-Za-z_-]{1,64}$/.test(String(o.orderId || ''))) throw new Error('Pedido inválido');
  await bg(mode, 'POST', '/api/v2/mix/order/cancel-order', null, { symbol: sym, productType: m.productType, marginCoin: m.marginCoin, orderId: String(o.orderId) });
  WATCH.filter(w => w.orderId === o.orderId).forEach(w => { w.state = 'closed'; wlog(w, 'ordem cancelada pelo app'); });
  saveWatch();
  console.log(new Date().toISOString(), mode.toUpperCase(), 'CANCELAR', sym, o.orderId);
  return { canceled: o.orderId };
}

async function placeOrder(o) {
  const mode = o.mode === 'live' ? 'live' : 'demo';
  if (!/^[A-Z0-9]{2,20}USDT$/.test(o.symbol)) throw new Error('Par inválido');
  const side = o.side === 'buy' ? 'buy' : o.side === 'sell' ? 'sell' : null; if (!side) throw new Error('Lado inválido');
  const price = +o.price, sl = +o.sl, lev = Math.min(Math.max(+o.leverage || 1, 1), 50);
  const tps = (Array.isArray(o.tps) ? o.tps : [o.tp]).map(Number).filter(x => x > 0);
  const shares = (Array.isArray(o.shares) && o.shares.length === tps.length ? o.shares : tps.map((_, i, a) => i === a.length - 1 ? 0 : 0)).map(Number);
  const tp = tps[tps.length - 1];
  if (!(price > 0 && sl > 0 && tp > 0)) throw new Error('Preços inválidos');
  if (tps.some(t => side === 'buy' ? !(t > price) : !(t < price))) throw new Error('Algum alvo está do lado errado da entrada');
  if (side === 'buy' ? !(sl < price && tp > price) : !(sl > price && tp < price)) throw new Error('Stop/alvo do lado errado da entrada');
  const st0 = await status(mode);
  if (st0.account === 'none') throw new Error('Saldo zerado em todos os tipos de conta (' + st0.tries.join(' | ') + ')');
  const m = market(mode, o.symbol);
  if (st0.account === 'uta') return placeUta(mode, o, side, price, sl, tp, lev, +st0.available);

  const [ct] = await pub('/api/v2/mix/market/contracts', { productType: m.productType, symbol: m.symbol });
  // Uma operação por moeda: recusa se já houver acompanhamento, ordem pendente ou posição aberta neste par.
  if (WATCH.some(w => w.mode === mode && w.symbol === m.symbol && w.state !== 'closed')) throw new Error(`Já existe uma operação em andamento em ${m.symbol}`);
  try {
    const pend = await bg(mode, 'GET', '/api/v2/mix/order/orders-pending', { productType: m.productType, symbol: m.symbol });
    if ((pend?.entrustedList || []).length) throw new Error(`Já existe ordem aberta em ${m.symbol}`);
    const pos = await bg(mode, 'GET', '/api/v2/mix/position/single-position', { symbol: m.symbol, productType: m.productType, marginCoin: m.marginCoin });
    if ((pos || []).some(p => +(p.total || 0) > 0)) throw new Error(`Já existe posição aberta em ${m.symbol}`);
  } catch (e) { if (/^Já existe/.test(e.message)) throw e; console.warn('checagem de ordens abertas:', e.message); }
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
  // Alvos parciais: só podem ser criados depois que a entrada for executada. Guardamos e acompanhamos.
  const partials = [];
  let left = size;
  tps.slice(0, -1).forEach((t, i) => {
    const q = round(size * (shares[i] || 0) / 100, vp);
    if (q >= min && q < left) { partials.push({ price: roundP(t, pp), size: q, done: false }); left = round(left - q, vp); }
  });
  if (partials.length) {
    WATCH.push({ mode, orderId: r.orderId, symbol: m.symbol, productType: m.productType, marginCoin: m.marginCoin, hedge: acct?.posMode === 'hedge_mode',
      holdSide: side === 'buy' ? 'long' : 'short', side, entry: +body.price, size, pp, vp, partials, beDone: false, state: 'waiting', created: Date.now() });
    saveWatch();
  }
  console.log(new Date().toISOString(), mode.toUpperCase(), side, size, m.symbol, '@', body.price, 'SL', body.presetStopLossPrice, 'TP', body.presetStopSurplusPrice, '→', r.orderId);
  return { orderId: r.orderId, size, symbol: m.symbol, partials: partials.map(p => `${p.size} @ ${p.price}`), finalTp: body.presetStopSurplusPrice };
}




// ---------- Acompanhamento das ordens: cria TPs parciais quando a entrada é executada e move o stop para o breakeven após o TP1 ----------
const WATCH_FILE = path.join(__dirname, 'watch.json');
let WATCH = [];
try { WATCH = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')); } catch {}
const saveWatch = () => { try { fs.writeFileSync(WATCH_FILE, JSON.stringify(WATCH, null, 2)); } catch {} };
const wlog = (w, msg) => { const line = `${new Date().toISOString()} [${w.mode}] ${w.symbol} #${w.orderId}: ${msg}`; console.log(line); (w.log = w.log || []).push(line); };

async function positionSize(w) {
  const d = await bg(w.mode, 'GET', '/api/v2/mix/position/single-position', { symbol: w.symbol, productType: w.productType, marginCoin: w.marginCoin });
  const p = (d || []).find(x => !w.hedge || x.holdSide === w.holdSide) || {};
  return +(p.total ?? p.available ?? 0);
}
async function tickWatch(w) {
  if (w.state === 'waiting') {
    const o = await bg(w.mode, 'GET', '/api/v2/mix/order/detail', { symbol: w.symbol, productType: w.productType, orderId: w.orderId });
    const st = o?.state || o?.status;
    if (st === 'canceled' || st === 'cancelled') { w.state = 'closed'; wlog(w, 'entrada cancelada, nada a fazer'); return; }
    if (st !== 'filled') return;
    w.state = 'open'; wlog(w, 'entrada executada, criando alvos parciais');
  }
  if (w.state === 'open') {
    for (const p of w.partials) {
      if (p.orderId) continue;
      try {
        const body = { symbol: w.symbol, productType: w.productType, marginCoin: w.marginCoin, planType: 'profit_plan', triggerPrice: String(p.price),
          triggerType: 'fill_price', executePrice: '0', holdSide: w.hedge ? w.holdSide : w.side, size: String(p.size), clientOid: 'smctp' + Date.now() + Math.floor(Math.random() * 1e3) };
        const r = await bg(w.mode, 'POST', '/api/v2/mix/order/place-tpsl-order', null, body);
        p.orderId = r?.orderId || 'ok'; wlog(w, `TP parcial criado: fecha ${p.size} em ${p.price}`);
      } catch (e) { wlog(w, `falha ao criar TP parcial em ${p.price}: ${e.message}`); }
    }
    w.state = 'managing';
  }
  if (w.state === 'managing') {
    const pos = await positionSize(w);
    if (pos <= 0) { w.state = 'closed'; wlog(w, 'posição encerrada'); return; }
    if (!w.beDone && pos < w.size * 0.999) {
      // TP1 executado: stop vai para o 0x0 (entrada + taxas de ida e volta), assim, se voltar, sai sem perda.
      const dir = w.holdSide === 'long' ? 1 : -1, fees = +(process.env.BE_FEE_PCT || 0.12) / 100;
      const be0x0 = roundP(w.entry * (1 + dir * fees), w.pp), beEntry = roundP(w.entry, w.pp);
      try {
        const d = await bg(w.mode, 'GET', '/api/v2/mix/order/orders-plan-pending', { symbol: w.symbol, productType: w.productType, planType: 'profit_loss' });
        const list = d?.entrustedList || d || [];
        const sl = list.find(x => /loss/.test(x.planType || '') && (!w.hedge || (x.posSide || x.holdSide || '') === w.holdSide)) || list.find(x => /loss/.test(x.planType || ''));
        if (!sl) throw new Error('stop não encontrado');
        const mod = price => bg(w.mode, 'POST', '/api/v2/mix/order/modify-tpsl-order', null, { orderId: sl.orderId, marginCoin: w.marginCoin, productType: w.productType, symbol: w.symbol,
          triggerPrice: String(price), triggerType: 'mark_price', executePrice: '0', size: sl.size || '' });
        let used = be0x0;
        // se o preço já voltou para perto da entrada, a Bitget recusa um stop "acima" do preço; aí usa a entrada exata
        try { await mod(be0x0); } catch (e1) { used = beEntry; await mod(beEntry); wlog(w, `0x0 em ${be0x0} recusado (${e1.message}); usei a entrada`); }
        w.beDone = true; w.bePrice = used; wlog(w, used === be0x0 ? `TP1 atingido: stop movido para o 0x0 em ${used} (entrada ${w.entry} + taxas)` : `TP1 atingido: stop movido para a entrada ${used} (o 0x0 com taxas foi recusado)`);
      } catch (e) {
        w.beTries = (w.beTries || 0) + 1;
        wlog(w, `tentativa ${w.beTries} de mover o stop para o 0x0 falhou: ${e.message}`);
        if (w.beTries >= 5) { w.beDone = true; wlog(w, 'desisti de mover o stop; ajuste manualmente na Bitget'); }
      }
    }
  }
}
setInterval(async () => {
  for (const w of WATCH.filter(x => x.state !== 'closed')) {
    try { await tickWatch(w); } catch (e) { wlog(w, 'erro no acompanhamento: ' + e.message); }
    if (Date.now() - w.created > 7 * 864e5) w.state = 'closed';
  }
  WATCH = WATCH.filter(x => x.state !== 'closed' || Date.now() - x.created < 864e5);
  saveWatch();
}, 15000).unref();

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
  const STATIC = { '/sw.js': 'text/javascript', '/manifest.webmanifest': 'application/manifest+json', '/icons/logo.svg': 'image/svg+xml', '/icons/icon-32.png': 'image/png', '/icons/icon-180.png': 'image/png', '/icons/icon-192.png': 'image/png', '/icons/icon-512.png': 'image/png' };
  if (STATIC[url.pathname]) { res.writeHead(200, { 'Content-Type': STATIC[url.pathname], 'Cache-Control': 'public, max-age=86400' }); return fs.createReadStream(path.join(__dirname, url.pathname)).pipe(res); }
  if (url.pathname.startsWith('/api/')) {
    // Só aceita chamadas da própria página (bloqueia outros sites tentando usar o servidor)
    const origin = req.headers.origin, host = req.headers.host || '';
    if ((origin && origin !== `http://${host}`) || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send(res, 403, { error: 'Origem não permitida' });
    try {
      if (url.pathname === '/api/article') return send(res, 200, await reader.article(url.searchParams.get('url') || ''));
      if (url.pathname === '/api/translate' && req.method === 'POST') {
        let raw = ''; for await (const ch of req) { raw += ch; if (raw.length > 4e5) throw new Error('Texto grande demais'); }
        return send(res, 200, { texts: await reader.translate(JSON.parse(raw).texts, 'pt') });
      }
      if (url.pathname === '/api/news') { const n = await getNews(); return send(res, 200, { items: n.data, errors: n.errors, at: n.at }); }
      if (url.pathname === '/api/version') {
        // muda sempre que o app é atualizado (o servidor reinicia ou o index.html muda)
        let v = String(BOOT); try { v += '-' + fs.statSync(HTML).mtimeMs; } catch {}
        return send(res, 200, { v });
      }
      if (url.pathname === '/api/bitget/open') return send(res, 200, await openState(url.searchParams.get('mode') === 'live' ? 'live' : 'demo'));
      if ((url.pathname === '/api/bitget/close' || url.pathname === '/api/bitget/cancel') && req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'JSON esperado' });
        let raw = ''; for await (const ch of req) { raw += ch; if (raw.length > 1e4) throw new Error('Corpo grande demais'); }
        const body = JSON.parse(raw);
        return send(res, 200, url.pathname.endsWith('close') ? await closePosition(body) : await cancelOrder(body));
      }
      if (url.pathname === '/api/bitget/watch') return send(res, 200, WATCH.map(w => ({ symbol: w.symbol, orderId: w.orderId, state: w.state, partials: w.partials, beDone: w.beDone, bePrice: w.bePrice || null, log: (w.log || []).slice(-5) })));
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
