// The Python injected as main.py runs before Ren'Py does anything, so a syntax
// error there is a blank screen with no traceback. It is also the one file whose
// safety property matters: the import finder must bow out whenever a real module
// exists, or it would shadow working stdlib modules with dead stubs.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const src = readFileSync(new URL("./renpyConvert.ts", import.meta.url), "utf8");
const m = src.match(/const WEB_IMPORT_SHIM = `([\s\S]*?)`;/);
assert.ok(m, "WEB_IMPORT_SHIM not found");
const py = m[1];

// syntax-check with a real parser rather than eyeballing it
execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py });

// a stub must never win over a module that actually exists
assert.match(py, /_imp\.find_module\(top\)/, "must probe for the real module first");
assert.match(py, /return None/, "must return None when the real module is found");
assert.ok(py.indexOf("_imp.find_module(top)") < py.indexOf("return self"),
  "the existence check must come before claiming the import");

// Only modules whose absence is FATAL. urllib2 imports httplib unconditionally,
// so missing it kills the game.
for (const n of ["httplib", "mimetools"]) {
  assert.ok(py.includes(`"${n}"`), `${n} should be covered`);
}
// These are imported by the stdlib inside try/except ImportError, so absence is
// already handled. Stubbing _ssl turned a handled failure into an unhandled one:
// "import _ssl" succeeded, then "from _ssl import RAND_add" blew up.
for (const n of ["ctypes", "_ssl", "ssl", "socket"]) {
  assert.ok(!new RegExp(`["']${n}["']`).test(py),
    `${n} must NOT be stubbed — its absence is already handled gracefully`);
}

// A stub has to answer ANY attribute, or one ImportError just becomes another.
assert.match(py, /def __getattr__\(self, attr\)/, "the stub must answer any attribute");
assert.match(py, /\(Exception,\)/, "attributes must work in an except clause and as a constructor");
assert.match(py, /raise AttributeError\(attr\)/, "dunder lookups must still fail normally");

// Names are answered generically by __getattr__, so no list to keep in sync —
// but the ones used as MAPPINGS rather than classes must be real values, since an
// Exception subclass would not survive a subscript.
assert.match(py, /mod\.responses = \{\}/, "httplib.responses is indexed, not called");
assert.match(py, /mod\.HTTP_PORT = 80/);
assert.match(py, /mod\.HTTPS_PORT = 443/);

// the bootstrap must be executed from its own file: prepending the shim to it
// would push its coding declaration past line 2, where Python 2 stops looking
assert.match(py, /execfile\("_asp_bootstrap\.py"\)/);
assert.match(src, /addFile\("_asp_bootstrap\.py", bootstrap\.path/);
assert.ok(!/addFile\("main\.py", bootstrap\.path/.test(src),
  "main.py must be the shim, not the raw bootstrap");

console.log("renpy web shim ok - py syntax, fallback-only imports, bootstrap wrapped");

// The touch-variant fallback is Ren'Py script, compiled by the engine at startup,
// so a syntax error there is a boot failure. It must also hand back an IMAGE
// object: im.py calls .load() on whatever the callback returns, so a path string
// would swap one crash for another.
const rpyMatch = src.match(/const WEB_COMPAT_RPY = `([\s\S]*?)`;/);
assert.ok(rpyMatch, "WEB_COMPAT_RPY not found");
const rpy = rpyMatch[1];
const pyBody = rpy.split("\n").slice(2).map((l) => (l.startsWith("    ") ? l.slice(4) : l)).join("\n");
execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: pyBody });
assert.match(rpy, /config\.missing_image_callback = _asp_missing_image/);
assert.match(rpy, /renpy\.display\.im\.Image\(alt\)/, "must return an image, not a path");
assert.match(rpy, /except TypeError/, "loadable's signature differs across versions");
for (const v of ["phone", "tablet", "touch"]) assert.ok(rpy.includes(`"${v}"`), `${v} variant`);
assert.match(src, /game\/_asp_web_compat\.rpy/, "must be packed into game/");

console.log("renpy touch-variant fallback ok - rpy python parses, returns an Image");
