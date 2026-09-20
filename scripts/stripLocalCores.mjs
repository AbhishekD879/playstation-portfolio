// Keep out of a deploy the things that must not be served from it.
//
// public/ is copied into dist wholesale, and .gitignore has no say in that — so
// anything sitting in public/ for local use rides along into production unless
// something removes it. It happened once: play-diag (CPU sampling bindings,
// CLog enabled) and play-oph (an A/B baseline) were both live, 7.3 MB of cores
// nobody should be served.
//
// Two separate reasons to strip, and they are not the same thing:
//
//   1. LOCAL-ONLY BUILDS — diagnostic cores that exist to debug one game. Fine
//      to hold, pointless to serve. Listed below; the names match .gitignore.
//
//   2. BUILDS THAT ARE NOT OURS TO REDISTRIBUTE — the self-hosted slots marked
//      `absent: "not-ours"` in src/webgames.ts. Running one locally from a copy
//      you own is your business; publishing its engine or its data from this
//      site is distribution, and for those entries there is no licence that
//      permits it. The list is read from the registry rather than repeated
//      here, so a new slot cannot be added without this following it.
//
//      Note what is NOT stripped: `absent: "no-build"` entries such as Luanti
//      are free software whose licences do permit redistribution. They ship.
import { rmSync, existsSync } from "node:fs";

const { WEB_GAMES, SELF_HOSTED_WEB_GAME_IDS } = await import("../src/webgames.ts");

// Local-only cores. Kept in step with .gitignore by src/ps2/localCores.test.ts,
// which fails if a gitignored public/play-* directory is missing from here —
// the drift that put 7.3MB of debug cores into production the first time.
const LOCAL_ONLY = [
  "play-diag",   // CPU-sampling bindings, CLog enabled
  "play-oph",    // A/B baseline, no WebGL feedback change
  // Engine speed variants: one compiler lever each, built to be compared and
  // thrown away. See src/ps2/engineVariants.ts.
  "play-prof", "play-fast", "play-ehx", "play-simd", "play-lto",
];

const notOurs = SELF_HOSTED_WEB_GAME_IDS
  // publishEngine opts a slot back in: its directory holds an engine and a host
  // page, no game data, and the owner has decided to serve it. The default is
  // still to strip, so a slot whose folder would carry someone's game assets
  // cannot be published by forgetting something.
  .filter((id) => WEB_GAMES[id].absent === "not-ours" && !WEB_GAMES[id].publishEngine)
  // the directory is the first segment of the url, e.g. "/gtavc/index.html"
  .map((id) => WEB_GAMES[id].url.split("/")[1]);

let removed = 0;
const strip = (dir, why) => {
  const path = `dist/${dir}`;
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`stripped ${why}:`, path);
  removed++;
};

for (const dir of LOCAL_ONLY) strip(dir, "local-only core");
for (const dir of notOurs) strip(dir, "not ours to redistribute");

console.log(`stripped from deploy: ${removed}`);
