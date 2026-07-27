// Runs INSIDE each emulator pthread worker: index.html points
// Module.mainScriptUrlOrBlob here, so emscripten spawns its workers from this
// module instead of Play.js directly.
//
// Why it exists: a wasm trap ("RuntimeError: unreachable") happens on the VM
// worker, and the ErrorEvent that crosses to the page carries error = null —
// per spec the Error object never leaves the worker's realm, so the page can
// only ever report the bare message. Three crash reports in a row arrived
// nameless that way. The stack exists HERE, in the worker's own error event.
//
// The engine ships STRIPPED (no wasm name section) so every boot is 575KB
// lighter. A stack still carries the function INDEX — "wasm-function[4874]" —
// so the names live in Play.js.symbols and are fetched ONLY when something
// actually traps. Zero cost until it matters.
//
// The symbol map is index-keyed and indices shift between builds, so it is only
// valid for the Play.wasm deployed alongside it. Both come out of one build.

let symbols = null; // index -> name, loaded on first trap

async function loadSymbols() {
  if (symbols) return symbols;
  symbols = new Map();
  try {
    // resolve against THIS module, not the worker base URL — a worker
    // created from a blob has a blob: base and a bare "./" would miss
    const url = new URL("./Play.js.symbols", import.meta.url);
    const text = await (await fetch(url)).text();
    for (const line of text.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) {
        // emscripten escapes punctuation as \28 style hex; decode for readability
        const name = line.slice(i + 1).replace(/\\([0-9a-fA-F]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16)));
        symbols.set(line.slice(0, i), name);
      }
    }
  } catch (_) { /* a missing map must not hide the trap itself */ }
  return symbols;
}

async function report(stack) {
  let out = String(stack);
  try {
    if (/wasm-function\[\d+\]/.test(out)) {
      const map = await loadSymbols();
      out = out.replace(/wasm-function\[(\d+)\]/g,
        (whole, idx) => (map.get(idx) ? `${whole} ${map.get(idx)}` : whole));
    }
  } catch (_) { /* ditto */ }
  try { new BroadcastChannel("play-trap").postMessage(out); } catch (_) {}
}

// No preventDefault: emscripten's own error handling still needs this event.
self.addEventListener("error", (e) => {
  report(e.error && e.error.stack ? e.error.stack : String(e.message || e));
});
self.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  report(r && r.stack ? r.stack : "unhandledrejection: " + String(r));
});

// Play.js checks self.name.startsWith("em-pthread") and bootstraps itself, so
// importing it makes this worker behave as if it had loaded Play.js directly.
//
// STATIC import, deliberately: a dynamic `await import()` leaves an async gap
// during which emscripten's load handshake message can arrive with no handler
// — the pthread pool hangs and the module never initialises (measured: boot
// dies with mod=null). A static import evaluates Play.js as part of this
// module's graph, synchronously from the handshake's point of view; it merely
// hoists above the listeners, which only means a failure during Play.js's own
// initial evaluation goes unreported — gameplay traps, the ones that matter,
// happen long after both are in place.
import "./Play.js";
