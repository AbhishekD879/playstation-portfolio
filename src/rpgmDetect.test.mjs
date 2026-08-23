// The Ren'Py web-build matchers are the difference between a game running and a
// user being told their engine is unsupported, and a .wasm.br build was silently
// missing the check. detect() is not importable here (rpgm.ts pulls in browser
// modules with extensionless TS imports), so pull the shipped regex literals
// straight out of the source — the same approach as rpgmShim.test.mjs, and it
// tests the pattern that actually ships rather than a copy of it.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("./rpgm.ts", import.meta.url), "utf8");

function literal(name) {
  const m = src.match(new RegExp("const " + name + " = find\\(\\(p\\) => (/[^;]+?/)\\.test\\(p\\)\\)"));
  assert.ok(m, name + " regex not found in rpgm.ts");
  return new RegExp(m[1].slice(1, -1));
}
const wasm = literal("renpyWasm");

for (const p of [
  "renpy.wasm", "game/renpy.wasm", "index.wasm",
  "renpy.wasm.gz", "renpy.wasm.br",            // the shapes hosts actually serve
  "MyGame-1.0-web/renpy.wasm.br",              // nested, as a zip usually is
]) assert.ok(wasm.test(p), `should detect a Ren'Py web build: ${p}`);

for (const p of [
  "renpy.wasm.zst",        // not a form we serve
  "otherrenpy.wasm",       // must be a path segment, not a suffix match
  "renpy.wasmx",
  "game/renpy.js",         // the loader is a separate check
]) assert.ok(!wasm.test(p), `should NOT match: ${p}`);

// The loader half: renpy.js on 7.x web builds, else the packed game data.
const loaderRe = /(^|\/)renpy\.js$/;
const dataRe = new RegExp(
  src.match(/find\(\(p\) => (\/\(\^\|\\\/\)game\\\.\([^;]+?)\.test\(p\)\)/)[1].slice(0, -1).slice(1, -1));
for (const p of ["renpy.js", "web/renpy.js"]) assert.ok(loaderRe.test(p), p);
for (const p of ["game.zip", "game.data", "build/game.zip"]) assert.ok(dataRe.test(p), `loader data: ${p}`);
assert.ok(!dataRe.test("mygame.zip"), "must not match an arbitrary zip");

console.log("renpy detect ok · wasm gz/br + game.zip/.data");
