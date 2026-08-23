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
// a re-import can change a game's root prefix / lite flag / pack — forget all
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "rpgm-root-bust") { rootCache.delete(e.data.id); liteCache.delete(e.data.id); packCache.delete(e.data.id); rpaCache.delete(e.data.id); }
});

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
  path.posix=path; path.win32=path; // plugins reach for require('path').posix — JoiPlay's NWJSAPI clones it
  // fs: sync BYTE reads can't work (sync XHR bypasses the SW), so readFileSync
  // throws. But existsSync only needs a BOOLEAN — and we inject window.__rpgmFS,
  // a Set of every real game file (built from the pack index / OPFS walk), so it
  // answers TRUTHFULLY and synchronously. This matters: many cutscene/CG plugins
  // guard show-picture behind existsSync(cg) — a blanket false made the event
  // find no images and end instantly (the "cutscene blinks and vanishes" bug).
  // ASYNC reads are REAL: async fetch goes through the SW, so plugins loading
  // data via fs.readFile(cb) or fs.promises get actual bytes.
  var relPath=function(p){ return String(p).replace(/^[A-Za-z]:[\\\\/]/,"").replace(/\\\\/g,"/").replace(/^\\.\\//,"").replace(/^\\/+/,""); };
  var fsUrl=function(p){ p=relPath(p); try{ return new URL(p, location.href).href; }catch(e){ return null; } };
  var fsHas=function(p){ var n=relPath(p); try{n=n.normalize("NFKC");}catch(e){} n=n.toLowerCase();
    return !!(window.__rpgmFS && window.__rpgmFS.has(n)); };
  // A directory exists if anything in the manifest sits under it. Manifest paths
  // are game-root-relative and NFKC-lowercased (see manifestFor), so normalise
  // the query the same way fsHas does.
  var fsKey=function(p){ var n=relPath(p); try{n=n.normalize("NFKC");}catch(e){} return n.toLowerCase(); };
  var fsIsDir=function(p){ var n=fsKey(p); if(n && n.slice(-1)!=="/") n+="/";
    var S=window.__rpgmFS; if(!S) return false; if(!n) return true;
    var hit=false; S.forEach(function(k){ if(!hit && k.lastIndexOf(n,0)===0) hit=true; }); return hit; };
  // Immediate children only, like the real readdirSync: names, not paths, and a
  // subdirectory appears once rather than once per file inside it.
  var fsList=function(p){ var n=fsKey(p); if(n && n.slice(-1)!=="/") n+="/";
    var S=window.__rpgmFS; if(!S) return [];
    var seen={}; S.forEach(function(k){ if(n && k.lastIndexOf(n,0)!==0) return;
      var rest=k.slice(n.length); if(!rest) return;
      var i=rest.indexOf("/"); seen[i<0?rest:rest.slice(0,i)]=1; });
    return Object.keys(seen); };
  var fsRead=function(p, enc){ var u=fsUrl(p);
    return fetch(u).then(function(r){ if(!r.ok) throw new Error("ENOENT: "+p);
      return enc ? r.text() : r.arrayBuffer().then(function(ab){
        var a=new Uint8Array(ab);
        a.toString=function(){ try{ return new TextDecoder().decode(new Uint8Array(this)); }catch(e){ return ""; } };
        return a; }); }); };
  var dl=function(p,r){ try{ if(window.__diaglog) window.__diaglog(p,r); }catch(e){} };
  var fs={existsSync:function(p){var ok=fsHas(p);dl("fs.existsSync "+p,ok?"scaffold →true (in manifest)":(window.__rpgmFS?"scaffold →false (not in manifest)":"scaffold →false (no manifest)"));return ok;},readFileSync:function(p){dl("fs.readFileSync "+p,"scaffold sync-unavailable");throw new Error("fs sync reads unavailable in browser: "+p);},
    writeFileSync:noop,appendFileSync:noop,mkdirSync:noop,rmdirSync:noop,unlinkSync:noop,renameSync:noop,copyFileSync:noop,
    readdirSync:function(p){var r=fsList(p);dl("fs.readdirSync "+p,"scaffold →"+r.length+" entries");return r;},
    statSync:function(p){var f=fsHas(p),d=!f&&fsIsDir(p);
      if(!f&&!d){dl("fs.statSync "+p,"scaffold →ENOENT");var e=new Error("ENOENT: "+p);e.code="ENOENT";throw e;}
      return{isDirectory:ret(d),isFile:ret(f),isSymbolicLink:ret(false),size:0,mtime:new Date(0),mtimeMs:0};},
    writeFile:function(){var cb=arguments[arguments.length-1];if(typeof cb==="function")cb(null);},
    readFile:function(p,opt,cb){ if(typeof opt==="function"){cb=opt;opt=null;}
      var enc=typeof opt==="string"?opt:(opt&&opt.encoding);
      dl("fs.readFile "+p,"scaffold async");
      fsRead(p,enc).then(function(d){ if(typeof cb==="function")cb(null,d); },
        function(e){ dl("fs.readFile "+p,"scaffold FAILED: "+(e&&e.message)); if(typeof cb==="function")cb(e); }); },
    promises:{ readFile:function(p,opt){ return fsRead(p, typeof opt==="string"?opt:(opt&&opt.encoding)); } }};
  var win={on:noop,removeAllListeners:noop,show:noop,hide:noop,focus:noop,blur:noop,close:noop,reload:noop,
    maximize:noop,unmaximize:noop,minimize:noop,restore:noop,setProgressBar:noop,setResizable:noop,requestAttention:noop,
    setMaximumSize:noop,setMinimumSize:noop,resizeTo:noop,moveTo:noop,setAlwaysOnTop:noop,setPosition:noop,
    leaveFullscreen:noop,toggleFullscreen:noop,enterFullscreen:noop,zoomLevel:0,x:0,y:0,width:816,height:624,
    // evalNWBin: NW.js snapshot loader. We can't run compiled .bin, and the .js
    // source already loads via normal <script> tags, so a defined no-op just
    // prevents a "not a function" crash on games that call it (JoiPlay parity).
    evalNWBin:noop,eval:function(f,s){try{if(s)(0,eval)(String(s));}catch(e){}},
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
  window.require=function(n){ try{ if(window.__diaglog) window.__diaglog("require('"+n+"')", modules[n]?"scaffold ok":"scaffold MISSING — plugin may break"); }catch(e){} return modules[n]||{};};
  // process must be an OBJECT (plugins read process.platform), but two traps:
  // (1) MZ main.js isPathRandomized() reads process.mainModule.filename
  //     unconditionally (only gated on typeof process==="object"), so a bare
  //     process crashes boot → infinite loading spinner. Give it a filename
  //     that doesn't start with "/private/var".
  // (2) Emscripten modules (effekseer.wasm) detect Node via
  //     typeof process.versions.node==="string" and then call process.hrtime /
  //     require('fs'). Leave versions.node UNDEFINED so they take the web path;
  //     hrtime is a real-time stub in case anything calls it anyway.
  var hrtime=function(p){var t=performance.now()*1e-3,s=Math.floor(t),n=Math.floor((t-s)*1e9);
    if(p){var ds=s-p[0],dn=n-p[1];if(dn<0){ds--;dn+=1e9;}return [ds,dn];}return [s,n];};
  hrtime.bigint=function(){return typeof BigInt==="function"?BigInt(Math.round(performance.now()*1e6)):Math.round(performance.now()*1e6);};
  window.process=window.process||{platform:"browser",arch:"x64",argv:[],argv0:"",execPath:"/index.html",
    version:"",versions:{},env:{},cwd:ret("/"),chdir:noop,on:noop,exit:noop,hrtime:hrtime,
    // process.release: DEFINED (some plugins read process.release.name) but
    // EMPTY — do NOT set name:"node", or Node-detecting libs (effekseer) take
    // the node path and break. Empty object = no crash, no false "I'm Node".
    release:{},
    mainModule:{filename:"/index.html"},nextTick:function(f){Promise.resolve().then(f);},
    stdout:{write:noop},stderr:{write:noop}};
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

// —— diagnostics probe (injected into MV/MZ HTML) ——
// The user plays on mobile with no console, so when a game hangs we have to
// surface why on-screen. This runs inside the game frame, watches uncaught
// errors and XHR/fetch loads (RPG Maker's asset pipeline), and posts a compact
// snapshot to the host (RpgPlayer) once a second. The host shows errors +
// stuck/failed assets. We deliberately DON'T wrap Image — hooking its src
// accessor risks breaking the engine's own bitmap/decrypt path, and a missing
// image renders blank rather than hanging; XHR+fetch already cover data files,
// audio buffers, fonts and the effekseer wasm, which are the things that stall.
// Bump whenever a shim changes — a log that cannot name its own version wastes
// a capture, which is exactly what happened once.
const SHIM_V = "33";
const DIAG_SHIM = `<script>(function(){
  var T0=Date.now(), seq=0, pending={}, recent=[], errors=[], counts={ok:0,fail:0}, activity=[], xfer=[];
  // MOVEMENT channel — map transfers (doors/stairs) + event triggers get their
  // OWN small ring so they're NEVER evicted by high-frequency parallel-event
  // command spam (a per-frame Script/Conditional loop can flood 'activity' in
  // under a second, burying the one door line that matters). Dedups repeats.
  function xlog(m){ var last=xfer[0]; if(last&&last.m===m){ last.n=(last.n||1)+1; last.t=Date.now()-T0; post(); return; }
    xfer.unshift({m:m, n:1, t:Date.now()-T0}); if(xfer.length>60) xfer.pop(); post(); }
  // startup: record the fs manifest so a still-failing existsSync can be compared
  // against the REAL stored picture paths (case/prefix/naming mismatches show here).
  var manifest="manifest: (not read)";
  try{ var _fs=window.__rpgmFS, _s=[]; if(_fs){ var _it=_fs.values(), _v; while(_s.length<6){ _v=_it.next(); if(_v.done) break; if(/pictures/.test(_v.value)) _s.push(_v.value); } }
    manifest="manifest: "+(_fs?_fs.size+" files":"MISSING — existsSync will be false")+(_s.length?" · sample: "+_s.join(" | "):""); }catch(e){}
  function rel(u){ try{ var pp=new URL(u, location.href).pathname; var i=pp.indexOf("/rpgm/");
    if(i<0) return pp; var parts=pp.slice(i+6).split("/");
    if(parts[0]==="fs") return parts.slice(2).join("/");
    if(parts[0]==="easyrpg"&&parts[1]==="games") return parts.slice(3).join("/");
    return pp; }catch(e){ return String(u); } }
  // every asset load (image/video/audio/xhr/fetch) funnels through here — this
  // is what makes a failed CUTSCENE asset visible. Keeps a rolling activity log
  // so you can see exactly what the game just tried to load when a scene broke.
  function logAct(path, ok, reason){
    activity.unshift({path:path, ok:!!ok, reason:reason||"", t:Date.now()-T0}); if(activity.length>200) activity.pop();
    if(ok){ counts.ok++; } else { counts.fail++; recent.unshift({path:path, status:reason||"failed"}); if(recent.length>12) recent.pop(); post(); }
  }
  function begin(u){ var id=++seq; pending[id]={path:rel(u), t0:Date.now()}; return id; }
  function fin(id, status, emsg){ var e=pending[id]; if(!e) return; delete pending[id];
    var ok=status>=200&&status<400; logAct(e.path, ok, ok?"":(emsg||status||"error")); }
  function snap(){ var now=Date.now(), pend=[]; runProbe();
    for(var k in pending){ pend.push({path:pending[k].path, age: now-pending[k].t0}); }
    pend.sort(function(a,b){return b.age-a.age;});
    var sp=document.getElementById("loadingSpinner"), spinner=!!(sp&&getComputedStyle(sp).display!=="none");
    var scene=(window.SceneManager&&SceneManager._scene&&SceneManager._scene.constructor)?SceneManager._scene.constructor.name:"";
    var canvas=!!document.querySelector("canvas");
    return {source:"rpgm-diag", up:now-T0, scene:scene, spinner:spinner,
      booted:!!(canvas&&!spinner&&(scene?scene!=="Scene_Boot":true)), canvas:canvas,
      pending:pend.slice(0,12), recent:recent.slice(0,20), counts:counts, errors:errors.slice(0,10), activity:activity.slice(0,400), xfer:xfer.slice(0,60), manifest:manifest,
      probe:(probe||(probed?"":"no VAnim global — defined inside a plugin closure")), codecs:codecs, shimV:"${SHIM_V}", vids:vidState(), frames:frames, gl:glCompare(), canv:canvasInfo(), glLoad:glLoad(), pixi:pixiInfo(), stage:stageDump(), pics:pictureDump(), renpyLog:renpyLogs(), renpyMissing:renpyMissing(), firstErrors:firstErrs,
      esc:ecHits.length?ecHits.join(" ;; "):(ecHooked?"drawText hooked, no raw escape code seen":"drawText not hooked"),
      conv:(ecConvHooked?("fixed="+ecFixed+" codes["+(Object.keys(ecCodes).map(function(k){ return k+"x"+ecCodes[k]; }).join(",")||"NONE CALLED")+"] "
        +(ecConv.length?ecConv.join(" ;; "):"no backslash reached convertEscapeCharacters")):"convertEscapeCharacters not hooked"),
      vkey:"alpha["+vkWhy+"] keyed="+vkApplied+" overlays="+vkOverlays+" lit["+vkFracs.join(" ")+"]",
      selftest:stOut ? stOut+(stRun?" · STILL RUNNING":" · complete") : ""}; }
  // One-shot source probe for globals whose art never loads. Captured lazily
  // because a plugin defining them may not have run at startup.
  var vids=[], wantFrame=false, frames=[];
  // Stats travel with every thumbnail so a conclusion never rests on my reading
  // of a small JPEG: near-black share and strong-red share are computed here.
  function shot(src, w, h, label, wide){
    try{
      var cap=wide?560:220;
      var sw=Math.min(cap, w||cap), sh=Math.round((h||150)*(sw/(w||cap)));
      var c=document.createElement("canvas"); c.width=sw; c.height=sh;
      var g=c.getContext("2d"); if(!g) return null;
      g.fillStyle="#808080"; g.fillRect(0,0,sw,sh);   // transparent != black
      g.drawImage(src, 0, 0, sw, sh);
      var d=g.getImageData(0,0,sw,sh).data, n=d.length/4, dark=0, red=0, sum=0;
      for(var i=0;i<d.length;i+=4){ var r=d[i],gg=d[i+1],b=d[i+2];
        var l=(r*299+gg*587+b*114)/1000; sum+=l;
        if(l<12) dark++;
        if(r>90 && r>gg*2 && r>b*2) red++; }
      return { label:label, w:sw, h:sh,
        stats:"mean="+Math.round(sum/n)+" black="+Math.round(100*dark/n)+"% red="+Math.round(100*red/n)+"%",
        url:c.toDataURL("image/jpeg", wide?0.6:0.45) };
    }catch(e){ return { label:label, stats:"capture threw: "+(e&&e.message), url:"" }; }
  }
  // Upload the source to a texture, attach it to a framebuffer, read a patch back.
  // No shader needed, and readPixels is confined to 32x32 so a 1169x826 frame
  // never costs 15MB.
  function texProbe(gl, src, w, h){
    var t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    while(gl.getError()!==gl.NO_ERROR){}                     // clear stale errors
    try{ gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src); }
    catch(e){ return "threw:"+(e&&e.name); }
    var e1=gl.getError(); if(e1!==gl.NO_ERROR) return "glErr:"+e1;
    var fb=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); return "fb-incomplete"; }
    var sw=32, sh=32, px=new Uint8Array(sw*sh*4);
    // sample from the middle, where a character sprite actually has pixels
    gl.readPixels(Math.max(0,(w>>1)-16), Math.max(0,(h>>1)-16), sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    var sum=0, nz=0;
    for(var i=0;i<px.length;i+=4){ var l=(px[i]*299+px[i+1]*587+px[i+2]*114)/1000; sum+=l; if(l>12) nz++; }
    return "mean="+Math.round(sum/(sw*sh))+" lit="+Math.round(100*nz/(sw*sh))+"%";
  }
  function glCompare(){
    try{
      var v=null;
      for(var i=0;i<vids.length;i++){ if(vids[i].videoWidth){ v=vids[i]; break; } }
      if(!v) return "no video with dimensions yet";
      var c=document.createElement("canvas"); c.width=64; c.height=64;
      var gl=c.getContext("webgl")||c.getContext("experimental-webgl");
      if(!gl) return "no webgl context";
      var vw=v.videoWidth, vh=v.videoHeight;
      var direct=texProbe(gl, v, vw, vh);
      // the proposed fix: even dimensions, via a 2D canvas
      var ew=vw-(vw%2), eh=vh-(vh%2);
      var mid=document.createElement("canvas"); mid.width=ew; mid.height=eh;
      var g2=mid.getContext("2d"); g2.drawImage(v,0,0,ew,eh);
      var viaCanvas=texProbe(gl, mid, ew, eh);
      return vw+"x"+vh+(vw%2?" (ODD width)":" (even)")
        +" · direct-video[" + direct + "]"
        +" · via-2D-canvas " + ew + "x" + eh + "[" + viaCanvas + "]";
    }catch(e){ return "probe threw: "+(e&&e.message); }
  }
  // Wrap texImage2D on the live context: count uploads, total bytes, and record
  // any that raise a GL error — an out-of-memory upload fails silently otherwise.
  var texN=0, texMB=0, texErr=[], texHooked=false, ctxLost=0, texKind={}, vidUp={};
  function hookGL(){
    if(texHooked) return;
    try{
      var gc=(window.Graphics&&Graphics._canvas)||document.querySelector("canvas");
      if(!gc) return;
      var proto=window.WebGLRenderingContext&&WebGLRenderingContext.prototype;
      if(!proto||proto.__diagTex) return;
      proto.__diagTex=1; texHooked=true;
      var ti=proto.texImage2D;
      proto.texImage2D=function(){
        var a=arguments, src=a[a.length-1], w=0,h=0;
        try{ if(src&&src.videoWidth){ w=src.videoWidth; h=src.videoHeight; }
             else if(src&&src.width){ w=src.width|0; h=src.height|0; } }catch(e){}
        try{ var k=(src&&src.constructor&&src.constructor.name)||(src===null?"null":typeof src);
             texKind[k]=(texKind[k]||0)+1;
             if(src&&src.videoWidth!==undefined){
               var nm=((src.currentSrc||src.src||"?").split("/").pop());
               vidUp[nm]=(vidUp[nm]||0)+1; } }catch(e){}
        var r=ti.apply(this,a);
        try{
          texN++; if(w&&h) texMB+=(w*h*4)/1048576;
          var e=this.getError&&this.getError();
          if(e && texErr.length<6) texErr.push("err"+e+"@"+w+"x"+h+" (upload #"+texN+")");
        }catch(e2){}
        return r; };
      var tsi=proto.texSubImage2D;
      if(typeof tsi==="function"){ proto.texSubImage2D=function(){
        var a=arguments, src=a[a.length-1];
        try{ var k="sub:"+((src&&src.constructor&&src.constructor.name)||typeof src);
             texKind[k]=(texKind[k]||0)+1; }catch(e){}
        return tsi.apply(this,a); }; }
      gc.addEventListener("webglcontextlost", function(){ ctxLost++; elog("WEBGL CONTEXT LOST","error"); }, false);
    }catch(e){}
  }
  function glLoad(){
    var ks=[]; try{ for(var k in texKind) ks.push(k+"="+texKind[k]); }catch(e){}
    return "uploads="+texN+" ~"+Math.round(texMB)+"MB total forcedAfterPause="+vfix
      +" · sources["+ks.join(" ")+"]"
      +" ctxLost="+ctxLost
      +(texErr.length?" · ERRORS: "+texErr.join(" | "):" · no upload errors");
  }
  var vfix=0;
  function refreshTexturesFor(v){
    try{
      var C=window.PIXI && PIXI.utils && PIXI.utils.BaseTextureCache;
      if(!C) return 0;
      var n=0;
      for(var k in C){ var bt=C[k];
        if(bt && bt.source===v && typeof bt.update==="function"){ bt.update(); n++; } }
      if(n) vfix+=n;
      return n;
    }catch(e){ return 0; }
  }
  function patchVideoTextures(){
    try{
      var P=window.PIXI;
      if(!P || !P.VideoBaseTexture || P.VideoBaseTexture.__diagFix) return;
      var proto=P.VideoBaseTexture.prototype;
      if(!proto || typeof proto._onPlayStop!=="function") return;
      P.VideoBaseTexture.__diagFix=1;
      var stop=proto._onPlayStop;
      proto._onPlayStop=function(){
        var self=this, n=0;
        var push=function(){
          try{ self.update(); vfix++; }catch(e){}
          if(++n<4) requestAnimationFrame(push);
        };
        try{ requestAnimationFrame(push); }catch(e){}
        return stop.apply(this, arguments);
      };
      elog("PIXI video-pause texture fix installed","engine img");
    }catch(e){}
  }
  function pixiInfo(){
    try{
      var P=window.PIXI;
      if(!P) return "window.PIXI ABSENT — module-scoped or a custom renderer";
      var have=[];
      ["VideoBaseTexture","VideoResource","BaseTexture","Texture","Sprite"].forEach(function(n){
        if(P[n]) have.push(n); });
      var r=P.resources ? Object.keys(P.resources).filter(function(k){ return /video/i.test(k); }) : [];
      return "PIXI "+(P.VERSION||"?")+" · has["+have.join(",")+"]"
        +" · resources.video["+(r.join(",")||"none")+"]";
    }catch(e){ return "pixiInfo threw: "+(e&&e.message); }
  }
  /** The videos hold perfect sprites and upload correctly whether playing or
   *  paused, yet the composited canvas is 94% black with one clipped fragment.
   *  So the fault is in how the sprites are placed, not in the pixels. Walk the
   *  live stage and report every node's transform, alpha and texture, which
   *  makes a wrong scale, offset, clip or alpha visible as numbers. */
  /** iOS Safari decodes VP8/VP9 but ignores the WebM alpha channel, so a
   *  transparent character video arrives as an opaque black rectangle. Measured,
   *  not assumed: the frame capture pre-fills grey and the videos still read
   *  mean=18 black=73%, and the stage holds three full-canvas video sprites
   *  stacked over the map — which is the black screen.
   *
   *  Never guess the platform. Draw the video's top-left corner over magenta and
   *  look: magenta surviving means real transparency, black means the alpha was
   *  dropped. Only key the black out when it was actually dropped, so a browser
   *  with working alpha is left alone. */
  var vkAlpha=null, vkWhy="not probed", vkFilters={}, vkApplied=0, vkOverlays=0, vkTick=0, vkFracs=[];
  function alphaWorks(v){
    if(vkAlpha!==null) return vkAlpha;
    try{
      if(!v.videoWidth) return null;
      var c=document.createElement("canvas"); c.width=8; c.height=8;
      var g=c.getContext("2d"); if(!g) return null;
      g.fillStyle="#ff00ff"; g.fillRect(0,0,8,8);
      g.drawImage(v, 0,0,8,8, 0,0,8,8);          // native-scale corner, not a downscale
      var d=g.getImageData(0,0,1,1).data;
      vkAlpha=(d[0]>200 && d[2]>200 && d[1]<80);  // magenta survived
      vkWhy="corner rgb("+d[0]+","+d[1]+","+d[2]+") -> "+(vkAlpha?"alpha OK":"ALPHA DROPPED");
      return vkAlpha;
    }catch(e){ vkWhy="probe threw: "+(e&&e.message); return null; }
  }
  /** A base character is an opaque figure on transparent black, so brightness is
   *  a fair stand-in for its near-binary alpha. An expression overlay is not:
   *  character_m_blush.webm is 99% black with one small red streak whose softness
   *  lived entirely in the discarded alpha channel, so keying it by brightness
   *  renders it at full strength — the solid red bar. No mask or alpha video
   *  ships alongside, so the true values are unrecoverable and this is an
   *  approximation. Tell the two apart by how much of the frame is lit, and give
   *  the sparse one a fraction of the opacity. */
  var VK_OVERLAY_ALPHA=0.10, VK_SPARSE_MAX=0.10;
  function nonBlackFrac(v){
    try{
      var c=document.createElement("canvas"); c.width=48; c.height=34;
      var g=c.getContext("2d"); if(!g) return -1;
      g.fillStyle="#000000"; g.fillRect(0,0,48,34);
      g.drawImage(v, 0, 0, 48, 34);
      var d=g.getImageData(0,0,48,34).data, n=0;
      for(var i=0;i<d.length;i+=4){ if(d[i]>24||d[i+1]>24||d[i+2]>24) n++; }
      return n/(48*34);
    }catch(e){ return -1; }
  }
  function videoKeyFilter(strength){
    var key=String(strength);
    if(vkFilters[key]) return vkFilters[key];
    var P=window.PIXI; if(!P || !P.Filter) return null;
    var NL=String.fromCharCode(10);
    var frag=[
      "varying vec2 vTextureCoord;",
      "uniform sampler2D uSampler;",
      "uniform float uStrength;",
      "void main(void){",
      "  vec4 c = texture2D(uSampler, vTextureCoord);",
      "  float l = max(max(c.r, c.g), c.b);",
      "  float a = smoothstep(0.02, 0.14, l) * uStrength;",
      "  gl_FragColor = vec4(c.rgb * a, a);",     // PIXI 4 wants premultiplied
      "}"].join(NL);
    try{
      var f=new P.Filter(null, frag);
      f.uniforms.uStrength=strength;
      vkFilters[key]=f;
    }catch(e){ vkWhy+=" · filter failed: "+(e&&e.message); return null; }
    return vkFilters[key];
  }
  function keyVideoSprites(){
    try{
      var root=window.SceneManager && SceneManager._scene; if(!root) return;
      (function walk(node){
        if(!node) return;
        var t=node.texture, src=t && t.baseTexture && t.baseTexture.source;
        if(src && src.videoWidth!==undefined && !node.__vkeyed){
          if(alphaWorks(src)===false){
            var frac=nonBlackFrac(src);
            var sparse=(frac>=0 && frac<VK_SPARSE_MAX);
            var f=videoKeyFilter(sparse?VK_OVERLAY_ALPHA:1);
            if(f){
              node.filters=(node.filters||[]).concat([f]);
              node.__vkeyed=true; vkApplied++;
              if(sparse) vkOverlays++;
              if(vkFracs.length<8) vkFracs.push(((src.currentSrc||src.src||"?").split("/").pop())
                +"="+(frac<0?"?":Math.round(frac*100)+"%")+(sparse?" OVERLAY":" base"));
            }
          }
        }
        var k=node.children||[];
        for(var i=0;i<k.length;i++) walk(k[i]);
      })(root);
    }catch(e){}
  }
  var ecConv=[], ecCodes={}, ecConvHooked=false, ecFixed=0;
  /** A lone backslash at end of line means nothing in MV, but the word-wrap
   *  plugin strips the newline and the <WordWrap> tag that follow it, which
   *  glues that stray backslash onto the next line's \c[n]. MV's own rule then
   *  reads the resulting pair as an escaped literal backslash and prints
   *  "\c[0]" as visible text. Measured, both halves in one capture:
   *    works:  "...]\n<WordWrap>\c[0](There's..."  -> "...]\x1bc[0](There's..."
   *    breaks: "...]\\n<WordWrap>\c[0](No way!?)" -> "...]\\c[0](No way!?)"
   *  Drop only an unpaired trailing backslash — an even run is a legitimate
   *  escaped backslash and must survive. */
  function fixStrayEscapes(t){
    var BS=String.fromCharCode(92), NL=String.fromCharCode(10);
    if(t.indexOf(BS)<0) return t;
    var out="", i=0;
    while(i<t.length){
      if(t.charAt(i)!==BS){ out+=t.charAt(i); i++; continue; }
      var j=i; while(j<t.length && t.charAt(j)===BS) j++;
      var run=j-i, k=j;
      while(k<t.length && (t.charAt(k)===" " || t.charAt(k)==="\t")) k++;
      if((k>=t.length || t.charAt(k)===NL) && (run%2)===1){ run--; ecFixed++; }
      for(var n=0;n<run;n++) out+=BS;
      i=j;
    }
    return out;
  }
  function hookConvert(){
    try{
      var W=window.Window_Base;
      if(ecConvHooked || !W || !W.prototype || !W.prototype.convertEscapeCharacters) return;
      ecConvHooked=true;
      var BS=String.fromCharCode(92);
      var oc=W.prototype.convertEscapeCharacters;
      W.prototype.convertEscapeCharacters=function(text){
        var inp=String(text==null?"":text);
        var out=oc.call(this, fixStrayEscapes(inp));
        try{
          if(ecConv.length<5 && inp.indexOf(BS)>=0){
            ecConv.push("in="+JSON.stringify(inp.slice(0,90))
              +" out="+JSON.stringify(String(out).slice(0,90)));
          }
        }catch(e){}
        return out;
      };
      if(W.prototype.processEscapeCharacter){
        var op=W.prototype.processEscapeCharacter;
        W.prototype.processEscapeCharacter=function(code){
          try{ ecCodes[code]=(ecCodes[code]||0)+1; }catch(e){}
          return op.apply(this, arguments);
        };
      }
    }catch(e){}
  }
  var ecHits=[], ecHooked=false;
  function hookEscapeText(){
    try{
      if(ecHooked || !window.Bitmap || !Bitmap.prototype || !Bitmap.prototype.drawText) return;
      ecHooked=true;
      var BS=String.fromCharCode(92), ESC=String.fromCharCode(27), NL=String.fromCharCode(10);
      var orig=Bitmap.prototype.drawText;
      Bitmap.prototype.drawText=function(text){
        try{
          var t=String(text==null?"":text);
          var raw=(t.indexOf(BS+"c")>=0 || t.indexOf(BS+"C")>=0
                || t.indexOf(BS+"v")>=0 || t.indexOf(BS+"V")>=0 || t.indexOf(ESC)>=0);
          if(raw && ecHits.length<6){
            var who="?";
            try{
              var lines=((new Error()).stack||"").split(NL);
              for(var i=1;i<lines.length && i<7;i++){
                if(lines[i].indexOf("drawText")<0){ who=lines[i].replace(/^[ ]+/,"").slice(0,110); break; }
              }
            }catch(e2){}
            ecHits.push(JSON.stringify(t.slice(0,70))+" <- "+who);
          }
        }catch(e){}
        return orig.apply(this, arguments);
      };
    }catch(e){}
  }
  /** Ren'Py's own logs from inside the emscripten filesystem. The engine writes
   *  its traceback there before exiting, so this is the actual reason rather
   *  than something reconstructed from interleaved stderr. */
  function renpyLogs(){
    try{
      var FSx = window.FS || (window.Module && window.Module.FS);
      if(!FSx || typeof FSx.readFile !== "function") return "no emscripten FS";
      var out=[], NL=String.fromCharCode(10);
      ["/log.txt","/errors.txt","/traceback.txt","/game/errors.txt","/game/log.txt"].forEach(function(f){
        var size=-1;
        try{ size=FSx.stat(f).size; }catch(e){ return; }        // genuinely absent
        var txt=null, why="";
        var detail=function(e){
          if(!e) return "?";
          var bits=[];
          if(e.errno!==undefined) bits.push("errno="+e.errno);
          if(e.name) bits.push(e.name);
          if(e.message && e.message!=="FS error") bits.push(e.message);
          return bits.length?bits.join(" "):"FS error (no errno)";
        };
        try{ txt=FSx.readFile(f, {encoding:"utf8"}); }
        catch(e){ why="readFile: "+detail(e); }
        if((!txt || !txt.length) && typeof FSx.open==="function" && typeof FSx.read==="function"){
          // read the stream directly: readFile wraps open/read/close and can
          // fail in ways the primitives do not
          var st=null;
          try{
            st=FSx.open(f, "r");
            var want=Math.min(size, 4096), buf=new Uint8Array(want);
            var from=Math.max(0, size-want);
            FSx.read(st, buf, 0, want, from);
            var parts=[];
            for(var k=0;k<buf.length;k+=4096) parts.push(String.fromCharCode.apply(null, buf.subarray(k, k+4096)));
            txt=parts.join("");
            why+=(why?" · ":"")+"recovered via open/read";
          }catch(e3){ why+=(why?" · ":"")+"open/read: "+detail(e3); }
          finally{ if(st){ try{ FSx.close(st); }catch(e4){} } }
        }
        if(!txt || !txt.length){
          try{
            var b=FSx.readFile(f);                              // raw bytes attempt
            if(b && b.length){
              var chunks=[];
              for(var i=Math.max(0,b.length-2200);i<b.length;i+=4096){
                chunks.push(String.fromCharCode.apply(null, b.subarray(i, Math.min(i+4096,b.length))));
              }
              txt=chunks.join("");
            }
          }catch(e2){ why+=(why?" · ":"")+"bytes: "+detail(e2); }
        }
        if(txt && txt.length) out.push(f+" ("+size+"B on disk):"+NL+txt.slice(-2200));
        else out.push(f+" ("+size+"B on disk) UNREADABLE"+(why?" — "+why:""));
      });
      var head="";
      try{
        var mp=FSx.readFile("/main.py", {encoding:"utf8"}) || "";
        head=" · main.py["+(mp.indexOf("AbhishekStation")>=0 ? "SHIMMED" : "raw bootstrap")
          +" "+mp.length+"B: "+mp.slice(0, 48).split(NL)[0]+"]";
      }catch(e){ head=" · main.py[UNREADABLE]"; }
      var boot="";
      try{ FSx.stat("/_asp_bootstrap.py"); boot=" · _asp_bootstrap.py present"; }
      catch(e){ boot=" · _asp_bootstrap.py ABSENT"; }
      var listing="";
      try{
        var names=FSx.readdir("/").filter(function(n){ return n!=="." && n!==".."; });
        listing=" · root("+names.length+")["+names.join(",").slice(0,600)+"]";
      }catch(e){}
      return (out.length ? out.join(NL+"---"+NL) : "no log.txt/errors.txt written") + head + boot + listing;
    }catch(e){ return "renpyLogs threw: "+(e&&e.message); }
  }
  /** For each file Ren'Py reported missing, say WHERE it should have been: in
   *  the on-demand manifest, on the filesystem, or with a placeholder — plus what
   *  its directory actually contains. That distinguishes an asset the conversion
   *  dropped from one the game never shipped, which need opposite fixes. */
  var missingPaths = [];
  function renpyMissing(){
    try{
      var FSx = window.FS || (window.Module && window.Module.FS);
      if(!FSx || typeof FSx.readFile !== "function") return "no emscripten FS";
      var NL=String.fromCharCode(10), man="";
      try{ man = FSx.readFile("/game/renpyweb_remote_files.txt", {encoding:"utf8"}) || ""; }catch(e){}
      var lines = man ? man.split(NL).filter(function(x){ return x.length; }) : [];
      var out = ["manifest entries=" + Math.floor(lines.length / 2)];
      if(!missingPaths.length) out.push("no missing-file errors seen");
      for(var i=0;i<missingPaths.length;i++){
        var mp=missingPaths[i];
        var inMan = man.indexOf(NL + mp + NL) >= 0 || man.indexOf(mp + NL) === 0;
        var onFs=false, ph=false;
        try{ FSx.stat("/game/" + mp); onFs=true; }catch(e){}
        try{ FSx.stat("/_placeholders/" + mp); ph=true; }catch(e){}
        var cut=mp.lastIndexOf("/"), sib="";
        try{
          sib = FSx.readdir("/game/" + (cut>0 ? mp.slice(0,cut) : ""))
            .filter(function(n){ return n!=="." && n!==".."; }).join(",").slice(0,220);
        }catch(e){ sib="DIRECTORY ABSENT"; }
        out.push(mp + " -> manifest=" + inMan + " fs=" + onFs + " placeholder=" + ph + " siblings[" + sib + "]");
      }
      return out.join(" ;; ");
    }catch(e){ return "renpyMissing threw: " + (e && e.message); }
  }
  function stageDump(){
    try{
      var SM=window.SceneManager, root=SM && SM._scene;
      if(!root) return "SceneManager._scene absent";
      // MV nests the picture container AFTER the tilemap and every character
      // sprite, so a small cap truncates before the nodes that carry the big
      // character art. Compact each node hard instead of stopping early.
      var out=[], n=0, CAP=150;
      function px(v){ return (typeof v==="number") ? Math.round(v*100)/100 : "?"; }
      function walk(node, depth){
        if(!node || n>=CAP) return;
        n++;
        var t=node.texture, bt=t && t.baseTexture, src=bt && bt.source;
        var b=[depth+":"+((node.constructor && node.constructor.name)||"?")];
        if(node.visible===false) b.push("HIDE");
        if(node.alpha!==undefined && node.alpha!==1) b.push("a="+px(node.alpha));
        if(node.x||node.y) b.push("@"+px(node.x)+","+px(node.y));
        if(node.width) b.push(px(node.width)+"x"+px(node.height));
        if(node.scale && (node.scale.x!==1 || node.scale.y!==1)) b.push("sc"+px(node.scale.x)+"x"+px(node.scale.y));
        if(t){
          b.push("t"+px(t.width)+"x"+px(t.height));
          if(t.valid===false) b.push("INVALID");
          if(t.frame && (t.frame.x||t.frame.y)) b.push("f"+px(t.frame.x)+","+px(t.frame.y));
          if(src && src.videoWidth!==undefined)
            b.push("VIDEO:"+((src.currentSrc||src.src||"?").split("/").pop())+(src.paused?":PAUSED":":play"));
          else if(src && src.width!==undefined) b.push("src"+src.width+"x"+src.height);
          if(bt && bt.hasLoaded===false) b.push("UNLOADED");
        }
        if(node._mask||node.mask) b.push("MASK");
        out.push(b.join(" "));
        var k=node.children||[];
        for(var i=0;i<k.length && n<CAP;i++) walk(k[i], depth+1);
      }
      walk(root, 0);
      return out.join(" | ")+(n>=CAP?" | …CAPPED at "+CAP:"");
    }catch(e){ return "stageDump threw: "+(e&&e.message); }
  }
  /** $gameScreen._pictures is the game's own record of every picture it has
   *  shown — the authoritative answer to "where did it ask for this art, and
   *  how big". Pair each entry with its Sprite_Picture's real bitmap so a
   *  requested-vs-actual mismatch (wrong scale, zero opacity, 1x1 placeholder)
   *  reads straight off the line. */
  function pictureDump(){
    try{
      var G=window.$gameScreen;
      if(!G) return "$gameScreen absent";
      var pics=G._pictures||[], out=[];
      var sprites={};
      (function find(node){
        if(!node) return;
        if(node.constructor && node.constructor.name==="Sprite_Picture" && node._pictureId!==undefined)
          sprites[node._pictureId]=node;
        (node.children||[]).forEach(find);
      })(window.SceneManager && SceneManager._scene);
      for(var i=0;i<pics.length;i++){
        var p=pics[i]; if(!p) continue;
        var b=["#"+i+" "+(p._name||"(none)")];
        b.push("@"+Math.round(p._x)+","+Math.round(p._y));
        b.push("scale="+p._scaleX+"%x"+p._scaleY+"%");
        b.push("opacity="+Math.round(p._opacity));
        if(p._blendMode) b.push("blend="+p._blendMode);
        if(p._origin) b.push("origin="+p._origin);
        var sp=sprites[i];
        if(!sp) b.push("NO SPRITE");
        else {
          var bm=sp.bitmap;
          b.push("sprite@"+Math.round(sp.x)+","+Math.round(sp.y)
            +" "+Math.round(sp.width)+"x"+Math.round(sp.height)
            +(sp.visible===false?" HIDDEN":"")
            +" bmp="+(bm?(bm.width+"x"+bm.height+(bm.isReady&&!bm.isReady()?" NOTREADY":"")):"NONE"));
          if(bm && bm.width<=1) b.push("<< 1x1 PLACEHOLDER");
        }
        out.push(b.join(" "));
      }
      return out.length ? out.join(" | ") : "no pictures shown";
    }catch(e){ return "pictureDump threw: "+(e&&e.message); }
  }
  var stRun=false, stOut="";
  function stLog(k,v){ stOut+=(stOut?" · ":"")+k+"["+v+"]"; }
  function stSleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function stRaf(){ return new Promise(function(r){ requestAnimationFrame(function(){ r(); }); }); }
  function stMovies(n){
    var out=[], S=window.__rpgmFS;
    try{ if(S) S.forEach(function(k){ if(out.length<n && /^movies\\/.*\\.(webm|mp4)$/.test(k)) out.push(k); }); }catch(e){}
    return out;
  }
  async function selfTest(){
    if(stRun) return; stRun=true; stOut="";
    try{
      var list=stMovies(6);
      if(!list.length){ stLog("asset","no movies/ entry in the manifest"); stRun=false; post(); return; }
      stLog("asset", list[0]);

      var v=document.createElement("video");
      v.muted=true; v.defaultMuted=true; v.playsInline=true;
      v.setAttribute("muted",""); v.setAttribute("playsinline",""); v.preload="auto";
      var t0=Date.now(); v.src=list[0];
      await new Promise(function(res){ var d=false;
        v.addEventListener("loadeddata", function(){ d=true; res(); });
        v.addEventListener("error", function(){ d=true; res(); });
        setTimeout(function(){ if(!d) res(); }, 5000); });
      stLog("load", (v.readyState>=2?"ok":"FAILED")+" rs="+v.readyState+" "+v.videoWidth+"x"+v.videoHeight+" "+(Date.now()-t0)+"ms");
      if(!v.videoWidth){ stRun=false; post(); return; }

      var c=document.createElement("canvas"); c.width=64; c.height=64;
      var gl=c.getContext("webgl")||c.getContext("experimental-webgl");
      if(gl) stLog("uploadAtFrame0", texProbe(gl, v, v.videoWidth, v.videoHeight));

      try{ await v.play(); }catch(e){ stLog("play","REJECTED "+(e&&e.name)); }
      await stSleep(400);
      stLog("state", (v.paused?"paused":"playing")+" t="+v.currentTime.toFixed(2));
      if(gl) stLog("uploadWhilePlaying", texProbe(gl, v, v.videoWidth, v.videoHeight));

      v.pause(); await stRaf();
      if(gl) stLog("uploadWhilePaused", texProbe(gl, v, v.videoWidth, v.videoHeight));

      // THE mechanism question: does PIXI stop feeding the texture on pause?
      try{
        var P=window.PIXI;
        if(P && P.VideoBaseTexture){
          var bt=new P.VideoBaseTexture(v);
          try{ await v.play(); }catch(e){}
          await stSleep(300);
          var au1=!!bt._isAutoUpdating;
          v.pause(); await stSleep(250);
          var au2=!!bt._isAutoUpdating;
          stLog("PIXIautoUpdate","playing="+au1+" afterPause="+au2
            +(au1&&!au2?" >> STOPS ON PAUSE — mechanism CONFIRMED":" >> keeps updating — mechanism DEAD"));
          try{ bt.destroy(); }catch(e){}
        } else stLog("PIXIautoUpdate","VideoBaseTexture absent");
      }catch(e){ stLog("PIXIautoUpdate","threw "+(e&&e.message)); }

      // how many videos will iOS actually keep decoding at once?
      try{
        var vs=list.map(function(u){ var x=document.createElement("video");
          x.muted=true; x.playsInline=true; x.setAttribute("muted",""); x.setAttribute("playsinline","");
          x.src=u; return x; });
        for(var i=0;i<vs.length;i++){ try{ vs[i].play(); }catch(e){} }
        await stSleep(1500);
        var live=0; vs.forEach(function(x){ if(!x.paused && x.currentTime>0) live++; });
        stLog("concurrentDecode", live+" of "+vs.length+" still playing");
        vs.forEach(function(x){ try{ x.pause(); x.removeAttribute("src"); x.load(); }catch(e){} });
      }catch(e){ stLog("concurrentDecode","threw"); }

      try{ v.pause(); v.removeAttribute("src"); v.load(); }catch(e){}

      // Is the free tier gated? The plugin's own source settles it — no more
      // inferring a paywall from behaviour. The log already caught this plugin
      // alerting "works only in PRO version", so find that string and read what
      // the code does around it.
      try{
        var plugs=[], S2=window.__rpgmFS;
        if(S2) S2.forEach(function(k){
          if(k.indexOf("js/plugins/")===0 && k.slice(-3)===".js") plugs.push(k); });
        stLog("plugins", plugs.length+" files");
        var hits=[], looked=0;
        for(var pi=0; pi<plugs.length && hits.length<3 && looked<60; pi++){
          var txt="";
          try{ var rr=await fetch(plugs[pi]); txt=await rr.text(); }catch(e){ continue; }
          looked++;
          var low=txt.toLowerCase();
          var g=low.indexOf("pro version");
          var isVid = low.indexOf("vanim")>=0 || low.indexOf("videoanim")>=0
                   || low.indexOf("vplayer")>=0 || low.indexOf("createvideo")>=0;
          if(g<0 && !isVid) continue;
          var nm=plugs[pi].split("/").pop();
          var bit=nm+" "+Math.round(txt.length/1024)+"kB";
          if(g>=0){
            var a=Math.max(0,g-220), snip=txt.slice(a, g+220);
            bit+=" GATE{"+JSON.stringify(snip).slice(0,420)+"}";
          } else bit+=" (video plugin, no PRO string)";
          // does it hand back a 1x1 bitmap? that is what the stage showed
          var one=low.indexOf("bitmap(1,1)"); if(one<0) one=low.indexOf("bitmap(1, 1)");
          if(one>=0) bit+=" ONE_BY_ONE{"+JSON.stringify(txt.slice(Math.max(0,one-160), one+160)).slice(0,300)+"}";
          hits.push(bit);
        }
        stLog("pluginSrc", hits.length?hits.join(" ;;; "):"scanned "+looked+", no video plugin matched");
      }catch(e){ stLog("pluginSrc","threw "+(e&&e.message)); }
    }catch(e){ stLog("selftest","threw "+(e&&e.message)); }
    stRun=false; post();
  }
  function canvasInfo(){
    try{
      var all=document.querySelectorAll("canvas"), gc=(window.Graphics&&Graphics._canvas)||null, out=[];
      for(var i=0;i<all.length && i<6;i++){ var c=all[i];
        var st=getComputedStyle(c);
        out.push("#"+i+" "+c.width+"x"+c.height
          +(c===gc?" [ENGINE]":"")
          +(c.id?" id="+c.id:"")
          +" css="+Math.round(c.getBoundingClientRect().width)+"x"+Math.round(c.getBoundingClientRect().height)
          +" vis="+(st.display==="none"?"none":st.visibility)
          +" z="+(st.zIndex||"auto"));
      }
      return all.length+" canvas"+(all.length===1?"":"es")+": "+out.join(" | ")
        +" · Graphics="+((window.Graphics&&Graphics.width)||"?")+"x"+((window.Graphics&&Graphics.height)||"?")
        +" · dpr="+(window.devicePixelRatio||1);
    }catch(e){ return "canvasInfo threw: "+(e&&e.message); }
  }
  var rafHooked=false;
  function hookRaf(){
    try{
      if(rafHooked || typeof window.requestAnimationFrame !== "function") return;
      rafHooked=true;
      var orig=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=function(cb){
        return orig(function(t){
          var r;
          try{ r=cb(t); }
          finally{
            // after the engine has drawn, before the buffer is discarded
            if(wantFrame){ wantFrame=false; try{ grabAll(); }catch(e){} }
          }
          return r;
        });
      };
    }catch(e){}
  }
  function grabAll(){
    frames=[];
    // EVERY canvas, largest first — the engine's is the one that matters and it
    // is not necessarily the first in the DOM.
    try{
      var all=[].slice.call(document.querySelectorAll("canvas"));
      var gc=(window.Graphics&&Graphics._canvas)||null;
      all.sort(function(a,b){ return (b.width*b.height)-(a.width*a.height); });
      all.slice(0,3).forEach(function(c,i){
        frames.push(shot(c, c.width, c.height,
          "canvas "+c.width+"x"+c.height
            +((c===gc || c.id==="canvas") ? " [ENGINE — what you see]" : " [other #"+i+"]"), true));
      });
    }catch(e){}
    var live=vids.filter(function(v){ return v.videoWidth; }).slice(0,6);
    live.forEach(function(v){
      try{ frames.push(shot(v, v.videoWidth, v.videoHeight,
        "video "+((v.currentSrc||v.src||"").split("/").pop())
        +(v.paused?" PAUSED":" playing"))); }catch(e){}
    });
    post();
  }
  function vidState(){ try{
    return vids.filter(function(v){ return v.src||v.currentSrc; }).slice(0,8).map(function(v){
      var n=(v.currentSrc||v.src||"").split("/").pop();
      return n+" "+(v.paused?"PAUSED":"playing")+" up="+(vidUp[n]||0)+" t="+(v.currentTime||0).toFixed(1)
        +" rs="+v.readyState+" "+(v.videoWidth||0)+"x"+(v.videoHeight||0)
        +(v.muted?" muted":"")+(v.error?" ERR"+v.error.code:"");
    }).join("  |  ");
  }catch(e){ return "vid state failed"; } }
  var codecs="";
  try{ var _v=document.createElement("video");
    codecs="codecs: webm/vp8="+(_v.canPlayType('video/webm; codecs="vp8"')||"NO")
      +" · webm/vp9="+(_v.canPlayType('video/webm; codecs="vp9"')||"NO")
      +" · webm(any)="+(_v.canPlayType("video/webm")||"NO")
      +" · mp4/h264="+(_v.canPlayType('video/mp4; codecs="avc1.42E01E"')||"NO"); }catch(e){}
  var probed=false, probe="";
  function runProbe(){ if(probed) return;
    try{
      var keys=Object.keys(window).filter(function(k){ return /vanim/i.test(k); });
      if(!keys.length) return;                 // not defined yet — try again next tick
      probed=true;
      probe=keys.slice(0,4).map(function(k){ var v=window[k];
        return k+" = "+(typeof v==="function"
          ? String(v).replace(/\\s+/g," ").slice(0,600)
          : typeof v); }).join("   ||   ");
    }catch(e){ probed=true; probe="probe threw: "+(e&&e.message); }
  }
  function post(){ try{ parent.postMessage(snap(), "*"); }catch(e){} }
  window.addEventListener("message", function(ev){
    try{ if(ev.data && ev.data.type==="rpgm-selftest"){ selfTest(); return; } }catch(e){}
    try{ if(ev.data && ev.data.type==="rpgm-grab"){ wantFrame=true; hookRaf();
      // No renderer running (or none wrapped yet) — grab now rather than never.
      setTimeout(function(){ if(wantFrame){ wantFrame=false; grabAll(); } }, 700); } }catch(e){}
  }, false);
  var PY_NOISE = ["# cleanup", "# clear", "# destroy", "# zap", "# restore", "# refcnt", "# releasing"];
  function isPyNoise(m){
    var t = m.indexOf("console.error: ") === 0 ? m.slice(15) : m;
    if(t.indexOf("import ") === 0 && t.indexOf(" # ") > 0) return true;   // verbose import trace
    for(var i=0;i<PY_NOISE.length;i++) if(t.indexOf(PY_NOISE[i]) === 0) return true;
    return false;
  }
  var firstErrs = [];
  function addErr(msg, at){
    var m=String(msg).slice(0,280);
    if(isPyNoise(m)) return;                                        // interpreter tracing, not a fault
    if(firstErrs.length<8) firstErrs.push({msg:m, at:at||""});      // a boot failure's cause is the FIRST error
    errors.unshift({msg:m, at:at||""});
    if(errors.length>10) errors.pop();
    post();
  }
  window.addEventListener("unhandledrejection", function(ev){ var r=ev&&ev.reason; addErr("Unhandled: "+((r&&r.message)||r), ""); });
  // ONE capture-phase error listener catches BOTH script errors AND resource
  // (img/video/audio/script/link) load failures — the latter don't bubble, so
  // capture is required. This is the piece that was missing: RPG Maker loads
  // images with new Image(), whose failures never touched fetch/XHR.
  window.addEventListener("error", function(ev){ var t=ev.target;
    if(t&&t.tagName&&/^(IMG|VIDEO|AUDIO|SOURCE|SCRIPT|LINK)$/.test(t.tagName)){
      var raw=t.currentSrc||t.src||t.href||"";
      // An element with NO src resolves src to the document URL and still fires
      // error. RPG Maker clears bitmaps that way (Bitmap._clearImgInstance sets
      // src=""), so this is cleanup, not a failed asset — recording it buries
      // the real failures under phantoms named "index.html".
      if(!t.getAttribute||!t.getAttribute("src")){ if(!raw||raw===location.href) return; }
      logAct(rel(raw||("("+t.tagName+")")), false, t.tagName.toLowerCase()+" load failed"); return; }
    addErr(ev.message||(ev.error&&ev.error.message)||"Script error", (ev.filename?rel(ev.filename):"")+(ev.lineno?(":"+ev.lineno):"")); }, true);
  // wrap new Image()/new Audio() to catch DETACHED elements (not in the DOM, so
  // the window listener above never sees them) — the common RPG Maker path.
  function wrapMediaCtor(Native){ var W=function(a,b){ var el=new Native(a,b);
    el.addEventListener("load", function(){ logAct(rel(el.currentSrc||el.src), true); }, false);
    el.addEventListener("loadeddata", function(){ logAct(rel(el.currentSrc||el.src), true); }, false);
    el.addEventListener("error", function(){
      // src="" resolves to the DOCUMENT url and still fires error. RPG Maker
      // clears bitmaps that way after a decrypted image loads, so this is
      // cleanup — logging it buried the real failures under phantom
      // "index.html · load failed" lines.
      if(!el.getAttribute||!el.getAttribute("src")){ var r0=el.currentSrc||el.src||"";
        if(!r0||r0===location.href) return; }
      logAct(rel(el.currentSrc||el.src||"(media)"), false, "load failed"); }, false);
    return el; }; W.prototype=Native.prototype; return W; }
  // Video art (VPLAYER-style plugins) never touched the wrapped Image/Audio
  // constructors, and media faults report on their own channel — so the log was
  // silent by construction. Trace creation, readiness and failure here.
  try{ var CE=document.createElement.bind(document);
    document.createElement=function(t){ var el=CE.apply(null,arguments);
      try{ if(String(t).toLowerCase()==="video"){
        elog("video element created","engine video");
        try{ if(vids.length<12) vids.push(el); }catch(e3){}
        el.addEventListener("loadeddata",function(){ logAct(rel(el.currentSrc||el.src||"(video)"), true, "video ready"); },false);
        el.addEventListener("pause",function(){
          var n=0; (function push(){ refreshTexturesFor(el);
            if(++n<4) requestAnimationFrame(push); })(); }, false);
        el.addEventListener("error",function(){ var e=el.error;
          logAct(rel(el.currentSrc||el.src||"(video)"), false, "video error"+(e?" code "+e.code:"")); },false);
      } }catch(e2){}
      return el; }; }catch(e){}
  try{ window.Image=wrapMediaCtor(window.Image); }catch(e){}
  try{ if(window.Audio) window.Audio=wrapMediaCtor(window.Audio); }catch(e){}
  // ENGINE TRACE (a real debugger): wrap RPG Maker's subsystems so the feed
  // shows everything the engine DOES — event commands (Show Picture, Plugin
  // Command, Common Event…), data + image loads, audio, scene changes — not
  // just raw network. This is what reveals whether a "talk → cutscene" event
  // even runs and where it stops. Poll until the engine classes exist.
  // O(1) dedup keyed by the full message → the ring holds DISTINCT lines only,
  // each with a ×N count. A windowed scan misses floods whose paths rotate over
  // a set bigger than the window (this game's CG plugins existsSync-probe 80+
  // variants/frame); a Map handles any rotation size. Ring popped-oldest at 800.
  var actSeen=Object.create(null);
  function elog(path, reason){ reason=reason||""; var key=path+"\\u0001"+reason; var a=actSeen[key];
    if(a){ a.n=(a.n||1)+1; a.t=Date.now()-T0; return; }
    a={path:path, ok:true, reason:reason, n:1, t:Date.now()-T0}; actSeen[key]=a; activity.unshift(a);
    if(activity.length>800){ var old=activity.pop(); delete actSeen[old.path+"\\u0001"+old.reason]; } }
  // the NW.js shim (require/fs) calls this so our SCAFFOLDING shows in the trace
  try { window.__diaglog = function(p, r){ elog(String(p), r || "scaffold"); }; } catch(e){}
  var VERBOSE = false; // when on, EVERY event command is logged (not just the cutscene-relevant set)
  var CMD={101:"Show Text",102:"Show Choices",103:"Input Number",104:"Select Item",105:"Scroll Text",
    108:"Comment",111:"Conditional",112:"Loop",115:"Abort",117:"Common Event",119:"Jump Label",
    201:"Transfer",203:"Set Event Loc",204:"Scroll Map",205:"Move Route",211:"Transparency",
    212:"Show Animation",213:"Show Balloon",216:"Erase Event",221:"Fadeout",222:"Fadein",223:"Tint Screen",
    224:"Flash",225:"Shake",230:"Wait",231:"Show Picture",232:"Move Picture",233:"Rotate Picture",
    234:"Tint Picture",235:"Erase Picture",236:"Weather",241:"Play BGM",245:"Play ME",249:"Play SE",
    250:"Play SE",251:"Stop SE",261:"Play Movie",301:"Battle",302:"Shop",351:"Menu",352:"Save",
    355:"Script",356:"Plugin Cmd",357:"Plugin Cmd"};
  var INTERESTING={101:1,102:1,105:1,111:1,115:1,117:1,201:1,204:1,212:1,213:1,221:1,222:1,223:1,224:1,225:1,231:1,232:1,233:1,234:1,235:1,236:1,241:1,245:1,249:1,250:1,261:1,301:1,302:1,351:1,352:1,355:1,356:1,357:1};
  function briefCmd(c){ try{ var p=c.parameters||[];
    if(c.code===231||c.code===232||c.code===233||c.code===234) return "#"+p[0]+(p[1]?" "+p[1]:"");
    if(c.code===235) return "#"+p[0];
    if(c.code===117) return "commonEvent#"+p[0];
    if(c.code===356) return String(p[0]).slice(0,70);
    if(c.code===357) return (p[1]||"?")+" ["+(p[0]||"")+"]";
    if(c.code===355) return String(p[0]).slice(0,60);
    if(c.code===201) return "map#"+p[1];
    if(c.code===241||c.code===245||c.code===249||c.code===250) return (p[0]&&p[0].name)||"";
    if(c.code===111){ var t=p[0]; // decode the gate so a locked door shows WHAT it checks
      if(t===0) return "IF switch#"+p[1]+"=="+(p[2]===0?"ON":"OFF");
      if(t===1){ var op=["==",">=","<=",">","<","!="][p[4]]||"?"; return "IF var#"+p[1]+op+(p[2]===0?p[3]:"var#"+p[3]); }
      if(t===2) return "IF selfSw "+p[1]+"=="+(p[2]===0?"ON":"OFF");
      if(t===4) return "IF actor#"+p[1];
      if(t===6) return "IF char#"+p[1]+" dir "+p[2];
      if(t===7) return "IF gold"+(p[2]===0?">=":p[2]===1?"<=":"<")+p[1];
      if(t===8) return "IF hasItem#"+p[1];
      if(t===9) return "IF hasWeapon#"+p[1];
      if(t===10) return "IF hasArmor#"+p[1];
      if(t===11) return "IF button "+p[1];
      if(t===12) return "IF script: "+String(p[1]).slice(0,80);
      if(t===13) return "IF vehicle "+p[1];
      return "IF cond-type "+t; }
    return ""; }catch(e){ return ""; } }
  var hkTries=0, hkIv=setInterval(function(){
    var IM=window.ImageManager, GI=window.Game_Interpreter, DM=window.DataManager, AM=window.AudioManager, SM=window.SceneManager;
    if(IM && !IM.__diag){ IM.__diag=1;
      ["loadPicture","loadCharacter","loadFace","loadBattleback1","loadBattleback2","loadParallax","loadTileset","loadSystem",
       "loadBitmap","loadNormalBitmap","reserveBitmap","loadSvActor","loadEnemy","loadAnimation"].forEach(function(m){
        if(typeof IM[m]!=="function")return; var o=IM[m]; IM[m]=function(){ var a=Array.prototype.slice.call(arguments).filter(function(x){return typeof x==="string";}).join("/"); elog("img."+m+"("+a+")","engine img"); return o.apply(this,arguments); }; }); }
    var BM=window.Bitmap;
    if(BM && !BM.__diag){ BM.__diag=1;
      if(typeof BM.load==="function"){ var bl=BM.load; BM.load=function(url){ elog("Bitmap.load("+url+")","engine img"); return bl.apply(this,arguments); }; } }
    hookGL(); patchVideoTextures();
    var GR=window.Graphics;
    if(GR && !GR.__diagCap && typeof GR.render==="function"){ GR.__diagCap=1;
      var grf=GR.render; GR.render=function(){ var out=grf.apply(this,arguments);
        keyVideoSprites();   // every frame: a 20-frame gap showed as black
        hookRaf();
        hookEscapeText(); hookConvert();
        if(wantFrame){ wantFrame=false; try{ grabAll(); }catch(e){} }
        return out; }; }
    if(GI && GI.prototype && !GI.prototype.__diag){ GI.prototype.__diag=1;
      var ec=GI.prototype.executeCommand; GI.prototype.executeCommand=function(){ try{ var c=this._list&&this._list[this._index];
        if(c&&c.code===355){
          // a Script command spans 355 (first line) + 655 (continuation) — join
          // the whole thing so we see EXACTLY what JS the cutscene runs.
          var s="", j=this._index, L=this._list;
          while(j<L.length&&(L[j].code===355||L[j].code===655)){ s+=((L[j].parameters&&L[j].parameters[0])||"")+" "; j++; }
          s=s.replace(/\\s+/g," ").trim(); elog("cmd 355 Script: "+s.slice(0,500), "script");
        } else if(c&&(VERBOSE||INTERESTING[c.code])){ elog("cmd "+c.code+" "+(CMD[c.code]||"?")+(briefCmd(c)?": "+briefCmd(c):""), "event"); } }catch(e){} return ec.apply(this,arguments); }; }
    // catch errors thrown by Script (355) / Plugin (356/357) commands even if
    // the engine swallows them — that's the silent cutscene failure.
    if(GI && GI.prototype && !GI.prototype.__diag2){ GI.prototype.__diag2=1;
      [["command355","Script"],["command356","Plugin Cmd"],["command357","Plugin Cmd"]].forEach(function(pair){
        var name=pair[0]; if(typeof GI.prototype[name]!=="function")return; var o=GI.prototype[name];
        GI.prototype[name]=function(){ try{ return o.apply(this,arguments); }catch(err){ elog(pair[1]+" THREW: "+(err&&err.message||err), "error"); counts.fail++; recent.unshift({path:pair[1]+" threw", status:(err&&err.message)||String(err)}); post(); throw err; } }; }); }
    if(DM && !DM.__diag){ DM.__diag=1; if(typeof DM.loadDataFile==="function"){ var ld=DM.loadDataFile; DM.loadDataFile=function(name,src){ elog("data "+src,"data"); return ld.apply(this,arguments); }; } }
    if(AM && !AM.__diag){ AM.__diag=1; ["playBgm","playBgs","playMe","playSe"].forEach(function(m){ if(typeof AM[m]!=="function")return; var o=AM[m]; AM[m]=function(x){ elog("audio."+m+"("+((x&&x.name)||"")+")","audio"); return o.apply(this,arguments); }; }); }
    if(SM && !SM.__diag){ SM.__diag=1; ["push","goto","pop"].forEach(function(m){ if(typeof SM[m]!=="function")return; var o=SM[m]; SM[m]=function(s){ elog("scene."+m+" → "+((s&&s.name)||""),"scene"); return o.apply(this,arguments); }; }); }
    // MOVEMENT hooks → the dedicated xfer channel. reserveTransfer fires for
    // EVERY door/stairs/teleport (event cmd 201 routes through it); Game_Event.start
    // fires when the player actually triggers a map event. Together they tell us:
    // transfer + target-map load OK = door works; event started but NO transfer =
    // a conditional/locked door (by design); neither = the tile triggered nothing.
    var GP=window.Game_Player, GE=window.Game_Event;
    if(GP && GP.prototype && !GP.prototype.__diagX){ GP.prototype.__diagX=1;
      if(typeof GP.prototype.reserveTransfer==="function"){ var rt=GP.prototype.reserveTransfer;
        GP.prototype.reserveTransfer=function(mapId,x,y,d,fade){ try{ var from=(window.$gameMap&&$gameMap.mapId)?$gameMap.mapId():"?"; xlog("TRANSFER → map "+mapId+" @ ("+x+","+y+")  [from map "+from+" @ ("+this._x+","+this._y+")]"); }catch(e){} return rt.apply(this,arguments); }; } }
    if(GE && GE.prototype && !GE.prototype.__diagX){ GE.prototype.__diagX=1;
      if(typeof GE.prototype.start==="function"){ var est=GE.prototype.start;
        GE.prototype.start=function(){ try{ if(this.list&&this.list()){ var nm=""; try{ if(this.event&&this.event())nm=this.event().name||""; }catch(_){} xlog("event #"+this._eventId+(nm?" '"+nm+"'":"")+" started @ ("+this._x+","+this._y+")"); } }catch(e){} return est.apply(this,arguments); }; } }
    // THE engine's OWN error handlers — the internal catch that eats a cutscene
    // error and makes it "blink" without a window error. This is what surfaces
    // the real failure.
    if(SM && !SM.__diagErr){ SM.__diagErr=1;
      ["catchException","onError","catchLoadError","catchNormalError","catchUnknownError"].forEach(function(m){ if(typeof SM[m]!=="function")return; var o=SM[m]; SM[m]=function(e){ try{ var msg=(e&&(e.message||e.name))||String(e); addErr("SceneManager."+m+": "+String(msg).slice(0,240), (e&&e.stack)?String(e.stack).split("\\n").slice(1,3).join(" | ").slice(0,200):""); }catch(_){} return o.apply(this,arguments); }; }); }
    if(window.Graphics && !window.Graphics.__diag && typeof window.Graphics.printError==="function"){ window.Graphics.__diag=1; var pe=window.Graphics.printError; window.Graphics.printError=function(nm,ms){ addErr("Graphics.printError: "+nm+" — "+ms, ""); return pe.apply(this,arguments); }; }
    // plugin list + plugin-command dispatch (a Script calling a plugin command
    // that isn't registered is a prime silent-cutscene cause)
    var PM=window.PluginManager;
    if(PM && !PM.__diag){ PM.__diag=1;
      try{ if(window.$plugins&&window.$plugins.length) elog("plugins loaded: "+window.$plugins.map(function(p){return p.name+(p.status?"":"(OFF)");}).join(", "), "info"); }catch(e){}
      if(typeof PM.callCommand==="function"){ var cc=PM.callCommand; PM.callCommand=function(intp,plugin,cmd){ elog("pluginCmd "+plugin+" :: "+cmd, "event"); return cc.apply(this,arguments); }; } }
    // ── NaN-coordinate guard ────────────────────────────────────────────────
    // Some games/plugins call textColor(n) with a NaN colour index (a malformed
    // colour text-code or a plugin passing undefined). MV/MZ turn that into
    // getPixel(NaN,NaN) → getImageData(NaN,…), which throws FATALLY on iOS Safari
    // ("Value NaN is outside the range …") and kills the game the moment the
    // save/menu opens. It's a GAME fault — we can't fix its data, but we sanitise
    // the bad value at the engine/browser boundary so the game survives instead
    // of crashing. getImageData is the universal net (any caller); the textColor
    // patches keep the colour correct (NaN → 0 = the normal white) for MV & MZ.
    var CRC=window.CanvasRenderingContext2D;
    if(CRC && CRC.prototype && !CRC.prototype.__diagNaN){ CRC.prototype.__diagNaN=1;
      var _gid=CRC.prototype.getImageData;
      CRC.prototype.getImageData=function(x,y,w,h){
        if(isFinite(x)&&isFinite(y)&&isFinite(w)&&w&&isFinite(h)&&h) return _gid.apply(this,arguments);
        var X=isFinite(x)?x:0, Y=isFinite(y)?y:0, W=(isFinite(w)&&w)?w:1, H=(isFinite(h)&&h)?h:1;
        elog("guard: getImageData("+x+","+y+","+w+","+h+") clamped → ("+X+","+Y+","+W+","+H+") — game fed a NaN/0 coord; crash prevented","guard");
        return _gid.call(this,X,Y,W,H); }; }
    var WB=window.Window_Base;
    if(WB && WB.prototype && !WB.prototype.__diagNaN && typeof WB.prototype.textColor==="function"){ WB.prototype.__diagNaN=1;
      var _tc=WB.prototype.textColor;
      WB.prototype.textColor=function(n){ if(!isFinite(n)){ elog("guard: Window_Base.textColor("+n+") → 0 (NaN colour index — game/plugin fault)","guard"); n=0; } return _tc.call(this,n); }; }
    var CM=window.ColorManager;
    if(CM && !CM.__diagNaN && typeof CM.textColor==="function"){ CM.__diagNaN=1;
      var _cmt=CM.textColor;
      CM.textColor=function(n){ if(!isFinite(n)){ elog("guard: ColorManager.textColor("+n+") → 0 (NaN colour index — game/plugin fault)","guard"); n=0; } return _cmt.call(this,n); }; }
    if(++hkTries>3000) clearInterval(hkIv);
  }, 10);

  // full, shareable text dump of the whole trace (for the host's Copy button)
  function buildDump(){ var L=["=== RPGM DIAG DUMP ==="];
    var sc=(window.SceneManager&&SceneManager._scene&&SceneManager._scene.constructor)?SceneManager._scene.constructor.name:"";
    L.push("up "+Math.round((Date.now()-T0)/1000)+"s · scene "+sc+" · ok "+counts.ok+" / fail "+counts.fail);
    L.push("ua: "+navigator.userAgent);
    try{ if(window.$plugins) L.push("plugins: "+window.$plugins.map(function(p){return p.name+(p.status?"":"(OFF)");}).join(", ")); }catch(e){}
    try{ if(window.PluginManager&&PluginManager._commands) L.push("pluginCommands: "+Object.keys(PluginManager._commands).join(", ")); }catch(e){}
    if(d.firstErrors && d.firstErrors.length){ L.push(""); L.push("-- FIRST ERRORS (the cause, oldest first) --");
      d.firstErrors.forEach(function(x){ L.push("  ! "+x.msg+(x.at?" ("+x.at+")":"")); }); }
    if(errors.length){ L.push(""); L.push("-- ERRORS (most recent) --"); errors.forEach(function(x){ L.push("  ! "+x.msg+(x.at?" ("+x.at+")":"")); }); }
    if(recent.length){ L.push(""); L.push("-- FAILED LOADS --"); recent.forEach(function(r){ L.push("  x "+r.path+" · "+r.status); }); }
    L.push(""); L.push("-- ACTIVITY (oldest first, "+activity.length+" entries) --");
    activity.slice().reverse().forEach(function(a){ L.push("  "+(a.ok?"+":"x")+" ["+Math.round(a.t)+"ms] "+a.path+(a.reason?" · "+a.reason:"")); });
    return L.join("\\n");
  }
  // host commands: clear log · toggle verbose · dump full log to share
  window.addEventListener("message", function(e){ if(!e.data) return;
    if(e.data.__rpgmDiagClear){ activity.length=0; xfer.length=0; recent.length=0; errors.length=0; counts.ok=0; counts.fail=0; actSeen=Object.create(null); post(); }
    else if(e.data.__rpgmDiagVerbose!==undefined){ VERBOSE=!!e.data.__rpgmDiagVerbose; elog("verbose logging "+(VERBOSE?"ON":"OFF"), "info"); post(); }
    else if(e.data.__rpgmDiagDump){ try{ parent.postMessage({source:"rpgm-diag-dump", text: buildDump()}, "*"); }catch(_){} }
  });
  try { var XO=XMLHttpRequest.prototype.open, XS=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(m,u){ this.__du=u; return XO.apply(this,arguments); };
    XMLHttpRequest.prototype.send=function(){ var x=this,id=begin(x.__du);
      x.addEventListener("loadend", function(){ fin(id, x.status|0, x.status===0?"network":null); });
      return XS.apply(this,arguments); }; } catch(e){}
  try { var F=window.fetch; if(F) window.fetch=function(inp){ var u=(inp&&inp.url)||inp, id=begin(u);
    return F.apply(this,arguments).then(function(r){ fin(id, r.status|0); return r; }, function(err){ fin(id,0,"network"); throw err; }); }; } catch(e){}
  // console capture: many engines/plugins report the real failure ONLY to the
  // console. Surface warn/error always; console.log only in verbose (chatty).
  try { var cfmt=function(x){ try{ return (x&&x.stack)?String(x.stack):(x&&typeof x==="object"?JSON.stringify(x):String(x)); }catch(_){ return String(x); } };
    ["log","warn","error"].forEach(function(m){ var o=console[m]; if(typeof o!=="function") return;
      console[m]=function(){ try{ var s=Array.prototype.map.call(arguments,cfmt).join(" ").slice(0,300);
        try{
          var NEEDLE="Couldn't find file '";
          var at=s.indexOf(NEEDLE);
          if(at>=0){
            var rest=s.slice(at+NEEDLE.length);
            var end=rest.indexOf("'");
            var mp=end>0 ? rest.slice(0,end) : "";
            if(mp && missingPaths.indexOf(mp)<0 && missingPaths.length<6) missingPaths.push(mp);
          }
        }catch(_e){}
        if(m==="error") addErr("console.error: "+s,""); else if(m==="warn") elog("console.warn: "+s,"console"); else if(VERBOSE) elog("console: "+s,"console"); }catch(_){}
        return o.apply(this,arguments); }; }); } catch(e){}
  setInterval(post, 1000); post();
})();</` + `script>`;

// —— audio stub (injected into MV/MZ HTML of LITE installs only) ——
// A lite install skipped every audio file, and RPG Maker halts with a loading
// error when a BGM/SE it wants is missing. Stubbing AudioManager's play/load
// entry points means the engine never asks — the game runs, just silent.
const AUDIO_STUB = `<script>(function(){
  var t=setInterval(function(){
    var A=window.AudioManager;
    if(!A) return;
    clearInterval(t);
    var noop=function(){};
    ["playBgm","replayBgm","playBgs","replayBgs","playMe","playSe","playStaticSe",
     "loadStaticSe","checkErrors","checkWebAudioError"].forEach(function(k){
      if(typeof A[k]==="function") A[k]=noop;
    });
  },10);
  setTimeout(function(){clearInterval(t);},20000);
})();</` + `script>`;

// —— media probe (injected into all HTML routes) ——
// A cutscene that "opens for a moment then closes" is usually a VIDEO that
// failed to start: (a) blocked autoplay — synthetic pad presses carry no user
// activation, so video/audio .play() rejects NotAllowedError until a REAL tap
// lands inside the game frame; or (b) an unsupported codec — Safari can't
// decode the .webm movies RPG Maker ships. Both died silently. This wraps
// media playback, reports the exact reason to the host (which shows it and
// lets a real tap through), and auto-retries blocked media on that tap.
const MEDIA_SHIM = `<script>(function(){
  var blocked=[];
  function notify(kind,msg){
    try{ parent.postMessage({source:"rpgm-media",kind:kind,msg:String(msg||"").slice(0,200)},"*"); }catch(e){}
    // ALSO into the shared diagnostics feed: a play() rejection reported only to
    // the host UI is invisible in a shared log, which is where it is needed.
    try{ if(window.__diaglog) window.__diaglog("media."+kind+" "+String(msg||"").slice(0,120), kind==="unlocked"?"ok":"media"); }catch(e){}
  }
  function unlock(){ var list=blocked.splice(0);
    list.forEach(function(el){ try{ var p=el.play(); if(p&&p.catch)p.catch(function(){}); }catch(e){} });
    if(list.length) notify("unlocked",""); }
  document.addEventListener("pointerdown",unlock,true);
  document.addEventListener("touchend",unlock,true);
  document.addEventListener("keydown",unlock,true);
  try{ var P=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){ var el=this,r;
      // CUTSCENE FIX: gameplay here is driven by SYNTHETIC key input (the
      // on-screen controls), which grants no user activation — so an UNMUTED
      // <video> is autoplay-blocked and the cutscene "blinks and goes away".
      // A MUTED video autoplays without a gesture, so force video muted (the
      // player doesn't want cutscene audio anyway). Keeps the sound off, keeps
      // the scene ON.
      if(el.tagName==="VIDEO"){ try{ el.muted=true; el.defaultMuted=true; el.setAttribute("muted",""); el.playsInline=true; el.setAttribute("playsinline",""); }catch(e){} }
      try{ r=P.apply(this,arguments); }catch(e){ notify("error",e&&e.message); throw e; }
      if(r&&r.catch){ r=r.catch(function(err){
        // still blocked (rare, e.g. audio) → queue for the next real gesture
        if(err&&err.name==="NotAllowedError"){ try{el.muted=true;el.play();return;}catch(e){}
          if(blocked.indexOf(el)<0)blocked.push(el); notify("gesture",""); return; }
        notify("error",(err&&(err.name+": "+err.message))||err); }); }
      return r; }; }catch(e){}
  document.addEventListener("error",function(ev){ var t=ev.target;
    if(t&&(t.tagName==="VIDEO"||t.tagName==="AUDIO")){ var e=t.error;
      notify("error","media error"+(e?" code "+e.code:"")+" · "+((t.currentSrc||t.src||"").split("/").pop()||"")); } },true);
})();</` + `script>`;

// —— Ren'Py neutraliser (injected into Ren'Py web-build HTML) ——
// A Ren'Py web export ships its OWN service worker and registers it from
// index.html (register("./service-worker.js")). If it succeeded it would claim
// the /rpgm/renpy/<id>/ scope and shadow our OPFS serving on the next load, so
// we stub that one registration out. Everything else Ren'Py needs is plain
// relative fetches (renpy.wasm/renpy.data/game.zip) which our SW already serves,
// and it runs single-threaded (Asyncify) — no SharedArrayBuffer / COOP-COEP.
const RENPY_SHIM = `<script>(function(){
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      var reg = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function(u){
        if (String(u).indexOf("service-worker") >= 0) return Promise.reject(new Error("host-managed sw"));
        return reg.apply(null, arguments);
      };
    }
  } catch(e){}
})();</` + `script>`;

// —— generic web-game neutraliser (injected into web-build HTML) ——
// Godot/Unity/HTML5 web exports may register their OWN service worker (Godot's
// coi-serviceworker.js to fake cross-origin isolation, PWA workers, etc.). We
// already serve every file with COOP/COEP headers and own the /rpgm/web/ scope,
// so any game SW is unnecessary and would fight us — block all registrations.
const WEB_SHIM = `<script>(function(){
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      navigator.serviceWorker.register = function(){ return Promise.reject(new Error("host-managed sw")); };
    }
  } catch(e){}
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
// lite installs (audio skipped at import) carry a .rpgmlite marker
const liteCache = new Map();
async function gameIsLite(gameId) {
  if (liteCache.has(gameId)) return liteCache.get(gameId);
  let lite = false;
  try {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("rpgm");
    dir = await dir.getDirectoryHandle(gameId);
    await dir.getFileHandle(".rpgmlite");
    lite = true;
  } catch { lite = false; }
  liteCache.set(gameId, lite);
  return lite;
}

async function gameDirOf(gameId) {
  const r = await navigator.storage.getDirectory();
  return (await r.getDirectoryHandle("rpgm")).getDirectoryHandle(gameId);
}

// Manifest of every real game file, game-root-relative + NFKC-lowercased, so the
// injected fs.existsSync can answer truthfully (see NW_SHIM). Packed installs
// read it straight from the pack central directory; loose installs walk OPFS.
// Cached per game — it's built once, when the game HTML is served.
const manifestCache = new Map();
function manifestFor(gameId) {
  let mp = manifestCache.get(gameId);
  if (!mp) {
    mp = (async () => {
      const out = [];
      const pack = await packFor(gameId);
      if (pack) {
        let root = "";
        try { root = await gameRootPrefix(await gameDirOf(gameId), gameId); } catch { /* no dir */ }
        const rl = root.normalize("NFKC").toLowerCase();
        for (const k of pack.map.keys()) out.push(rl && k.startsWith(rl) ? k.slice(rl.length) : k);
        return out;
      }
      try {
        let base = await gameDirOf(gameId);
        const root = await gameRootPrefix(base, gameId);
        for (const seg of root.split("/").filter(Boolean)) base = await base.getDirectoryHandle(seg);
        await walkDir(base, "", out);
      } catch { /* nothing to list */ }
      return out;
    })();
    manifestCache.set(gameId, mp);
  }
  return mp;
}
async function walkDir(dir, prefix, out) {
  for await (const [name, h] of dir.entries()) {
    const rel = prefix + name;
    if (h.kind === "directory") await walkDir(h, rel + "/", out);
    else out.push(rel.normalize("NFKC").toLowerCase());
  }
}

// —— packed installs ————————————————————————————————————————————————————————
// New installs are ONE compact zip (.rpgmpack): files stay compressed on disk
// and are inflated lazily, per request, with the browser's native streaming
// DecompressionStream. The central directory is parsed once per game and kept
// as an NFKC-lowercased name map (which also gives case-insensitive lookups
// for free). Media entries were re-stored at import so Range works by offset.
// Ren'Py archives: the converter writes .rpaindex mapping each asset inside a
// .rpa to a byte range, so an archive-backed request is served straight out of
// the archive with nothing extracted and nothing resident. Archives are STORED
// in the pack (see needsRandomAccess in the import worker), so the range is
// plain offset math from the entry's data start.
const rpaCache = new Map(); // gameId -> Promise<{a:[], f:{}} | null>
function rpaIndexFor(gameId) {
  let p = rpaCache.get(gameId);
  if (!p) {
    p = (async () => {
      try {
        const f = await opfsFile(gameId, ".rpaindex");
        return f ? JSON.parse(await f.text()) : null;
      } catch { return null; }
    })();
    rpaCache.set(gameId, p);
  }
  return p;
}
/** Bytes for one asset held inside a .rpa, or null when it isn't there. */
async function rpaBytes(gameId, path) {
  const idx = await rpaIndexFor(gameId);
  if (!idx || !idx.f) return null;
  const rel = path.replace(/^game\//, "");
  const hit = idx.f[rel];
  if (!hit) return null;
  // Already root-relative and already includes game/ — see archives.push in
  // renpyConvert.ts. Prepending game/ here would look for game/game/x.rpa.
  const archive = idx.a[hit[0]];

  // resolve the archive itself: loose first, then the pack, same as any file
  let src = null, base = 0;
  const loose = await opfsFile(gameId, archive).catch(() => null);
  if (loose) { src = loose; base = 0; }
  else {
    const pack = await packFor(gameId);
    if (!pack) return null;
    let root = "";
    try { root = await gameRootPrefix(await gameDirOf(gameId), gameId); } catch { /* no dir */ }
    const ent = pack.map.get((root + archive).normalize("NFKC").toLowerCase());
    if (!ent) return null;
    if (ent.method !== 0) return null;   // deflated: no random access, needs a re-import
    src = pack.file;
    base = await packDataStart(pack.file, ent);
  }

  const parts = [];
  for (const seg of hit[1]) {
    const [off, len, pfx] = seg;
    if (pfx) parts.push(Uint8Array.from(atob(pfx), (c) => c.charCodeAt(0)));
    parts.push(await src.slice(base + off, base + off + len).arrayBuffer());
  }
  return new Blob(parts);
}
const packCache = new Map(); // gameId -> Promise<{file, map} | null>
function packFor(gameId) {
  let p = packCache.get(gameId);
  if (!p) {
    p = (async () => {
      try {
        const dir = await gameDirOf(gameId);
        const file = await (await dir.getFileHandle(".rpgmpack")).getFile();
        return { file, map: await parsePack(file) };
      } catch { return null; }
    })();
    packCache.set(gameId, p);
  }
  return p;
}
// Recover a filename that a legacy-encoded zip (no UTF-8 flag) had mis-decoded
// as latin1 at import ("主人公" → "¿ñk¬"). The mangling is byte→latin1, so
// recover the bytes and re-decode with the real CJK codec (strict — a wrong
// codec throws rather than guessing). Mirrors decodeLegacyName in zipcd.ts.
const RECODECS = ["utf-8", "shift_jis", "gbk", "euc-kr", "big5"];
function recodeName(name) {
  if (/^[\x00-\x7F]*$/.test(name)) return name;                  // pure ASCII
  for (const c of name) if (c.charCodeAt(0) > 0xFF) return name; // already real Unicode
  const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0) & 0xFF);
  for (const enc of RECODECS) {
    try { const s = new TextDecoder(enc, { fatal: true }).decode(bytes); if (s && s.indexOf("�") < 0) return s; } catch (e) { /* next */ }
  }
  return name;
}
async function parsePack(file) {
  const U32 = (d, o) => d.getUint32(o, true);
  const U16 = (d, o) => d.getUint16(o, true);
  const U64 = (d, o) => Number(d.getBigUint64(o, true));
  const tailLen = Math.min(file.size, 65557 + 20);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) { if (U32(tail, i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("bad pack");
  let count = U16(tail, eocd + 10), cdSize = U32(tail, eocd + 12), cdOff = U32(tail, eocd + 16);
  if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocd >= 20 && U32(tail, eocd - 20) === 0x07064b50) {
    const z64Off = U64(tail, eocd - 20 + 8);
    const z = new DataView(await file.slice(z64Off, z64Off + 56).arrayBuffer());
    if (U32(z, 0) === 0x06064b50) { count = U64(z, 32); cdSize = U64(z, 40); cdOff = U64(z, 48); }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const map = new Map();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (U32(cd, p) !== 0x02014b50) break;
    const flag = U16(cd, p + 8), method = U16(cd, p + 10);
    let csize = U32(cd, p + 20), usize = U32(cd, p + 24), lho = U32(cd, p + 42);
    const nlen = U16(cd, p + 28), elen = U16(cd, p + 30), clen = U16(cd, p + 32);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen);
    const name = flag & 0x800 ? dec.decode(nameBytes) : Array.from(nameBytes, (b) => String.fromCharCode(b)).join("");
    let ep = p + 46 + nlen;
    const eEnd = ep + elen;
    while (ep + 4 <= eEnd) {
      const eid = U16(cd, ep), esz = U16(cd, ep + 2);
      if (eid === 1) {
        let fp = ep + 4;
        if (usize === 0xffffffff) { usize = U64(cd, fp); fp += 8; }
        if (csize === 0xffffffff) { csize = U64(cd, fp); fp += 8; }
        if (lho === 0xffffffff) { lho = U64(cd, fp); fp += 8; }
      }
      ep += 4 + esz;
    }
    const ent = { method, csize, usize, lho, dataStart: -1 };
    map.set(name.normalize("NFKC").toLowerCase(), ent);
    // Packs built before the encoding fix stored CJK names mangled (latin1 of
    // Shift-JIS/GBK bytes) → the engine's Unicode request misses. The mangling
    // is reversible, so ALSO index the recovered name (same entry — the file
    // bytes are fine) → existing installs work without a re-import.
    const fixed = recodeName(name);
    if (fixed !== name) { const k = fixed.normalize("NFKC").toLowerCase(); if (!map.has(k)) map.set(k, ent); }
    p += 46 + nlen + elen + clen;
  }
  return map;
}
async function packDataStart(file, ent) {
  if (ent.dataStart >= 0) return ent.dataStart;
  const lh = new DataView(await file.slice(ent.lho, ent.lho + 30).arrayBuffer());
  ent.dataStart = ent.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  return ent.dataStart;
}
function packStream(file, ent, ds) {
  const slice = file.slice(ds, ds + ent.csize);
  return ent.method === 0 ? slice.stream() : slice.stream().pipeThrough(new DecompressionStream("deflate-raw"));
}
// Exact-match first; on a miss, retry that segment CASE-INSENSITIVELY (NFKC).
// Games authored on Windows (case-insensitive fs) routinely reference assets
// with the wrong case ("Actor1.png" vs "actor1.png") — on real Windows that
// loads fine, but OPFS is exact-match, so those images/cutscenes 404'd here.
// Exact hits stay fast; only the offending segment pays a directory scan.
async function entryCI(dir, name, wantDir) {
  try { return wantDir ? await dir.getDirectoryHandle(name) : await dir.getFileHandle(name); } catch { /* try CI */ }
  const lc = name.normalize("NFKC").toLowerCase();
  for await (const [n, h] of dir.entries()) {
    if (n.normalize("NFKC").toLowerCase() === lc && (wantDir ? h.kind === "directory" : h.kind === "file")) return h;
  }
  throw new Error("noent " + name);
}
async function opfsFile(gameId, path) {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("rpgm");
  dir = await dir.getDirectoryHandle(gameId);
  const root = await gameRootPrefix(dir, gameId);
  const parts = (root + path).split("/").filter(Boolean);
  const name = parts.pop();
  for (const p of parts) dir = await entryCI(dir, p, true);
  return (await entryCI(dir, name, false)).getFile();
}

const ISO_HEADERS = {
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Opener-Policy": "same-origin",
};

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const p = url.pathname;

  // Routes (all serve OPFS; the flags pick which HTML shims get injected):
  let m, isMvMz = false, isRenpy = false, isWeb = false, isEasy = false;
  if ((m = p.match(/^\/rpgm\/fs\/([^/]+)\/(.*)$/))) isMvMz = true;              // MV/MZ
  else if ((m = p.match(/^\/rpgm\/renpy\/([^/]+)\/(.*)$/))) isRenpy = true;      // Ren'Py web build
  else if ((m = p.match(/^\/rpgm\/web\/([^/]+)\/(.*)$/))) isWeb = true;          // Godot/Unity/HTML5/WebGL export
  else if ((m = p.match(/^\/rpgm\/easyrpg\/games\/([^/]+)\/(.*)$/))) isEasy = true; // EasyRPG (RTP fallback)
  else return; // engine statics + anything else → network

  const gameId = m[1];
  let path = decodeURIComponent(m[2] || "");
  if (path === "" || path.endsWith("/")) path += "index.html";

  e.respondWith((async () => {
    const type = mimeOf(path);
    const base = { "Content-Type": type, "Accept-Ranges": "bytes", ...ISO_HEADERS };

    // Resolve the content: LOOSE first (extracted installs, index.json,
    // markers), then the PACK (new installs — files inflate on demand).
    let file = null, packEnt = null, packFile = null;
    try { file = await opfsFile(gameId, path); } catch { /* try the pack */ }
    if (!file) {
      const pack = await packFor(gameId);
      if (pack) {
        let root = "";
        try { root = await gameRootPrefix(await gameDirOf(gameId), gameId); } catch { /* no dir */ }
        const ent = pack.map.get((root + path).normalize("NFKC").toLowerCase());
        if (ent) { packEnt = ent; packFile = pack.file; }
      }
    }
    // Ren'Py: the asset may live inside a .rpa the converter indexed.
    if (!file && !packEnt && isRenpy) {
      try {
        const blob = await rpaBytes(gameId, path);
        if (blob) return new Response(blob, { headers: { ...base, "Content-Length": String(blob.size) } });
      } catch { /* fall through to 404 */ }
    }

    if (!file && !packEnt) {
      // EasyRPG: fall back to the bundled RTP for assets the game itself omits.
      // LAZY: RTP files are only fetched when a game actually references one it
      // doesn't bundle. Each fetched asset is cached for replays/offline.
      if (isEasy) {
        const rtpUrl = "/rpgm/easyrpg/rtp/" + path;
        try {
          const cache = await caches.open("rpgm-rtp-v1");
          const hit = await cache.match(rtpUrl);
          if (hit) return hit;
          const res = await fetch(rtpUrl);
          if (res.ok) { cache.put(rtpUrl, res.clone()); return res; }
        } catch { /* offline + not cached */ }
      }
      return new Response("Not found: " + path, { status: 404, headers: ISO_HEADERS });
    }

    if ((isMvMz || isRenpy || isWeb) && type === "text/html") {
      // Inject shims into the game HTML before any of its scripts run. RPG Maker
      // gets the NW.js polyfill (require/process); Ren'Py and web builds get a
      // service-worker neutraliser so their bundled SW can't hijack our scope.
      // All get the diagnostics probe + per-game save isolation.
      const raw = file
        ? await file.text()
        : await new Response(packStream(packFile, packEnt, await packDataStart(packFile, packEnt))).text();
      const headShim = isRenpy ? RENPY_SHIM : isWeb ? WEB_SHIM : NW_SHIM;
      const audioStub = isMvMz && (await gameIsLite(gameId)) ? AUDIO_STUB : "";
      // RPG Maker: hand the fs shim the real file list so existsSync is truthful.
      let manifest = "";
      if (isMvMz) { try { manifest = "<script>window.__rpgmFS=new Set(" + JSON.stringify(await manifestFor(gameId)) + ")</script>"; } catch { /* existsSync stays false */ } }
      const shims = manifest + headShim + audioStub + DIAG_SHIM + MEDIA_SHIM + isolationShim(gameId);
      const html = /<head[^>]*>/i.test(raw)
        ? raw.replace(/<head[^>]*>/i, (m) => m + shims)
        : shims + raw;
      return new Response(html, { headers: base });
    }

    // Unity Brotli/Gzip WebGL builds ship pre-compressed assets (.wasm.br,
    // .data.gz, …) — serve with Content-Encoding so the browser decompresses.
    const cenc = path.endsWith(".br") ? "br" : path.endsWith(".gz") ? "gzip" : null;
    const encHeaders = cenc ? { "Content-Type": mimeOf(path.slice(0, -3)), "Content-Encoding": cenc, ...ISO_HEADERS } : null;

    const range = e.request.headers.get("range");
    const mr = range && range.match(/bytes=(\d*)-(\d*)/);

    if (file) {
      if (encHeaders) return new Response(file, { headers: encHeaders });
      if (mr) {
        const start = mr[1] ? parseInt(mr[1], 10) : 0;
        const end = mr[2] ? parseInt(mr[2], 10) : file.size - 1;
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { ...base, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) },
        });
      }
      return new Response(file, { headers: base });
    }

    // —— packed serving ——
    const ds = await packDataStart(packFile, packEnt);
    if (packEnt.method === 0) {
      if (encHeaders) return new Response(packFile.slice(ds, ds + packEnt.csize), { headers: encHeaders });
      if (mr) { // stored entries serve ranges by plain offset math
        const start = mr[1] ? parseInt(mr[1], 10) : 0;
        const end = mr[2] ? parseInt(mr[2], 10) : packEnt.usize - 1;
        return new Response(packFile.slice(ds + start, ds + end + 1), {
          status: 206,
          headers: { ...base, "Content-Range": `bytes ${start}-${end}/${packEnt.usize}`, "Content-Length": String(end - start + 1) },
        });
      }
      return new Response(packFile.slice(ds, ds + packEnt.csize), { headers: base });
    }
    // deflated entry: stream-inflate on demand (Range unsupported here — media
    // was re-stored at import precisely so it never lands in this branch)
    return new Response(packStream(packFile, packEnt, ds), { headers: encHeaders ?? base });
  })());
});
