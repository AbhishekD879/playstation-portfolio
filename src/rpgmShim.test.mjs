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

console.log(`rpgm shim ok · SHIM_V ${SHIM_V} · diag ${diag.length}b · nw ${nw.length}b`);
