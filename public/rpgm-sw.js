// RPG Maker filesystem service worker — serves an extracted MV/MZ game out of
// OPFS so it runs from a real same-origin URL inside a sandboxed iframe (which
// is what PixiJS's XHR/fetch resource loading needs). Scope is locked to
// /rpgm-fs/ so this never intercepts the app shell, Vite HMR, or anything else.
// URL shape:  /rpgm-fs/<gameId>/<path within the game root>
const MIME = {
  html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", css: "text/css", wasm: "application/wasm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
  webm: "video/webm", mp4: "video/mp4",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  txt: "text/plain", rpgmvp: "application/octet-stream", rpgmvo: "application/octet-stream",
  rpgmvm: "application/octet-stream", efkefc: "application/octet-stream",
};
const mimeOf = (p) => MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Save isolation — injected into the game's index.html so its storage is
// namespaced per game. Without this, same-origin iframes all share our
// "localforage" IndexedDB and collide (every MZ game uses file1/config keys)
// and pollute the app. Prefixes MUST match rpgm.ts (SAVE_IDB/LS_PREFIX).
function isolationShim(gameId) {
  const IDB = "rpgm-" + gameId + "-";
  const LS = "__rpgmls_" + gameId + "__:";
  return `<script>(function(){
    try {
      var o = indexedDB.open.bind(indexedDB);
      indexedDB.open = function(n, v){ return o(${JSON.stringify(IDB)} + n, v); };
      var d = indexedDB.deleteDatabase.bind(indexedDB);
      indexedDB.deleteDatabase = function(n){ return d(${JSON.stringify(IDB)} + n); };
    } catch(e){}
    try {
      var real = window.localStorage, P = ${JSON.stringify(LS)};
      var keys = function(){ return Object.keys(real).filter(function(k){ return k.indexOf(P) === 0; }); };
      var proxy = {
        getItem: function(k){ return real.getItem(P + k); },
        setItem: function(k, v){ real.setItem(P + k, v); },
        removeItem: function(k){ real.removeItem(P + k); },
        clear: function(){ keys().forEach(function(k){ real.removeItem(k); }); },
        key: function(i){ var a = keys()[i]; return a ? a.slice(P.length) : null; },
        get length(){ return keys().length; }
      };
      Object.defineProperty(window, "localStorage", { configurable: true, get: function(){ return proxy; } });
    } catch(e){}
  })();</` + `script>`;
}

async function fileFromOpfs(gameId, path) {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("rpgm");
  dir = await dir.getDirectoryHandle(gameId);
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return (await dir.getFileHandle(name)).getFile();
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/^\/rpgm-fs\/([^/]+)\/(.*)$/);
  if (!m) return; // not ours
  const gameId = m[1];
  let path = decodeURIComponent(m[2] || "");
  if (path === "" || path.endsWith("/")) path += "index.html";

  e.respondWith((async () => {
    try {
      const file = await fileFromOpfs(gameId, path);
      const type = mimeOf(path);
      // The app runs cross-origin-isolated (COOP+COEP). For the iframe to load
      // AND stay embeddable, the served documents must carry matching isolation
      // headers + a same-origin CORP; without these the embed is blocked.
      const base = {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Opener-Policy": "same-origin",
      };
      // inject the save-isolation shim into the game's HTML entry point
      if (type === "text/html") {
        let html = await file.text();
        const shim = isolationShim(gameId);
        html = html.includes("<head>") ? html.replace(/<head>/i, "<head>" + shim) : shim + html;
        return new Response(html, { headers: base });
      }
      const range = e.request.headers.get("range");
      const m2 = range && range.match(/bytes=(\d*)-(\d*)/);
      if (m2) {
        const start = m2[1] ? parseInt(m2[1], 10) : 0;
        const end = m2[2] ? parseInt(m2[2], 10) : file.size - 1;
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { ...base, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) },
        });
      }
      return new Response(file, { headers: base });
    } catch {
      return new Response("Not found: " + path, { status: 404 });
    }
  })());
});
