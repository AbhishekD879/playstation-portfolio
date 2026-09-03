// Internal-resolution choice. The URL must win over storage (so a bug report can
// pin a value), garbage must fall back to 1×, and anything above 3× must be
// refused here — 4× of 640×448 is 2560×1792 per framebuffer, which hangs a phone.
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { search: "" };

const { readRes, writeRes } = await import("./engineChoice.ts");

assert.equal(readRes(""), 1, "default is native 1×");
assert.equal(readRes("?res=2"), 2);
assert.equal(readRes("?res=3"), 3);
assert.equal(readRes("?res=4"), 1, "above 3× is refused, not clamped up");
assert.equal(readRes("?res=abc"), 1);
assert.equal(readRes("?res=0"), 1);

writeRes(2);
assert.equal(readRes(""), 2, "stored choice is honoured");
assert.equal(readRes("?res=1"), 1, "URL wins over storage");
store.set("asp.ps2.res", "9");
assert.equal(readRes(""), 1, "a corrupt stored value falls back to 1×");

console.log("ps2 resolution choice ok");
