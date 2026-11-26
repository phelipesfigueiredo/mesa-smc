// Service worker mínimo: permite mostrar notificações (inclusive no celular com o app instalado na tela inicial)
// e, ao tocar na notificação, abre o app já na moeda do sinal.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const sym = (e.notification.data && e.notification.data.sym) || '';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { c.postMessage({ type: 'open-signal', sym }); if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('/#' + sym);
  })());
});
