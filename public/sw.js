// Service worker — makes AbhishekStation installable and gives the app shell
// offline. Strategy: network-first for navigations (fresh HTML when online,
// cached fallback offline); stale-while-revalidate for same-origin static
// assets. The heavy stuff (emulator cores, Cesium, ML models, tiles) is left
// to the network — caching multi-GB payloads would blow the storage quota.
const CACHE = "asp-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // let cross-origin (models/tiles/APIs) hit the network
  // don't cache the huge self-hosted payloads or API calls
  if (/^\/(cesium|play|pc|assets\/.*(cesium|kokoro|transformers|CesiumGlobe))/.test(url.pathname) || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { cachePut(req, r.clone()); return r; }).catch(() => caches.match("/")));
    return;
  }
  // stale-while-revalidate for JS/CSS/fonts/icons
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { cachePut(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }),
  );
});

function cachePut(req, res) {
  if (res && res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res));
}
