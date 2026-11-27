// Candles da Bitget futuros (USDT-M), para o gráfico e a análise usarem o MESMO preço das ordens.
// Com mode=demo usa o mercado da conta demo (cabeçalho paptrading: 1), que tem preço próprio.
const G = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
const cache = new Map();

async function candles(symbol, tf, limit = 500, mode = 'live') {
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol)) throw new Error('Par inválido');
  const g = G[tf]; if (!g) throw new Error('Tempo gráfico inválido');
  const lim = Math.min(Math.max(+limit || 500, 10), 1000);
  const key = `${mode}|${symbol}|${tf}|${lim}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 4000) return hit.data;
  const u = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol}&productType=USDT-FUTURES&granularity=${g}&limit=${lim}`;
  const r = await fetch(u, { headers: mode === 'demo' ? { paptrading: '1' } : {}, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code !== '00000') throw new Error('Bitget ' + (j.msg || r.status));
  // formato igual ao da Binance: [tempo, abertura, máxima, mínima, fechamento, volume, ..., volume comprador estimado]
  const data = (j.data || []).map(k => {
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4], v = +k[5];
    const buy = h > l ? v * Math.min(1, Math.max(0, (c - l) / (h - l))) : v / 2; // a Bitget não informa o volume comprador: estimativa pela posição do fechamento
    return [+k[0], String(o), String(h), String(l), String(c), String(v), 0, 0, 0, 0, String(buy), 0];
  }).sort((a, b) => a[0] - b[0]);
  cache.set(key, { at: Date.now(), data }); if (cache.size > 200) cache.delete(cache.keys().next().value);
  return data;
}
module.exports = { candles };
