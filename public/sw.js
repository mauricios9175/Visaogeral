// Service worker do app: recebe as notificações (push) e abre a tela do alerta ao tocar.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let aviso = { titulo: "Visão Geral", corpo: "", url: "/" };
  try { aviso = { ...aviso, ...e.data.json() }; } catch { /* sem conteúdo */ }
  e.waitUntil(self.registration.showNotification(aviso.titulo, {
    body: aviso.corpo,
    icon: "/icones/icone-192.png",
    badge: "/icones/icone-192.png",
    tag: aviso.tag,
    data: { url: aviso.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = abertas.find((c) => new URL(c.url).origin === self.location.origin);
    if (app) { await app.focus(); return app.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
