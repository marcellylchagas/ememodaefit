/* EME Moda & Fit · avisos do painel (notificações) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = {texto: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'EME Moda & Fit', {
    body: d.texto || '', icon: '/icone-192.png', badge: '/icone-192.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: {url: d.url || '/#painel'}, vibrate: [120, 60, 120]}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL((e.notification.data && e.notification.data.url) || '/#painel', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(l => {
    for (const c of l){ if (new URL(c.url).origin === self.location.origin){ c.focus(); if (!/#painel/.test(c.url) && c.navigate) c.navigate(url); return; } }
    return self.clients.openWindow(url); }));
});
/* v138: quando o navegador troca a inscrição sozinho (comum no Android), renova no servidor sem precisar abrir o painel */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const antigo = e.oldSubscription && e.oldSubscription.endpoint;
      let nova = e.newSubscription;
      if (!nova){ const chave = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey;
        if (!chave) return; nova = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: chave}); }
      if (!antigo || !nova) return;
      await fetch('https://badydvlyhfarbkcwvnfk.supabase.co/functions/v1/notificar', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({acao: 'renovar', antigo, nova: nova.toJSON()})});
    } catch (_) {}
  })());
});
