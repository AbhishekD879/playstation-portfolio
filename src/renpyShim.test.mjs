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

// network modules only — ctypes is deliberately excluded, Ren'Py already handles
// its absence and stubbing it pushes steam init down a path it cannot finish
for (const n of ["httplib", "mimetools", "socket", "ssl", "ftplib", "smtplib"]) {
  assert.ok(py.includes(`"${n}"`), `${n} should be covered`);
}
assert.ok(!/["']ctypes["']/.test(py), "ctypes must NOT be stubbed");

// urllib2 touches these on import, so they have to exist on the stub
for (const attr of ["HTTPConnection", "HTTPSConnection", "HTTPException", "BadStatusLine", "responses"]) {
  assert.ok(py.includes(attr), `urllib2 needs ${attr}`);
}

// the bootstrap must be executed from its own file: prepending the shim to it
// would push its coding declaration past line 2, where Python 2 stops looking
assert.match(py, /execfile\("_asp_bootstrap\.py"\)/);
assert.match(src, /addFile\("_asp_bootstrap\.py", bootstrap\.path/);
assert.ok(!/addFile\("main\.py", bootstrap\.path/.test(src),
  "main.py must be the shim, not the raw bootstrap");

console.log("renpy web shim ok - py syntax, fallback-only imports, bootstrap wrapped");
