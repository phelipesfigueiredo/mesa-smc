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

async function article(url) {
  if (!allowed(url)) throw new Error('Link fora das fontes de notícias do app');
  if (cacheA.has(url)) return cacheA.get(url);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) MesaSMC/1.0', Accept: 'text/html' }, signal: AbortSignal.timeout(9000), redirect: 'follow' });
  if (!r.ok) throw new Error('O site respondeu ' + r.status);
  let html = (await r.text()).slice(0, 2_000_000);
  html = html.replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ');
  const scope = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
  const paras = [...scope.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => ({ tag: m[1].toLowerCase(), text: clean(m[2]) }))
    .filter(p => p.text.length > (p.tag === 'p' ? 50 : 12) && !/^(advertisement|subscribe|sign up|read more|leia mais|veja também|siga o|this post|o post)/i.test(p.text));
  const seen = new Set(), body = [];
  let total = 0;
  for (const p of paras) { if (seen.has(p.text)) continue; seen.add(p.text); body.push(p); total += p.text.length; if (total > 9000 || body.length > 40) break; }
  const out = { url, title: meta(html, 'og:title') || clean((html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]), image: meta(html, 'og:image'),
    description: meta(html, 'og:description') || meta(html, 'description'), body, lang: (html.match(/<html[^>]+lang=["']([a-z]{2})/i) || [, ''])[1] };
  if (!/^https:\/\//.test(out.image)) out.image = '';
  cacheA.set(url, out); if (cacheA.size > 100) cacheA.delete(cacheA.keys().next().value);
  return out;
}

// Tradução pelo serviço público do Google Tradutor (sem chave). Divide em blocos e guarda em cache.
async function translateOne(text, to = 'pt') {
  const k = to + '|' + text;
  if (cacheT.has(k)) return cacheT.get(k);
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + to + '&q=' + encodeURIComponent(text);
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Tradutor respondeu ' + r.status);
  const j = await r.json();
  const t = (j[0] || []).map(x => x[0]).join('');
  cacheT.set(k, t); if (cacheT.size > 2000) cacheT.delete(cacheT.keys().next().value);
  return t;
}
async function translate(texts, to = 'pt') {
  if (!Array.isArray(texts) || texts.length > 80) throw new Error('Texto inválido');
  const out = [];
  // em lotes pequenos para ser rápido sem sobrecarregar o serviço
  for (let i = 0; i < texts.length; i += 6) {
    const part = await Promise.all(texts.slice(i, i + 6).map(t => String(t || '').slice(0, 4500)).map(t => t ? translateOne(t, to).catch(() => t) : ''));
    out.push(...part);
  }
  return out;
}
module.exports = { article, translate, allowed };
