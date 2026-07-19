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
  if (e.data && e.data.type === "rpgm-root-bust") { rootCache.delete(e.data.id); liteCache.delete(e.data.id); packCache.delete(e.data.id); }
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
  // fs: sync reads CAN'T work (sync XHR bypasses service workers in Chromium,
  // and there's no SharedArrayBuffer bridge without page-level isolation), so
  // existsSync stays FALSE — well-written NW.js plugins existsSync-guard their
  // fs path and fall back to the engine's XHR loader, which our SW serves.
  // ASYNC reads are REAL: async fetch goes through the SW, so plugins loading
  // cutscene/plugin data via fs.readFile(cb) or fs.promises get actual bytes.
  var fsUrl=function(p){ p=String(p).replace(/^[A-Za-z]:[\\\\/]/,"").replace(/\\\\/g,"/").replace(/^\\.\\//,"").replace(/^\\/+/,"");
    try{ return new URL(p, location.href).href; }catch(e){ return null; } };
  var fsRead=function(p, enc){ var u=fsUrl(p);
    return fetch(u).then(function(r){ if(!r.ok) throw new Error("ENOENT: "+p);
      return enc ? r.text() : r.arrayBuffer().then(function(ab){
        var a=new Uint8Array(ab);
        a.toString=function(){ try{ return new TextDecoder().decode(new Uint8Array(this)); }catch(e){ return ""; } };
        return a; }); }); };
  var dl=function(p,r){ try{ if(window.__diaglog) window.__diaglog(p,r); }catch(e){} };
  var fs={existsSync:function(p){dl("fs.existsSync "+p,"scaffold →false");return false;},readFileSync:function(p){dl("fs.readFileSync "+p,"scaffold sync-unavailable");throw new Error("fs sync reads unavailable in browser: "+p);},
    writeFileSync:noop,appendFileSync:noop,mkdirSync:noop,rmdirSync:noop,unlinkSync:noop,renameSync:noop,copyFileSync:noop,
    readdirSync:function(){return [];},statSync:function(){return{isDirectory:ret(false),isFile:ret(false),size:0};},
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
const DIAG_SHIM = `<script>(function(){
  var T0=Date.now(), seq=0, pending={}, recent=[], errors=[], counts={ok:0,fail:0}, activity=[];
  function rel(u){ try{ var pp=new URL(u, location.href).pathname; var i=pp.indexOf("/rpgm/");
    if(i<0) return pp; var parts=pp.slice(i+6).split("/");
    if(parts[0]==="fs") return parts.slice(2).join("/");
    if(parts[0]==="easyrpg"&&parts[1]==="games") return parts.slice(3).join("/");
    return pp; }catch(e){ return String(u); } }
  // every asset load (image/video/audio/xhr/fetch) funnels through here — this
  // is what makes a failed CUTSCENE asset visible. Keeps a rolling activity log
  // so you can see exactly what the game just tried to load when a scene broke.
  function logAct(path, ok, reason){
    activity.unshift({path:path, ok:!!ok, reason:reason||"", t:Date.now()-T0}); if(activity.length>30) activity.pop();
    if(ok){ counts.ok++; } else { counts.fail++; recent.unshift({path:path, status:reason||"failed"}); if(recent.length>12) recent.pop(); post(); }
  }
  function begin(u){ var id=++seq; pending[id]={path:rel(u), t0:Date.now()}; return id; }
  function fin(id, status, emsg){ var e=pending[id]; if(!e) return; delete pending[id];
    var ok=status>=200&&status<400; logAct(e.path, ok, ok?"":(emsg||status||"error")); }
  function snap(){ var now=Date.now(), pend=[];
    for(var k in pending){ pend.push({path:pending[k].path, age: now-pending[k].t0}); }
    pend.sort(function(a,b){return b.age-a.age;});
    var sp=document.getElementById("loadingSpinner"), spinner=!!(sp&&getComputedStyle(sp).display!=="none");
    var scene=(window.SceneManager&&SceneManager._scene&&SceneManager._scene.constructor)?SceneManager._scene.constructor.name:"";
    var canvas=!!document.querySelector("canvas");
    return {source:"rpgm-diag", up:now-T0, scene:scene, spinner:spinner,
      booted:!!(canvas&&!spinner&&(scene?scene!=="Scene_Boot":true)), canvas:canvas,
      pending:pend.slice(0,12), recent:recent.slice(0,12), counts:counts, errors:errors.slice(0,6), activity:activity.slice(0,30)}; }
  function post(){ try{ parent.postMessage(snap(), "*"); }catch(e){} }
  function addErr(msg, at){ errors.unshift({msg:String(msg).slice(0,280), at:at||""}); if(errors.length>10) errors.pop(); post(); }
  window.addEventListener("unhandledrejection", function(ev){ var r=ev&&ev.reason; addErr("Unhandled: "+((r&&r.message)||r), ""); });
  // ONE capture-phase error listener catches BOTH script errors AND resource
  // (img/video/audio/script/link) load failures — the latter don't bubble, so
  // capture is required. This is the piece that was missing: RPG Maker loads
  // images with new Image(), whose failures never touched fetch/XHR.
  window.addEventListener("error", function(ev){ var t=ev.target;
    if(t&&t.tagName&&/^(IMG|VIDEO|AUDIO|SOURCE|SCRIPT|LINK)$/.test(t.tagName)){
      logAct(rel(t.currentSrc||t.src||t.href||("("+t.tagName+")")), false, t.tagName.toLowerCase()+" load failed"); return; }
    addErr(ev.message||(ev.error&&ev.error.message)||"Script error", (ev.filename?rel(ev.filename):"")+(ev.lineno?(":"+ev.lineno):"")); }, true);
  // wrap new Image()/new Audio() to catch DETACHED elements (not in the DOM, so
  // the window listener above never sees them) — the common RPG Maker path.
  function wrapMediaCtor(Native){ var W=function(a,b){ var el=new Native(a,b);
    el.addEventListener("load", function(){ logAct(rel(el.currentSrc||el.src), true); }, false);
    el.addEventListener("loadeddata", function(){ logAct(rel(el.currentSrc||el.src), true); }, false);
    el.addEventListener("error", function(){ logAct(rel(el.currentSrc||el.src||"(media)"), false, "load failed"); }, false);
    return el; }; W.prototype=Native.prototype; return W; }
  try{ window.Image=wrapMediaCtor(window.Image); }catch(e){}
  try{ if(window.Audio) window.Audio=wrapMediaCtor(window.Audio); }catch(e){}
  // ENGINE TRACE (a real debugger): wrap RPG Maker's subsystems so the feed
  // shows everything the engine DOES — event commands (Show Picture, Plugin
  // Command, Common Event…), data + image loads, audio, scene changes — not
  // just raw network. This is what reveals whether a "talk → cutscene" event
  // even runs and where it stops. Poll until the engine classes exist.
  function elog(path, reason){ activity.unshift({path:path, ok:true, reason:reason||"", t:Date.now()-T0}); if(activity.length>250) activity.pop(); }
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
  var INTERESTING={101:1,102:1,105:1,115:1,117:1,201:1,204:1,212:1,213:1,221:1,222:1,223:1,224:1,225:1,231:1,232:1,233:1,234:1,235:1,236:1,241:1,245:1,249:1,250:1,261:1,301:1,302:1,351:1,352:1,355:1,356:1,357:1};
  function briefCmd(c){ try{ var p=c.parameters||[];
    if(c.code===231||c.code===232||c.code===233||c.code===234) return "#"+p[0]+(p[1]?" "+p[1]:"");
    if(c.code===235) return "#"+p[0];
    if(c.code===117) return "commonEvent#"+p[0];
    if(c.code===356) return String(p[0]).slice(0,70);
    if(c.code===357) return (p[1]||"?")+" ["+(p[0]||"")+"]";
    if(c.code===355) return String(p[0]).slice(0,60);
    if(c.code===201) return "map#"+p[1];
    if(c.code===241||c.code===245||c.code===249||c.code===250) return (p[0]&&p[0].name)||"";
    if(c.code===111) return "branch";
    return ""; }catch(e){ return ""; } }
  var hkTries=0, hkIv=setInterval(function(){
    var IM=window.ImageManager, GI=window.Game_Interpreter, DM=window.DataManager, AM=window.AudioManager, SM=window.SceneManager;
    if(IM && !IM.__diag){ IM.__diag=1;
      ["loadPicture","loadCharacter","loadFace","loadBattleback1","loadBattleback2","loadParallax","loadTileset","loadSystem"].forEach(function(m){
        if(typeof IM[m]!=="function")return; var o=IM[m]; IM[m]=function(){ var a=Array.prototype.slice.call(arguments).filter(function(x){return typeof x==="string";}).join("/"); elog("img."+m+"("+a+")","engine img"); return o.apply(this,arguments); }; }); }
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
    if(++hkTries>3000) clearInterval(hkIv);
  }, 10);

  // full, shareable text dump of the whole trace (for the host's Copy button)
  function buildDump(){ var L=["=== RPGM DIAG DUMP ==="];
    var sc=(window.SceneManager&&SceneManager._scene&&SceneManager._scene.constructor)?SceneManager._scene.constructor.name:"";
    L.push("up "+Math.round((Date.now()-T0)/1000)+"s · scene "+sc+" · ok "+counts.ok+" / fail "+counts.fail);
    L.push("ua: "+navigator.userAgent);
    try{ if(window.$plugins) L.push("plugins: "+window.$plugins.map(function(p){return p.name+(p.status?"":"(OFF)");}).join(", ")); }catch(e){}
    try{ if(window.PluginManager&&PluginManager._commands) L.push("pluginCommands: "+Object.keys(PluginManager._commands).join(", ")); }catch(e){}
    if(errors.length){ L.push(""); L.push("-- ERRORS --"); errors.forEach(function(x){ L.push("  ! "+x.msg+(x.at?" ("+x.at+")":"")); }); }
    if(recent.length){ L.push(""); L.push("-- FAILED LOADS --"); recent.forEach(function(r){ L.push("  x "+r.path+" · "+r.status); }); }
    L.push(""); L.push("-- ACTIVITY (oldest first, "+activity.length+" entries) --");
    activity.slice().reverse().forEach(function(a){ L.push("  "+(a.ok?"+":"x")+" ["+Math.round(a.t)+"ms] "+a.path+(a.reason?" · "+a.reason:"")); });
    return L.join("\\n");
  }
  // host commands: clear log · toggle verbose · dump full log to share
  window.addEventListener("message", function(e){ if(!e.data) return;
    if(e.data.__rpgmDiagClear){ activity.length=0; recent.length=0; errors.length=0; counts.ok=0; counts.fail=0; post(); }
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
  function notify(kind,msg){ try{ parent.postMessage({source:"rpgm-media",kind:kind,msg:String(msg||"").slice(0,200)},"*"); }catch(e){} }
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

// —— packed installs ————————————————————————————————————————————————————————
// New installs are ONE compact zip (.rpgmpack): files stay compressed on disk
// and are inflated lazily, per request, with the browser's native streaming
// DecompressionStream. The central directory is parsed once per game and kept
// as an NFKC-lowercased name map (which also gives case-insensitive lookups
// for free). Media entries were re-stored at import so Range works by offset.
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
    map.set(name.normalize("NFKC").toLowerCase(), { method, csize, usize, lho, dataStart: -1 });
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
      const shims = headShim + audioStub + DIAG_SHIM + MEDIA_SHIM + isolationShim(gameId);
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
