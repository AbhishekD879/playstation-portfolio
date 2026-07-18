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

// —— NW.js / Node polyfill (injected into MV/MZ HTML only) ——
// Desktop RPG Maker builds (the ones packaged with a Game.exe + *.pak) ship
// plugins that call require('fs')/require('path') at LOAD time assuming NW.js.
// In a plain browser that throws "Can't find variable: require" and the
// engine's error screen appears before the title. We stub the Node/NW.js
// surface so those calls no-op, and force Utils.isNwjs()=false so the engine
// saves to browser storage (already isolated per game above) instead of a
// filesystem that doesn't exist here. We deliberately do NOT define
// module/exports/define — that would flip pixi.js's UMD into its CommonJS
// branch and break the engine.
// ponytail: fs is inert (readdir→[], write→noop); browsers have no disk. Games
// that read bundled data through fs at runtime would need OPFS-backed fs — add
// only if a real game needs it.
const NW_SHIM = `<script>(function(){
  if (typeof window.require === "function") return; // real NW.js — leave it
  var noop=function(){}, ret=function(v){return function(){return v;};};
  var path={sep:"/",delimiter:":",
    dirname:function(p){p=String(p).replace(/\\/+$/,"");var i=p.lastIndexOf("/");return i<=0?(i===0?"/":"."):p.slice(0,i);},
    basename:function(p,e){var b=(String(p).split("/").pop())||"";if(e&&b.slice(-e.length)===e)b=b.slice(0,-e.length);return b;},
    extname:function(p){var b=(String(p).split("/").pop())||"",i=b.lastIndexOf(".");return i>0?b.slice(i):"";},
    join:function(){return Array.prototype.filter.call(arguments,Boolean).join("/").replace(/\\/+/g,"/");},
    resolve:function(){return ("/"+Array.prototype.filter.call(arguments,Boolean).join("/")).replace(/\\/+/g,"/");},
    normalize:function(p){return String(p).replace(/\\/+/g,"/");}};
  var fs={existsSync:function(){return false;},readFileSync:function(){throw new Error("fs unavailable in browser");},
    writeFileSync:noop,appendFileSync:noop,mkdirSync:noop,rmdirSync:noop,unlinkSync:noop,renameSync:noop,copyFileSync:noop,
    readdirSync:function(){return [];},statSync:function(){return{isDirectory:ret(false),isFile:ret(false),size:0};},
    writeFile:function(){var cb=arguments[arguments.length-1];if(typeof cb==="function")cb(null);},
    readFile:function(){var cb=arguments[arguments.length-1];if(typeof cb==="function")cb(new Error("fs unavailable"));}};
  var win={on:noop,removeAllListeners:noop,show:noop,hide:noop,focus:noop,blur:noop,close:noop,reload:noop,
    maximize:noop,unmaximize:noop,minimize:noop,restore:noop,setProgressBar:noop,setResizable:noop,requestAttention:noop,
    setMaximumSize:noop,setMinimumSize:noop,resizeTo:noop,moveTo:noop,setAlwaysOnTop:noop,setPosition:noop,
    leaveFullscreen:noop,toggleFullscreen:noop,enterFullscreen:noop,zoomLevel:0,x:0,y:0,width:816,height:624,
    title:document.title,window:window,menu:null};
  var nwgui={Window:{get:function(){return win;},open:noop},App:{argv:[],fullArgv:[],filteredArgv:[],dataPath:"/",manifest:{},
    clearCache:noop,quit:function(){try{window.close();}catch(e){}},closeAllWindows:noop,addOriginAccessWhitelistEntry:noop},
    Shell:{openExternal:function(u){try{window.open(u,"_blank");}catch(e){}},openItem:noop,showItemInFolder:noop},
    Menu:function(){return{append:noop,insert:noop,removeAt:noop,items:[]};},MenuItem:function(){return{};},
    Clipboard:{get:function(){return{set:noop,get:ret("")};}},Screen:{Init:noop,screens:[]}};
  var modules={fs:fs,path:path,"nw.gui":nwgui,nw:nwgui,
    os:{platform:ret("browser"),tmpdir:ret("/tmp"),homedir:ret("/"),EOL:"\\n",release:ret(""),arch:ret("x64")},
    electron:{remote:{app:{getPath:ret("/"),quit:noop},getCurrentWindow:function(){return win;}},
      ipcRenderer:{on:noop,once:noop,send:noop,removeListener:noop,invoke:function(){return Promise.resolve();}}},
    child_process:{execSync:noop,exec:function(){var cb=arguments[arguments.length-1];if(typeof cb==="function")cb(null,"","");},
      spawn:function(){return{on:noop,unref:noop,stdout:{on:noop},stderr:{on:noop}};}}};
  window.require=function(n){return modules[n]||{};};
  window.process=window.process||{platform:"browser",arch:"x64",argv:[],argv0:"",execPath:"",env:{},
    versions:{node:"",nw:"",chromium:""},cwd:ret("/"),chdir:noop,on:noop,exit:noop,
    nextTick:function(f){Promise.resolve().then(f);},stdout:{write:noop},stderr:{write:noop}};
  window.global=window.global||window;
  window.nw=nwgui;
  // The engine's core defines Utils AFTER this head script. Once it exists,
  // force browser-storage mode so saves persist (and never hit the fs stub).
  // ponytail: 5ms poll capped at ~5s; Utils is defined within the first core
  // script eval, long before any save.
  var tries=0,t=setInterval(function(){
    if(window.Utils&&typeof window.Utils.isNwjs==="function"){window.Utils.isNwjs=function(){return false;};clearInterval(t);}
    else if(++tries>1000){clearInterval(t);}
  },5);
})();</` + `script>`;

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
      // Inject the NW.js polyfill first (require must exist before any script
      // runs), then the save-isolation shim. RPG Maker index.html always has a
      // <head>; if it somehow doesn't, prepend so the shims still run first.
      const raw = await file.text();
      const shims = NW_SHIM + isolationShim(gameId);
      const html = /<head[^>]*>/i.test(raw)
        ? raw.replace(/<head[^>]*>/i, (m) => m + shims)
        : shims + raw;
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
