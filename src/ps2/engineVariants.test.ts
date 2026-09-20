// The engine-variant registry. Part of `npm test`.
//
// The id here becomes a URL path segment, and it can arrive from a link a
// stranger wrote (?core=…) or from localStorage. So the interesting assertions
// are the refusals, not the happy path.
import { strict as assert } from "node:assert";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const {
  ENGINE_VARIANTS, DEFAULT_VARIANT, isEngineVariant, engineVariant,
  variantUrl, variantAvailable, resetVariantProbes, readVariant, writeVariant,
} = await import("./engineVariants.ts");

// —— the registry is the allowlist ————————————————————————————————————————
{
  assert.ok(ENGINE_VARIANTS.length >= 2, "there is a shared core and at least one variant");
  assert.ok(isEngineVariant(DEFAULT_VARIANT), "the fallback is itself a listed variant");
  assert.equal(engineVariant(DEFAULT_VARIANT)!.levers.length, 0,
    "the shared core is the one with no levers — otherwise the baseline is not a baseline");

  const profiled = ENGINE_VARIANTS.filter((v) => v.profiled);
  assert.ok(profiled.length >= 1, "at least one build can report a split");
  for (const v of profiled) {
    assert.ok(v.levers.includes("PROFILE"),
      `${v.id} claims a profiler, so PROFILE must be among its recorded levers`);
  }
  for (const v of ENGINE_VARIANTS) {
    assert.ok(v.levers.includes("PROFILE") === v.profiled,
      `${v.id}: the PROFILE lever and the profiled flag must agree, or the panel offers a split the build cannot give`);
  }
}

// —— refusals ——————————————————————————————————————————————————————————————
{
  // The id is interpolated straight into a path, so traversal must die at the
  // shape check and never reach the lookup.
  for (const bad of ["../../etc/passwd", "mt/../..", "PROF", "play-mt", "", "a".repeat(40),
                     "mt ", "m t", null, undefined, 42, {}]) {
    assert.equal(isEngineVariant(bad), false, `refused: ${JSON.stringify(bad)}`);
  }
  // Well-shaped but not deployed is still refused: the allowlist is the point.
  assert.equal(isEngineVariant("nosuchcore"), false, "a well-formed id we do not ship is refused");
}
{
  assert.equal(variantUrl("fast"), "/play-fast/index.html");
  assert.equal(variantUrl(DEFAULT_VARIANT), "/play-mt/index.html",
    "the shared core keeps the directory it already has, so nothing has to move");
}

// —— the choice: URL beats storage beats default ————————————————————————————
{
  store.clear();
  assert.equal(readVariant("?core=fast"), "fast", "the URL can pin a build for a bug report");

  store.set("asp.ps2.variant", "prof");
  assert.equal(readVariant(""), "prof", "otherwise the remembered choice stands");
  assert.equal(readVariant("?core=fast"), "fast", "and the URL still beats it");

  assert.equal(readVariant("?core=../../evil"), "prof",
    "a hostile URL falls back to the stored choice, never to the path it asked for");

  store.set("asp.ps2.variant", "../../evil");
  assert.equal(readVariant(""), DEFAULT_VARIANT,
    "a poisoned storage value falls back to the shared core");

  store.clear();
  assert.equal(readVariant(""), DEFAULT_VARIANT, "nothing chosen means the shared core");
}
{
  store.clear();
  writeVariant("../../evil");
  assert.equal(store.size, 0, "an id that would not be accepted back is never written");
  writeVariant("fast");
  assert.equal(store.get("asp.ps2.variant"), "fast");
}

// —— availability: a build that was never made must not boot a blank screen ——
{
  resetVariantProbes();
  const seen: string[] = [];
  const ok = (async (url: string) => { seen.push(url); return { ok: true }; }) as unknown as typeof fetch;

  assert.equal(await variantAvailable("fast", ok), true);
  assert.deepEqual(seen, ["/play-fast/Play.wasm"], "probes the build's own wasm");

  await variantAvailable("fast", ok);
  assert.equal(seen.length, 1, "the answer is remembered — one HEAD per build per page");
}
{
  resetVariantProbes();
  const missing = (async () => ({ ok: false })) as unknown as typeof fetch;
  assert.equal(await variantAvailable("lto", missing), false, "a 404 reads as unavailable");
}
{
  resetVariantProbes();
  const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal(await variantAvailable("lto", offline), false,
    "a network failure reads as unavailable rather than rejecting");
}
{
  resetVariantProbes();
  let called = false;
  const spy = (async () => { called = true; return { ok: true }; }) as unknown as typeof fetch;
  assert.equal(await variantAvailable("../../evil", spy), false);
  assert.equal(called, false, "an id off the allowlist is never turned into a request");
}

console.log("engineVariants: ok");
