// The diagnostic shims live inside template literals in public/rpgm-sw.js, so a
// backslash means one thing in the source and another in the emitted script.
// That has silently broken shipped probes three times: `\s` collapsed to a
// literal "s", a stray backtick closed the template, and `movies\/` closed a
// regex early. None of it was visible until a phone ran the code.
//
// So: extract each shim exactly the way the service worker does, parse it, and
// assert the regexes survived the round trip. Runs from prebuild — a broken
// shim can no longer reach a device.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../public/rpgm-sw.js", import.meta.url), "utf8");
const SHIM_V = (src.match(/const SHIM_V = "([^"]+)"/) || [])[1];
assert.ok(SHIM_V, "SHIM_V must be declared — it is how a log identifies its shim");

function emitted(name) {
  const m = src.match(new RegExp("const " + name + " = (`[\\s\\S]*?`);"));
  assert.ok(m, name + " template literal not found");
  // eslint-disable-next-line no-eval
  const text = eval(m[1]);                       // what the browser really receives
  const body = text.replace(/^<script>/, "").replace(/<\/script>$/, "");
  assert.doesNotThrow(() => new Function(body), name + " does not parse");
  return body;
}

const diag = emitted("DIAG_SHIM");
const renpy = emitted("RENPY_SHIM");
const nw = emitted("NW_SHIM");

// whitespace classes must stay classes, not the bare letter "s"
for (const shim of [diag, nw]) {
  assert.ok(!/[^\\]\/s\+\//.test(shim), "a \\s+ regex collapsed to /s+/ — escape it as \\\\s");
}

// a character class that ends up as a bare / closes the regex and breaks parsing;
// parsing already passed above, so assert the slash is still escaped
const movies = diag.match(/\/\^movies[^/]*\\\/[^\n]*?\/\.test/);
assert.ok(movies, "the movies/ regex lost its escaped slash");

assert.ok(diag.includes("selftest"), "the self-test result must reach the snapshot");
assert.ok(/addEventListener\("pause"/.test(diag), "the pause listener is the fix under test");


// fixStrayEscapes carries a real rule (drop an UNPAIRED trailing backslash, keep
// an even run) and it rewrites player-visible dialogue, so it gets a check.
// Extracted from the emitted shim rather than duplicated, so the test exercises
// what the device actually runs.
const fnSrc = diag.match(/function fixStrayEscapes\(t\)\{[\s\S]*?\n  \}/);
assert.ok(fnSrc, "fixStrayEscapes not found in the emitted shim");
// ecFixed is the shim's diagnostic counter; supply it so the extracted
// function runs unmodified rather than being edited to suit the test.
const fixStrayEscapes = new Function("var ecFixed=0;" + fnSrc[0] + "; return fixStrayEscapes;")();

const BS = String.fromCharCode(92), NL = "\n";
for (const [name, input, want] of [
  // the exact shape measured on device: a lone backslash ending the line, which
  // the word-wrap plugin would otherwise glue onto the next line's \c[0]
  ["drops a lone trailing backslash", `[a]${BS}${NL}<W>${BS}c[0]hi`, `[a]${NL}<W>${BS}c[0]hi`],
  // the sibling line in the same capture, which already worked
  ["leaves a clean line alone", `[a]${NL}<W>${BS}c[0]hi`, `[a]${NL}<W>${BS}c[0]hi`],
  // an even run is a deliberate escaped backslash
  ["keeps an escaped pair", `[a]${BS}${BS}${NL}x`, `[a]${BS}${BS}${NL}x`],
  ["keeps three, drops one", `[a]${BS}${BS}${BS}${NL}x`, `[a]${BS}${BS}${NL}x`],
  // only end-of-line backslashes are suspect
  ["never touches mid-line codes", `a${BS}c[0]b`, `a${BS}c[0]b`],
  ["handles trailing spaces", `[a]${BS}  ${NL}x`, `[a]  ${NL}x`],
  ["end of string counts as end of line", `[a]${BS}`, "[a]"],
]) {
  assert.equal(fixStrayEscapes(input), want, name);
}
console.log("fixStrayEscapes ok · 7 cases");

// The Ren'Py route forces preserveDrawingBuffer so a capture works even when the
// engine has stopped redrawing (idle at a menu, or an error screen) — which is
// why every earlier screenshot read back fully transparent.
assert.match(renpy, /preserveDrawingBuffer/, "Ren'Py needs a readable buffer at any time");
// It must be FORCED: emscripten/SDL pass preserveDrawingBuffer explicitly as
// false, so a "respect an explicit value" override never fires and every
// capture reads back blank — which is exactly what happened.
assert.match(renpy, /Object\.assign\(\{\}, attrs \|\| \{\}, \{ preserveDrawingBuffer: true \}\)/,
  "preserveDrawingBuffer must be forced, not defaulted");
// match the assignment, not the word — DIAG_SHIM's comments explain why it does
// NOT force the flag, and a bare word match hits that explanation
assert.ok(!/preserveDrawingBuffer\s*=/.test(diag),
  "the shared probe must NOT force it: other engines would pay a per-frame copy");

// The engine's own error banner covers the picture, so it is suppressed unless
// the Labs flag asks for it — but the text must still reach the console, or the
// diagnostics lose the reason along with the banner.
assert.match(renpy, /window\.__aspEngineErrors/, "must be gated on the flag");
assert.match(renpy, /console\.warn\("\[engine status suppressed\] "/,
  "the reason must survive even when the banner does not");
assert.match(renpy, /MutationObserver/, "the engine rewrites the status after we clear it");
assert.match(src, /window\.__aspEngineErrors=\$\{engineErrors/,
  "the worker must inject the flag it reads from the URL");
assert.match(src, /searchParams\.get\("engineErrors"\)/);

console.log(`rpgm shim ok · SHIM_V ${SHIM_V} · diag ${diag.length}b · nw ${nw.length}b`);
