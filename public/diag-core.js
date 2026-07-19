// Generic diagnostics tracer for self-hosted emulator pages that are NOT served
// through the RPG service worker's HTML-injection path (the PS2 Play! page at
// /play/, and the EasyRPG player at /rpgm/easyrpg/play.html). Include it with
//   <script src="/diag-core.js"></script>
// in the page <head>. It posts {source:"rpgm-diag"} snapshots to the parent
// window every second — the SAME shape the RPG shim uses — so the shared
// DiagOverlay panel consumes it with no changes, and "share log" just works.
//
// This is the engine-AGNOSTIC subset of DIAG_SHIM in rpgm-sw.js (no RPG Maker
// interpreter/scene/plugin hooks, no fs manifest). ponytail: the two are kept
// deliberately parallel rather than shared — the SW one is an injected string
// with RPGM-specific extras and a manifest; if you fix a capture bug in one,
// mirror it here. WASM emulators (PS2/EasyRPG) only need this generic layer:
// script errors, failed resource/network loads, and — crucially — console
// output (emscripten reports aborts/RuntimeErrors only to the console).
(function () {
  if (window.__diagCore) return; // once
  window.__diagCore = 1;
  var T0 = Date.now(), seq = 0, pending = {}, recent = [], errors = [], counts = { ok: 0, fail: 0 }, activity = [], VERBOSE = false;

  function rel(u) {
    try {
      var pp = new URL(u, location.href).pathname;
      var i = pp.indexOf("/games/"); if (i >= 0) return pp.slice(i + 7).split("/").slice(1).join("/") || pp;
      var j = pp.indexOf("/play/"); if (j >= 0) return pp.slice(j + 6);
      return pp;
    } catch (e) { return String(u); }
  }
  function logAct(path, ok, reason) {
    activity.unshift({ path: path, ok: !!ok, reason: reason || "", t: Date.now() - T0 }); if (activity.length > 200) activity.pop();
    if (ok) { counts.ok++; } else { counts.fail++; recent.unshift({ path: path, status: reason || "failed" }); if (recent.length > 20) recent.pop(); post(); }
  }
  function elog(path, reason) { activity.unshift({ path: path, ok: true, reason: reason || "", t: Date.now() - T0 }); if (activity.length > 200) activity.pop(); }
  function addErr(msg, at) { errors.unshift({ msg: String(msg).slice(0, 280), at: at || "" }); if (errors.length > 10) errors.pop(); post(); }
  function begin(u) { var id = ++seq; pending[id] = { path: rel(u), t0: Date.now() }; return id; }
  function fin(id, status, emsg) { var e = pending[id]; if (!e) return; delete pending[id]; var ok = status >= 200 && status < 400; logAct(e.path, ok, ok ? "" : (emsg || status || "error")); }

  function snap() {
    var now = Date.now(), pend = [];
    for (var k in pending) { pend.push({ path: pending[k].path, age: now - pending[k].t0 }); }
    pend.sort(function (a, b) { return b.age - a.age; });
    var canvas = !!document.querySelector("canvas");
    return {
      source: "rpgm-diag", up: now - T0, scene: "", spinner: false,
      booted: canvas, canvas: canvas,
      pending: pend.slice(0, 12), recent: recent.slice(0, 20), counts: counts, errors: errors.slice(0, 10), activity: activity.slice(0, 180)
    };
  }
  function post() { try { parent.postMessage(snap(), "*"); } catch (e) {} }

  window.addEventListener("unhandledrejection", function (ev) { var r = ev && ev.reason; addErr("Unhandled: " + ((r && r.message) || r), ""); });
  // capture phase catches resource (img/audio/script/wasm) load failures too.
  window.addEventListener("error", function (ev) {
    var t = ev.target;
    if (t && t.tagName && /^(IMG|VIDEO|AUDIO|SOURCE|SCRIPT|LINK)$/.test(t.tagName)) {
      logAct(rel(t.currentSrc || t.src || t.href || ("(" + t.tagName + ")")), false, t.tagName.toLowerCase() + " load failed"); return;
    }
    addErr(ev.message || (ev.error && ev.error.message) || "Script error", (ev.filename ? rel(ev.filename) : "") + (ev.lineno ? (":" + ev.lineno) : ""));
  }, true);

  // console capture — WASM/emscripten reports aborts & RuntimeErrors only here.
  try {
    var cfmt = function (x) { try { return (x && x.stack) ? String(x.stack) : (x && typeof x === "object" ? JSON.stringify(x) : String(x)); } catch (_) { return String(x); } };
    ["log", "warn", "error"].forEach(function (m) {
      var o = console[m]; if (typeof o !== "function") return;
      console[m] = function () {
        try {
          var s = Array.prototype.map.call(arguments, cfmt).join(" ").slice(0, 300);
          if (m === "error") addErr("console.error: " + s, ""); else if (m === "warn") elog("console.warn: " + s, "console"); else if (VERBOSE) elog("console: " + s, "console");
        } catch (_) {}
        return o.apply(this, arguments);
      };
    });
  } catch (e) {}

  // network: XHR + fetch (ROM/asset loads, save syncs).
  try {
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__du = u; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () { var x = this, id = begin(x.__du); x.addEventListener("loadend", function () { fin(id, x.status | 0, x.status === 0 ? "network" : null); }); return XS.apply(this, arguments); };
  } catch (e) {}
  try { var F = window.fetch; if (F) window.fetch = function (inp) { var u = (inp && inp.url) || inp, id = begin(u); return F.apply(this, arguments).then(function (r) { fin(id, r.status | 0); return r; }, function (err) { fin(id, 0, "network"); throw err; }); }; } catch (e) {}

  // parent commands (from DiagOverlay): clear + verbose toggle.
  window.addEventListener("message", function (e) {
    if (!e.data) return;
    if (e.data.__rpgmDiagClear) { pending = {}; recent = []; errors = []; counts = { ok: 0, fail: 0 }; activity = []; seq = 0; post(); }
    else if (e.data.__rpgmDiagVerbose !== undefined) { VERBOSE = !!e.data.__rpgmDiagVerbose; elog("verbose logging " + (VERBOSE ? "ON" : "OFF"), "info"); post(); }
  });

  setInterval(post, 1000); post();
})();
