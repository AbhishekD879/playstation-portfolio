// RPG Maker filesystem service worker. Scope: /rpgm/. Serves imported games
// out of OPFS so they run from real same-origin URLs. Two routes:
//   /rpgm/fs/<id>/<path>              → MV/MZ game files (HTML gets a save shim)
//   /rpgm/easyrpg/games/<id>/<path>   → EasyRPG (2k/2k3) game files + index.json
// Everything else under /rpgm/ (the vendored EasyRPG engine: play.html,
// index.js, index.wasm, rtp/*) falls through to the network/static host.
const MIME = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", css: "text/css", wasm: "application/wasm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
  mid: "audio/midi", midi: "audio/midi", webm: "video/webm", mp4: "video/mp4", avi: "video/x-msvideo",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", fon: "application/octet-stream",
  txt: "text/plain", ini: "text/plain", lmu: "application/octet-stream", lmt: "application/octet-stream",
  ldb: "application/octet-stream", lsd: "application/octet-stream", xyz: "application/octet-stream",
  rpgmvp: "application/octet-stream", rpgmvo: "application/octet-stream", rpgmvm: "application/octet-stream",
  efkefc: "application/octet-stream",
};
const mimeOf = (p) => MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// —— MV/MZ save isolation shim (injected into that route's HTML only) ——
// Namespaces indexedDB/localStorage per game so same-origin games don't collide
// on the shared "localforage" DB or pollute the app. Prefixes match rpgm.ts.
function isolationShim(gameId) {
  const IDB = "rpgm-" + gameId + "-", LS = "__rpgmls_" + gameId + "__:";
  return `<script>(function(){
    try { var o=indexedDB.open.bind(indexedDB); indexedDB.open=function(n,v){return o(${JSON.stringify(IDB)}+n,v);};
      var d=indexedDB.deleteDatabase.bind(indexedDB); indexedDB.deleteDatabase=function(n){return d(${JSON.stringify(IDB)}+n);}; } catch(e){}
    try { var real=window.localStorage, P=${JSON.stringify(LS)};
      var keys=function(){return Object.keys(real).filter(function(k){return k.indexOf(P)===0;});};
      var proxy={ getItem:function(k){return real.getItem(P+k);}, setItem:function(k,v){real.setItem(P+k,v);},
        removeItem:function(k){real.removeItem(P+k);}, clear:function(){keys().forEach(function(k){real.removeItem(k);});},
        key:function(i){var a=keys()[i];return a?a.slice(P.length):null;}, get length(){return keys().length;} };
      Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return proxy;}}); } catch(e){}
  })();</` + `script>`;
}

// The extractor doesn't strip the game's wrapper folder; it records the root
// prefix in a .rpgmroot marker. We prepend it so URLs (rootless) map to OPFS.
const rootCache = new Map();
async function gameRootPrefix(gameDir, gameId) {
  if (rootCache.has(gameId)) return rootCache.get(gameId);
  let root = "";
  try {
    const fh = await gameDir.getFileHandle(".rpgmroot");
    root = await (await fh.getFile()).text();
  } catch { root = ""; }
  rootCache.set(gameId, root);
  return root;
}
async function opfsFile(gameId, path) {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("rpgm");
  dir = await dir.getDirectoryHandle(gameId);
  const root = await gameRootPrefix(dir, gameId);
  const parts = (root + path).split("/").filter(Boolean);
  const name = parts.pop();
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return (await dir.getFileHandle(name)).getFile();
}

const ISO_HEADERS = {
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Opener-Policy": "same-origin",
};

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const p = url.pathname;

  // MV/MZ route
  let m = p.match(/^\/rpgm\/fs\/([^/]+)\/(.*)$/);
  const isMvMz = !!m;
  // EasyRPG game route (RTP fallback handled inside)
  if (!m) m = p.match(/^\/rpgm\/easyrpg\/games\/([^/]+)\/(.*)$/);
  if (!m) return; // engine statics + anything else → network

  const gameId = m[1];
  let path = decodeURIComponent(m[2] || "");
  if (path === "" || path.endsWith("/")) path += "index.html";

  e.respondWith((async () => {
    const type = mimeOf(path);
    const base = { "Content-Type": type, "Accept-Ranges": "bytes", ...ISO_HEADERS };
    let file;
    try {
      file = await opfsFile(gameId, path);
    } catch {
      // EasyRPG: fall back to the bundled RTP for assets the game itself omits.
      // LAZY: RTP files are only fetched when a game actually references one it
      // doesn't bundle (self-contained games pull zero RTP — the 12MB pack is
      // never a single download). Each fetched asset is cached so replays and
      // offline don't re-download it.
      if (!isMvMz) {
        const rtpUrl = "/rpgm/easyrpg/rtp/" + path;
        try {
          const cache = await caches.open("rpgm-rtp-v1");
          const hit = await cache.match(rtpUrl);
          if (hit) return hit;
          const res = await fetch(rtpUrl);
          if (res.ok) { cache.put(rtpUrl, res.clone()); return res; }
          // fall through to 404 (missing RTP asset renders blank, never crashes)
        } catch { /* offline + not cached */ }
      }
      return new Response("Not found: " + path, { status: 404, headers: ISO_HEADERS });
    }

    if (isMvMz && type === "text/html") {
      const html = (await file.text()).replace(/<head>/i, "<head>" + isolationShim(gameId));
      return new Response(html, { headers: base });
    }
    const range = e.request.headers.get("range");
    const mr = range && range.match(/bytes=(\d*)-(\d*)/);
    if (mr) {
      const start = mr[1] ? parseInt(mr[1], 10) : 0;
      const end = mr[2] ? parseInt(mr[2], 10) : file.size - 1;
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { ...base, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(file, { headers: base });
  })());
});
