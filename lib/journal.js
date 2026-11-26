// Diário de operações + travas de proteção (perda diária/semanal, sequência de stops, risco aberto)
// e envio para o Google Sheets. Tudo fica no seu computador (journal.json / plans.json), sem chaves no código.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const JFILE = path.join(DIR, 'journal.json'), PFILE = path.join(DIR, 'plans.json');
const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const save = (f, d) => { try { fs.writeFileSync(f, JSON.stringify(d, null, 1)); } catch {} };
let JOURNAL = load(JFILE), PLANS = load(PFILE);
const COLS = ['id', 'conta', 'moeda', 'lado', 'abertura', 'fechamento', 'duracao_min', 'entrada', 'saida', 'quantidade', 'alavancagem', 'resultado_usd', 'taxas_usd', 'funding_usd',
  'risco_usd', 'resultado_R', 'nota', 'setup', 'estilo', 'stop_plano', 'tp1_plano', 'tp_final_plano', 'origem', 'sessao', 'dia_semana'];

const num = (v, d = 0) => (v === undefined || v === null || v === '' || isNaN(+v)) ? d : +v;
const envPct = (k, d) => num(process.env[k], d) / 100;
const RULES = () => ({
  dayLoss: envPct('TRAVA_PERDA_DIA', 2), weekLoss: envPct('TRAVA_PERDA_SEMANA', 5), openRisk: envPct('TRAVA_RISCO_ABERTO', 3),
  streak: num(process.env.TRAVA_STOPS_SEGUIDOS, 3), pauseMin: num(process.env.TRAVA_PAUSA_MIN, 120),
});

// horário de Brasília para "hoje" e "esta semana" (semana começa na segunda)
const BRT = 3 * 3600e3;
const dayStart = (t = Date.now()) => { const d = new Date(t - BRT); d.setUTCHours(0, 0, 0, 0); return d.getTime() + BRT; };
const weekStart = (t = Date.now()) => { const d = new Date(dayStart(t) - BRT); const wd = (d.getUTCDay() + 6) % 7; return dayStart(t) - wd * 864e5; };
const fmtBRT = t => new Date(t - BRT).toISOString().replace('T', ' ').slice(0, 16);

function addPlan(p) { PLANS.push({ ...p, created: Date.now() }); PLANS = PLANS.filter(x => Date.now() - x.created < 30 * 864e5); save(PFILE, PLANS); }

// Lê as posições fechadas da Bitget e monta o diário (junta com o plano enviado pelo app, quando houver)
async function sync(mode, bg, market) {
  const m = market(mode, 'BTCUSDT');
  const d = await bg(mode, 'GET', '/api/v2/mix/position/history-position', { productType: m.productType, startTime: String(Date.now() - 30 * 864e5), endTime: String(Date.now()), limit: '100' });
  const list = d?.list || d || [];
  let added = 0;
  for (const x of list) {
    const id = `${mode}-${x.positionId || x.id || (x.symbol + x.ctime)}`;
    const closeT = num(x.utime || x.uTime || x.ctime), openT = num(x.ctime || x.cTime);
    const symbol = x.symbol, side = x.holdSide || x.posSide || '';
    const pnl = num(x.netProfit, num(x.pnl) + num(x.openFee) + num(x.closeFee) + num(x.totalFunding));
    const fees = num(x.openFee) + num(x.closeFee), funding = num(x.totalFunding);
    const openPx = num(x.openAvgPrice || x.openPriceAvg), closePx = num(x.closeAvgPrice || x.closePriceAvg), qty = num(x.openTotalPos || x.closeTotalPos);
    // plano mais próximo (mesma moeda, criado antes da abertura)
    const plan = PLANS.filter(p => p.mode === mode && p.symbol === symbol && p.created <= openT + 60e3).sort((a, b) => b.created - a.created)[0];
    const risk = plan && plan.stop && openPx ? Math.abs(openPx - plan.stop) * qty : null;
    const row = {
      id, conta: mode === 'live' ? 'Real' : 'Demo', moeda: symbol, lado: side === 'long' ? 'Long' : side === 'short' ? 'Short' : side,
      abertura: fmtBRT(openT), fechamento: fmtBRT(closeT), duracao_min: openT && closeT ? Math.round((closeT - openT) / 60e3) : '',
      entrada: openPx, saida: closePx, quantidade: qty, alavancagem: num(x.leverage, ''),
      resultado_usd: +pnl.toFixed(4), taxas_usd: +fees.toFixed(4), funding_usd: +funding.toFixed(4),
      risco_usd: risk ? +risk.toFixed(4) : '', resultado_R: risk ? +(pnl / risk).toFixed(3) : '',
      nota: plan?.score ?? '', setup: plan ? (plan.score >= 8 ? 'A' : 'B') : 'manual', estilo: plan?.tf || '', stop_plano: plan?.stop ?? '',
      tp1_plano: plan?.tps?.[0] ?? '', tp_final_plano: plan?.tps?.at(-1) ?? '', origem: plan ? (plan.auto ? 'automático' : 'app') : 'fora do app',
      sessao: (h => h >= 7 && h < 12 ? 'Londres' : h >= 12 && h < 21 ? 'Nova York' : 'Ásia')(new Date(openT).getUTCHours()),
      dia_semana: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(openT - BRT).getUTCDay()],
      closeT, openT, mode,
    };
    const i = JOURNAL.findIndex(j => j.id === id);
    if (i < 0) { JOURNAL.push(row); added++; }
    else { const prev = JOURNAL[i], changed = COLS.some(c => String(prev[c] ?? '') !== String(row[c] ?? '')); JOURNAL[i] = { ...prev, ...row, enviado: !!prev.enviado && !changed }; }
  }
  JOURNAL.sort((a, b) => a.closeT - b.closeT);
  save(JFILE, JOURNAL);
  return added;
}

