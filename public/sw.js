// Tempo service worker: makes the app installable, shows reminder notifications,
// and opens the app when a notification is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// "Share → Tempo" from another app (Android). The shared text and files stay on this
// device: they're kept in Cache Storage just long enough for the assistant page to pick
// them up, then deleted.
const SHARE_CACHE = "tempo-share";
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        await caches.delete(SHARE_CACHE);
        const cache = await caches.open(SHARE_CACHE);
        const files = form.getAll("files").filter((f) => f && typeof f !== "string").slice(0, 5);
        const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "", files: [] };
        for (let i = 0; i < files.length; i++) {
          const key = "/share-target/file/" + i;
          await cache.put(key, new Response(files[i], { headers: { "Content-Type": files[i].type || "application/octet-stream" } }));
          meta.files.push({ key, name: files[i].name || "shared-" + i, type: files[i].type || "" });
        }
        await cache.put("/share-target/meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
      } catch (e) {
        // fall through: the assistant shows "nothing was received" and offers upload
      }
      return Response.redirect("/assistant?share=1", 303);
    })(),
  );
});

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
