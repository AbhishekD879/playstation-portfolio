// Regenerates src/data/ps2compat.ts from Play!'s public compatibility tracker.
//
// Play! keeps its game-by-game results as GitHub issues in jpd002/Play-Compatibility,
// one per title, headed "[SLUS-21198] Batman Begins" and carrying exactly one
// state-* label. That is the only machine-readable record of what actually runs,
// and it is what the emulator's own desktop build shows in its game list.
//
// We ship it as a static table so the console can answer "will my disc work?"
// before anyone spends an hour ripping one, and so the answer costs no network
// call at play time.
//
//   node scripts/ps2compat.mjs      # needs gh on PATH; writes src/data/ps2compat.ts
//
// The tracker is community-reported and unevenly maintained: entries record the
// build they were last tested on, and some are years old. Treat a state as
// "last reported", never as a promise. The sheet says as much to the player.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = "jpd002/Play-Compatibility";
const OUT = "src/data/ps2compat.ts";

// The states we surface, best to worst. "nothing" (a single entry) folds into
// "intro": from a player's seat both mean "don't bother ripping this".
const STATES = { playable: "playable", ingame: "ingame", intro: "intro", loadable: "loadable", nothing: "intro" };
const ORDER = ["playable", "ingame", "loadable", "intro"];

console.log("fetching " + REPO + " issues...");
const raw = execFileSync("gh", [
  "api", "--paginate",
  "repos/" + REPO + "/issues?state=all&per_page=100",
  "--jq", '.[] | select(.pull_request == null) | {t: .title, l: [.labels[].name]}',
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// "[SLUS-21198]" and "[SLUS_211.98]" both occur in the wild; normalise to the
// shape SYSTEM.CNF gives us once its punctuation is stripped.
const TITLE = /^\[([A-Za-z]{4})[-_]?(\d{3})[.\-_]?(\d{2})\]\s*(.+)$/;

const games = new Map();
let skipped = 0;
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  let o;
  try { o = JSON.parse(line); } catch { continue; }
  const m = TITLE.exec(o.t.trim());
  if (!m) { skipped++; continue; }                     // issue templates, malformed titles
  const label = o.l.find((l) => l.startsWith("state-"));
  const state = label && STATES[label.slice(6)];
  if (!state) { skipped++; continue; }                 // unlabelled, or testing-needed
  const id = m[1].toUpperCase() + "-" + m[2] + m[3];
  // Regional variants share a title id in a few cases; keep the best report.
  const prev = games.get(id);
  if (!prev || ORDER.indexOf(state) < ORDER.indexOf(prev.state)) {
    games.set(id, { name: m[4].trim().replace(/\s+/g, " "), state });
  }
}

const sorted = [...games.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
const counts = {};
for (const [, g] of sorted) counts[g.state] = (counts[g.state] ?? 0) + 1;

const rows = sorted
  .map(([id, g]) => '  ["' + id + '", "' + g.name.replace(/"/g, '\\"') + '", "' + g.state + '"],')
  .join("\n");

const tally = ORDER.filter((s) => counts[s]).map((s) => counts[s] + " " + s).join(" · ");

const header = [
  "// Generated from Play!'s compatibility tracker (github.com/" + REPO + ") on " + new Date().toISOString().slice(0, 10) + ".",
  "// One entry per PS2 title id, carrying the state its community reports last landed on.",
  "// Regenerate with `node scripts/ps2compat.mjs`; do not hand-edit.",
  "//",
  "// " + sorted.length + " titles · " + tally,
  "//",
  "// These are REPORTS, not guarantees: each came from someone testing one build on",
  "// one machine, and some are years old. The sheet labels them that way too.",
  'export type Ps2CompatState = "playable" | "ingame" | "intro" | "loadable";',
  "",
  "/** [title id, game name, state] — a tuple array so 2.6k rows stay compact. */",
  "export const PS2_COMPAT: readonly (readonly [string, string, Ps2CompatState])[] = [",
].join("\n");

writeFileSync(OUT, header + "\n" + rows + "\n];\n");

console.log("wrote " + OUT + ": " + sorted.length + " titles (" + skipped + " rows skipped)");
for (const s of ORDER) if (counts[s]) console.log("  " + s.padEnd(9) + counts[s]);
