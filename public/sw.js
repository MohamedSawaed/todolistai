// Tempo service worker: makes the app installable, shows reminder notifications,
// and opens the app when a notification is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Pages always come from the network (your data is live); if the phone is offline,
// show a friendly message instead of the browser's error page.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;color:#20202a"><h2>You’re offline</h2><p>Tempo needs a connection to load your schedule. Try again when you’re back online.</p></body>',
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

// Notifications pushed by the server (arrive even when Tempo is closed)
self.addEventListener("push", (event) => {
  let msg = { title: "Tempo", body: "", url: "/", tag: undefined };
  try {
    msg = { ...msg, ...(event.data ? event.data.json() : {}) };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: msg.url || "/" },
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => "focus" in w);
      if (open) {
        if ("navigate" in open) open.navigate(url).catch(() => undefined);
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
