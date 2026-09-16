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

const LOCAL_ONLY = ["play-diag", "play-oph"];

const notOurs = SELF_HOSTED_WEB_GAME_IDS
  .filter((id) => WEB_GAMES[id].absent === "not-ours")
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
