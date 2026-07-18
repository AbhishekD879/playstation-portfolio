// Service worker — makes AbhishekStation installable and gives the app shell
// offline. Strategy: NETWORK-FIRST for everything same-origin (always the
// freshest deploy when online; the cached copy is only an offline fallback).
// The heavy stuff (emulator cores, Cesium, ML models, tiles) is left to the
// network — caching multi-GB payloads would blow the storage quota.
const CACHE = "asp-shell-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // cross-origin (models/tiles/APIs) → network
  // don't touch the huge self-hosted payloads or API calls
  // /rpgm/ is owned by rpgm-sw + static (engine wasm, on-demand RTP); the app
  // shell SW must never precache the heavy RPG Maker payloads.
  if (/^\/(cesium|play|pc|rpgm|assets\/.*(cesium|kokoro|transformers|CesiumGlobe))/.test(url.pathname) || url.pathname.startsWith("/api/")) return;

  // network-first: always try the network so a new deploy shows immediately;
  // fall back to the cache only when offline.
  e.respondWith(
    fetch(req)
      .then((r) => { cachePut(req, r.clone()); return r; })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : Response.error()))),
  );
});

function cachePut(req, res) {
  if (res && res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res));
}
