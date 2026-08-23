// findGameRoot decides the prefix the service worker prepends to every on-demand
// asset fetch. Get it wrong and the engine boots but every image 404s, so it is
// worth pinning against the shapes real archives actually have.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findGameRoot } from "./renpyPack.ts";

// renpyConvert.ts itself imports fflate, which node cannot resolve from a bare
// .ts import, so the engine allow-list below is read from its source text.
const src = readFileSync(new URL("./renpyConvert.ts", import.meta.url), "utf8");

assert.equal(findGameRoot(["game/script.rpyc", "lib/x.so"]), "", "already at the top level");
assert.equal(
  findGameRoot(["MyGame-1.0-pc/game/script.rpyc", "MyGame-1.0-pc/lib/py3-linux-x86_64/x.so"]),
  "MyGame-1.0-pc/", "the usual one-level nesting");
// a zip can hold a nested copy; the shallowest is the real build
assert.equal(
  findGameRoot(["outer/inner/game/a.rpyc", "outer/game/b.rpyc"]),
  "outer/", "shallowest game/ wins");
// "game" must be a directory, not a filename or a suffix of one
assert.equal(findGameRoot(["game", "readme.txt"]), null, "a bare 'game' entry is not a folder");
assert.equal(findGameRoot(["mygame/data.txt"]), null, "must not match a directory ending in 'game'");
assert.equal(findGameRoot([]), null);

// The engine layout differs between the 7.x and 8.x lines, so the filter is a
// deny-list. Both real layouts must survive it, and the debug symbols and
// Ren'Py's own service worker must not (a worker registered under our /rpgm/
// scope would outrank ours for that path).
const skip = src.match(/const ENGINE_SKIP = \[([\s\S]*?)\n\];/);
assert.ok(skip, "ENGINE_SKIP not found");
const res = [...skip[1].matchAll(/^\s*(\/(?:[^/\\]|\\.)+\/)[a-z]*,/gm)].map((m) => {
  const body = m[1].slice(1, -1);
  return new RegExp(body);
});
assert.ok(res.length >= 4, `expected the four skip patterns, parsed ${res.length}`);
const wanted = (n) => n.startsWith("web/") && !n.endsWith("/") && !res.some((r) => r.test(n));

for (const f of [                       // 7.x line
  "web/index.html", "web/index.js", "web/index.wasm",
  "web/pyapp.data", "web/pyapp-data.js", "web/pythonhome.data", "web/pythonhome-data.js",
]) assert.ok(wanted(f), `7.x engine must keep ${f}`);

for (const f of [                       // 8.x line — a different layout entirely
  "web/index.html", "web/renpy.js", "web/renpy-pre.js", "web/renpy.wasm",
  "web/renpy.data", "web/manifest.json", "web/web-presplash.jpg", "web/web-icon.png",
]) assert.ok(wanted(f), `8.x engine must keep ${f}`);

for (const f of [
  "web/index.html.symbols", "web/hash.txt", "web/htaccess.txt",
  "web/service-worker.js", "web/", "game/script.rpyc", "readme.txt",
]) assert.ok(!wanted(f), `must not keep ${f}`);

console.log("renpy convert ok · game root + engine filter (7.x and 8.x layouts)");
