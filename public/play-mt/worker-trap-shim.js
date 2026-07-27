// Runs INSIDE each emulator pthread worker: index.html points
// Module.mainScriptUrlOrBlob here, so emscripten spawns its workers from this
// module instead of Play.js directly.
//
// Why it exists: a wasm trap ("RuntimeError: unreachable") happens on the VM
// worker, and the ErrorEvent that crosses to the page carries error = null —
// per spec the Error object never leaves the worker's realm, so the page can
// only ever report the bare message. Three crash reports in a row arrived
// nameless that way. The stack exists HERE, in the worker's own error event,
// so it is captured here and rebroadcast where the diagnostics panel listens.
//
// The listener must not swallow the event: emscripten's own error handling
// still needs to see it, so no preventDefault.
self.addEventListener("error", (e) => {
  try {
    new BroadcastChannel("play-trap").postMessage(
      e.error && e.error.stack ? String(e.error.stack) : String(e.message || e),
    );
  } catch (_) { /* reporting must never break the worker */ }
});
self.addEventListener("unhandledrejection", (e) => {
  try {
    const r = e.reason;
    new BroadcastChannel("play-trap").postMessage(
      r && r.stack ? String(r.stack) : "unhandledrejection: " + String(r),
    );
  } catch (_) { /* ditto */ }
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
