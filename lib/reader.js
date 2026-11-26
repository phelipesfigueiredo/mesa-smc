// Leitor de notícias: extrai o texto da matéria e traduz para português.
// Só aceita links dos sites de notícias usados pelo app (evita o servidor buscar endereços arbitrários).
const ALLOWED = ['coindesk.com', 'cointelegraph.com', 'decrypt.co', 'theblock.co', 'bitcoinmagazine.com', 'livecoins.com.br', 'portaldobitcoin.uol.com.br', 'cryptocompare.com'];
const cacheA = new Map(), cacheT = new Map();

function allowed(u) {
  let x; try { x = new URL(u); } catch { return false; }
  if (x.protocol !== 'https:') return false;
  return ALLOWED.some(d => x.hostname === d || x.hostname.endsWith('.' + d));
}
const ent = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const clean = s => ent(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, k) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (tag.match(/\b(?:property|name)\s*=\s*(["'])(.*?)\1/i) || [])[2];
    if (name && name.toLowerCase() === k.toLowerCase()) { const c = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i); if (c) return ent(c[2]); }
  }
  return '';
};

function extract(html, url) {
  html = html.slice(0, 2_000_000).replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ');
  const scope = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const paras = [...scope.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => ({ tag: m[1].toLowerCase(), text: clean(m[2]) }))
    .filter(p => p.text.length > (p.tag === 'p' ? 50 : 12) && !/^(advertisement|subscribe|sign up|read more|leia mais|veja também|siga o|this post|o post)/i.test(p.text));
  const seen = new Set(), body = []; let total = 0;
  for (const p of paras) { if (seen.has(p.text)) continue; seen.add(p.text); body.push(p); total += p.text.length; if (total > 9000 || body.length > 40) break; }
  const out = { url, title: meta(html, 'og:title') || clean((html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]), image: meta(html, 'og:image'),
    description: meta(html, 'og:description') || meta(html, 'description'), body, lang: (html.match(/<html[^>]+lang=["']?([a-z]{2})/i) || [, ''])[1] };
  if (!/^https:\/\//.test(out.image)) out.image = '';
  return out;
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
async function viaDirect(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8' }, signal: AbortSignal.timeout(9000), redirect: 'follow' });
  if (!r.ok) throw new Error('site respondeu ' + r.status);
  const d = extract(await r.text(), url);
  if (d.body.length < 2) throw new Error('texto não encontrado na página');
  return d;
}
// Leitor público (r.jina.ai): abre a página por fora e devolve o texto limpo. Usado quando o site bloqueia o acesso direto.
async function viaProxy(url) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'application/json', 'X-Return-Format': 'markdown' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('leitor alternativo respondeu ' + r.status);
  const j = await r.json(); const d = j.data || j;
  const lines = String(d.content || '').split(/\n+/).map(t => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`>#]+/g, '').trim())
    .filter(t => t.length > 50 && !/^(advertisement|subscribe|sign up|read more|share|leia mais)/i.test(t)).slice(0, 35);
  if (lines.length < 2) throw new Error('leitor alternativo sem texto');
  return { url, title: d.title || '', image: '', description: d.description || '', body: lines.map(text => ({ tag: 'p', text })), lang: '' };
}
async function article(url, fallback) {
  if (!allowed(url)) throw new Error('Link fora das fontes de notícias do app');
  if (cacheA.has(url)) return cacheA.get(url);
  const errs = [];
  let out = null;
  for (const fn of [viaDirect, viaProxy]) { try { out = await fn(url); out.via = fn.name; break; } catch (e) { errs.push(e.message); } }
  if (!out && fallback && (fallback.paras?.length || fallback.body)) {
    out = { url, title: fallback.title, image: '', description: fallback.body || '', body: (fallback.paras || []).map(text => ({ tag: 'p', text })), lang: fallback.lang || '', via: 'rss' };
  }
  if (!out) throw new Error(errs.join(' · '));
  cacheA.set(url, out); if (cacheA.size > 100) cacheA.delete(cacheA.keys().next().value);
  return out;
}

// Tradução: Google Tradutor público (sem chave) e, se falhar, MyMemory. Junta vários parágrafos por chamada (menos pedidos, mais rápido).
const SEP = '\n\n⟦¶⟧\n\n';
async function google(text, to) {
  const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + to, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA }, body: 'q=' + encodeURIComponent(text), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Google ' + r.status);
  const j = await r.json(); const t = (j[0] || []).map(x => x[0]).join('');
  if (!t) throw new Error('Google sem resposta');
  return t;
}
async function mymemory(text, to) {
  // limite de ~500 caracteres por pedido: divide por frases
  const parts = text.match(/[\s\S]{1,480}(?=\s|$)/g) || [text], out = [];
  for (const p of parts) {
    const r = await fetch('https://api.mymemory.translated.net/get?langpair=en|' + (to === 'pt' ? 'pt-BR' : to) + '&q=' + encodeURIComponent(p), { signal: AbortSignal.timeout(10000) });
    const j = await r.json(); if (!r.ok || j.responseStatus >= 400) throw new Error('MyMemory ' + (j.responseDetails || r.status));
    out.push(j.responseData.translatedText);
  }
  return out.join(' ');
}
async function translateChunk(texts, to) {
  const joined = texts.join(SEP), k = to + '|' + joined;
  if (cacheT.has(k)) return cacheT.get(k);
  let parts = null, errs = [];
  try {
    parts = (await google(joined, to)).split(/\s*⟦\s*¶\s*⟧\s*/).map(x => x.replace(/\s+/g, ' ').trim());
    if (parts.length !== texts.length) parts = await Promise.all(texts.map(x => google(x, to).then(y => y.trim())));
  } catch (e) { errs.push(e.message); parts = null; }
  if (!parts) {
    try { parts = []; for (const x of texts) parts.push((await mymemory(x, to)).trim()); }
    catch (e) { errs.push(e.message); throw new Error('tradutor indisponível (' + errs.join(' · ') + ')'); }
  }
  cacheT.set(k, parts); if (cacheT.size > 500) cacheT.delete(cacheT.keys().next().value);
  return parts;
}
async function translate(texts, to = 'pt') {
  if (!Array.isArray(texts) || texts.length > 120) throw new Error('Texto inválido');
  const items = texts.map(t => String(t || '').slice(0, 3000)), out = new Array(items.length).fill('');
  let batch = [], idx = [], size = 0;
  const flush = async () => { if (!batch.length) return; const r = await translateChunk(batch, to); idx.forEach((i, k) => out[i] = r[k]); batch = []; idx = []; size = 0; };
  for (let i = 0; i < items.length; i++) {
    if (!items[i]) continue;
    if (size + items[i].length > 3500) await flush();
    batch.push(items[i]); idx.push(i); size += items[i].length + SEP.length;
  }
  await flush();
  return out;
}
module.exports = { article, translate, allowed };