// Travas: decide se pode abrir uma operação nova agora
function guard(mode, equity, newRiskUsd, openRiskUsd) {
  const R = RULES(), now = Date.now(), J = JOURNAL.filter(j => j.mode === mode);
  const sum = since => J.filter(j => j.closeT >= since).reduce((s, j) => s + j.resultado_usd, 0);
  const day = sum(dayStart()), week = sum(weekStart());
  const base = equity > 0 ? equity : 0;
  const blocks = [];
  if (base && day <= -R.dayLoss * base) blocks.push({ code: 'dia', msg: `Perda do dia em ${(day / base * 100).toFixed(2)}% (limite ${R.dayLoss * 100}%). Novas operações liberadas amanhã às 00:00.`, until: dayStart() + 864e5 });
  if (base && week <= -R.weekLoss * base) blocks.push({ code: 'semana', msg: `Perda da semana em ${(week / base * 100).toFixed(2)}% (limite ${R.weekLoss * 100}%). Liberado na segunda às 00:00.`, until: weekStart() + 7 * 864e5 });
  const last = J.slice(-R.streak);
  if (last.length === R.streak && last.every(j => j.resultado_usd < 0)) {
    const until = last.at(-1).closeT + R.pauseMin * 60e3;
    if (now < until) blocks.push({ code: 'sequencia', msg: `${R.streak} stops seguidos. Pausa obrigatória até ${fmtBRT(until).slice(11)}.`, until });
  }
  if (base && newRiskUsd >= 0 && (openRiskUsd + newRiskUsd) > R.openRisk * base)
    blocks.push({ code: 'risco', msg: `Risco aberto ficaria em ${((openRiskUsd + newRiskUsd) / base * 100).toFixed(2)}% da banca (limite ${R.openRisk * 100}%).`, until: null });
  return { ok: !blocks.length, blocks, day, week, dayPct: base ? day / base * 100 : null, weekPct: base ? week / base * 100 : null, openRiskPct: base ? openRiskUsd / base * 100 : null, rules: R };
}

function stats(mode) {
  const J = JOURNAL.filter(j => !mode || j.mode === mode);
  const withR = J.filter(j => j.resultado_R !== '');
  const wins = J.filter(j => j.resultado_usd > 0), losses = J.filter(j => j.resultado_usd <= 0);
  const gw = wins.reduce((s, j) => s + j.resultado_usd, 0), gl = -losses.reduce((s, j) => s + j.resultado_usd, 0);
  let eq = 0, pk = 0, dd = 0; J.forEach(j => { eq += j.resultado_usd; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); });
  const by = key => Object.entries(J.reduce((o, j) => { (o[j[key]] = o[j[key]] || []).push(j); return o; }, {}))
    .map(([k, a]) => ({ k, n: a.length, wr: a.filter(j => j.resultado_usd > 0).length / a.length, total: a.reduce((s, j) => s + j.resultado_usd, 0) }));
  return { n: J.length, winrate: J.length ? wins.length / J.length : null, total: eq, pf: gl ? gw / gl : null, maxDD: dd,
    expR: withR.length ? withR.reduce((s, j) => s + j.resultado_R, 0) / withR.length : null, nR: withR.length,
    porSetup: by('setup'), porSessao: by('sessao'), ultimas: J.slice(-15).reverse() };
}

// Google Sheets: envia as linhas novas/alteradas para o Apps Script da sua planilha
async function pushSheets() {
  const url = process.env.SHEETS_WEBHOOK_URL; if (!url) return { skipped: 'SHEETS_WEBHOOK_URL não configurada' };
  const pend = JOURNAL.filter(j => !j.enviado); if (!pend.length) return { sent: 0 };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ secret: process.env.SHEETS_SECRET || '', columns: COLS, rows: pend.map(j => COLS.map(c => j[c] ?? '')) }) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok || !j.ok) throw new Error('Planilha respondeu: ' + (j.error || r.status + ' ' + t.slice(0, 120)));
  pend.forEach(x => x.enviado = true); save(JFILE, JOURNAL);
  return { sent: pend.length };
}

module.exports = { addPlan, sync, guard, stats, pushSheets, COLS, dayStart, weekStart, _all: () => JOURNAL, _plans: () => PLANS };
