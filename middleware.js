// Proteção por senha da versão online (Vercel).
// Defina as variáveis de ambiente no painel da Vercel: APP_USER (opcional, padrão "mesa") e APP_PASSWORD.
// Sem APP_PASSWORD configurada, o site fica bloqueado, para nunca ficar aberto por engano.
export const config = { matcher: '/:path*' };

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default function middleware(request) {
  const pass = process.env.APP_PASSWORD;
  const user = process.env.APP_USER || 'mesa';
  if (!pass) {
    return new Response('Mesa SMC: defina APP_PASSWORD nas variáveis de ambiente do projeto na Vercel e publique de novo.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = atob(auth.slice(6)); } catch {}
    const i = decoded.indexOf(':');
    if (i > -1 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return; // segue para o site
  }
  return new Response('Acesso restrito.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mesa SMC", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
