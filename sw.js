// Keeps Cardfile working offline. App files are cached on install; the card reader
// files (about 12 MB) are cached the first time they're used.
const VERSION = "cardfile-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "parse.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const isShell = req.mode === "navigate" || /\.(html|css|js|webmanifest)$/.test(new URL(req.url).pathname) && !/\/vendor\//.test(req.url);
  if (isShell) {
    // Network first for app files so updates arrive, cache as fallback offline
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else {
    // Cache first for the large card reader files and icons
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })));
  }
});
