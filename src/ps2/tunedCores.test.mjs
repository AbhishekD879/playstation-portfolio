// A core id chosen here becomes a URL the emulator frame loads, and the id
// arrives from a KV blob an admin edits by hand. So the thing worth pinning
// down is that only builds we actually ship can ever be named, and that a
// missing build degrades to the shared core instead of a blank screen.
import assert from "node:assert/strict";
const {
  TUNED_CORES, isTunedCore, tunedCore, tunedCoreUrl, tunedCoreAvailable, resetTunedCoreProbes,
} = await import("./tunedCores.ts");

// —— the registry describes itself honestly ————————————————————————————————
for (const c of TUNED_CORES) {
  assert.match(c.id, /^[a-z0-9][a-z0-9-]{0,30}$/, `core id ${c.id} must be a bare directory name`);
  assert.ok(c.branch && c.branch.length > 2, `core ${c.id} must name the branch that builds it`);
  assert.ok(c.why && c.why.length > 20, `core ${c.id} must say why it is not in the shared core`);
}
const ids = TUNED_CORES.map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, "core ids are directories — they cannot collide");

// —— only shipped builds can be named ——————————————————————————————————————
for (const id of ids) assert.ok(isTunedCore(id), `${id} is in the registry`);
assert.equal(isTunedCore("not-a-core"), false, "an unknown id is not a core");
assert.equal(isTunedCore(""), false);
assert.equal(isTunedCore(null), false);
assert.equal(isTunedCore(undefined), false);
assert.equal(isTunedCore(42), false);

// a path must never survive, whatever else changes
assert.equal(isTunedCore("../play-mt"), false, "no traversal");
assert.equal(isTunedCore("/etc/passwd"), false, "no absolute path");
assert.equal(isTunedCore("https://evil.example/x"), false, "no absolute URL");
assert.equal(isTunedCore("a/b"), false, "no separators");
assert.equal(isTunedCore("Play-MT"), false, "lower case only");
assert.equal(isTunedCore("x".repeat(64)), false, "bounded length");

assert.equal(tunedCore("not-a-core"), null);

// —— the URL is a directory under our own origin ————————————————————————————
assert.equal(tunedCoreUrl("bb"), "/play-bb/index.html");
assert.match(tunedCoreUrl("bb"), /^\/play-[a-z0-9-]+\/index\.html$/);

// —— a missing build degrades, it does not break the console ————————————————
const okFetch = async () => ({ ok: true });
const goneFetch = async () => ({ ok: false });
const deadFetch = async () => { throw new Error("offline"); };

assert.equal(await tunedCoreAvailable("not-a-core", okFetch), false,
  "an unknown id is never probed, let alone loaded");

if (ids.length) {
  const id = ids[0];
  resetTunedCoreProbes();
  assert.equal(await tunedCoreAvailable(id, okFetch), true);
  resetTunedCoreProbes();
  assert.equal(await tunedCoreAvailable(id, goneFetch), false, "not deployed → shared core");
  resetTunedCoreProbes();
  assert.equal(await tunedCoreAvailable(id, deadFetch), false, "offline → shared core, never a throw");

  // the probe is remembered, so one HEAD per core per page
  resetTunedCoreProbes();
  let calls = 0;
  const counting = async () => { calls++; return { ok: true }; };
  await tunedCoreAvailable(id, counting);
  await tunedCoreAvailable(id, counting);
  assert.equal(calls, 1, "probed once and remembered");
}

// —— overrides may only select a shipped build ——————————————————————————————
const { sanitiseOverride } = await import("../ps2knobs.ts");
assert.equal(sanitiseOverride({ core: "../play-mt" }), null, "a path in KV is dropped entirely");
assert.equal(sanitiseOverride({ core: "no-such-build" }), null, "an unshipped build is dropped");
assert.deepEqual(sanitiseOverride({ core: "no-such-build", clock: "half" }), { clock: "half" },
  "a bad core does not take the rest of the override with it");
if (ids.length) {
  assert.equal(sanitiseOverride({ core: ids[0] })?.core, ids[0], "a shipped build is accepted");
}

console.log("tunedCores ok ·", TUNED_CORES.length, "tuned core(s) registered");
