// Local cores must not reach a deploy, and shipping cores must not be stripped
// from one. Part of `npm test`.
//
// vite copies public/ into dist wholesale and .gitignore has no say in it, so
// the only thing keeping a debug core out of production is the list in
// scripts/stripLocalCores.mjs. That list was written by hand and drifted once
// already — play-diag and play-oph went live, 7.3MB of cores nobody should be
// served. Adding an engine variant is exactly the moment it drifts again.
//
// So this checks the invariant rather than the list: whatever git refuses to
// track under public/play-*, the deploy must refuse to serve — and the
// converse, because stripping the core the console actually boots would take
// PS2 down completely, silently, in production only.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;

/** The list the deploy actually uses, read from the script rather than
 *  restated — a copy here could agree with itself while both were wrong. */
function stripList(): string[] {
  const src = readFileSync(`${root}scripts/stripLocalCores.mjs`, "utf8");
  const m = src.match(/const LOCAL_ONLY = \[([\s\S]*?)\];/);
  assert.ok(m, "stripLocalCores.mjs must still declare a LOCAL_ONLY array");
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const ignored = (dir: string): boolean => {
  try {
    // --no-index so the answer is about the rule, not about what happens to be
    // staged; a core added to the index by accident must still read as ignored.
    execFileSync("git", ["check-ignore", "--no-index", "-q", `public/${dir}/Play.wasm`], { cwd: root });
    return true;
  } catch {
    return false;
  }
};

const onDisk = readdirSync(`${root}public`, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("play"))
  .map((e) => e.name);

const LOCAL_ONLY = stripList();

// —— nothing gitignored may ride into the deploy ——————————————————————————
for (const dir of onDisk) {
  if (!ignored(dir)) continue;
  assert.ok(
    LOCAL_ONLY.includes(dir),
    `public/${dir}/ is gitignored but scripts/stripLocalCores.mjs would serve it. ` +
      `Add "${dir}" to LOCAL_ONLY, or track the directory if it is meant to ship.`,
  );
}

// —— and nothing that ships may be stripped from it ————————————————————————
for (const dir of LOCAL_ONLY) {
  assert.ok(
    ignored(dir),
    `scripts/stripLocalCores.mjs strips public/${dir}/, but git tracks it — ` +
      `a tracked core is one we ship, and stripping it breaks the console in production only.`,
  );
}

// —— the core the console boots is a tracked, shipping one ————————————————
{
  assert.ok(onDisk.includes("play-mt"), "the shared core is on disk");
  assert.equal(ignored("play-mt"), false, "the shared core is tracked, because it ships");
  assert.equal(LOCAL_ONLY.includes("play-mt"), false, "and so it is never stripped");
}

console.log(`localCores: ok (${onDisk.length} core dirs, ${LOCAL_ONLY.length} stripped)`);
