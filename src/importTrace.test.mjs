// The trace exists so an import that kills the tab still leaves evidence, so the
// behaviour worth pinning is: it survives in storage, it stays bounded, and it
// keeps its header line when it has to evict.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { traceStart, trace, traceError, traceText, traceClear } = await import("./importTrace.ts");

traceStart("game.zip · 12345 bytes");
trace("detect", { engine: "renpydesktop", files: 8123 });
assert.match(traceText(), /=== IMPORT TRACE ===/);
assert.match(traceText(), /game\.zip · 12345 bytes/);
assert.match(traceText(), /engine=renpydesktop files=8123/, "numbers must stay greppable");

// flushed as it goes, not at the end — a crashed import must still leave this
assert.ok((store.get("asp.importtrace") ?? "").includes("renpydesktop"),
  "each line must be persisted when written, not buffered to the end");

traceError("conversion", new Error("boom"));
assert.match(traceText(), /FAILED conversion · error=boom/);

// undefined fields are noise, not data
trace("plan", { a: 1, b: undefined });
assert.match(traceText(), /plan · a=1$/m);

// bounded, and the header survives eviction
for (let i = 0; i < 900; i++) trace(`line ${i}`, { i });
const out = traceText();
assert.ok(out.startsWith("=== IMPORT TRACE ==="), "header must survive eviction");
assert.ok(out.length <= 60_000, `must stay bounded, got ${out.length}`);
assert.ok(out.includes("line 899"), "the newest line must be kept");
assert.ok(!out.includes("line 0 "), "the oldest lines are the ones dropped");

traceClear();
assert.equal(traceText(), "");
assert.equal(store.get("asp.importtrace"), undefined);

console.log("import trace ok · persists per line, bounded, header survives");
