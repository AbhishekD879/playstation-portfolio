// The web-games registry, and in particular the line between what this repo
// ships and what it does not.
//
// Everything bundled here carries a licence that permits redistribution —
// shareware terms, GPL, MIT, CC. The self-hosted entries do not: their engine
// or their data belongs to someone else, so the console carries only the
// plumbing and the owner supplies the build. The checks below are what stop
// that distinction eroding by accident.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
const {
  WEB_GAMES, WEB_GAME_IDS, BUNDLED_WEB_GAME_IDS, SELF_HOSTED_WEB_GAME_IDS,
  selfHostedPresent, resetSelfHostedProbes,
} = await import("./webgames.ts");

// —— every entry describes itself ————————————————————————————————————————
for (const id of WEB_GAME_IDS) {
  const g = WEB_GAMES[id];
  assert.equal(g.id, id, `${id}: id must match its key`);
  assert.ok(g.title && g.sub, `${id}: needs a title and a one-liner`);
  assert.ok(g.licence && g.licence.length > 10, `${id}: must record what it is distributed under`);
  assert.ok(g.source?.startsWith("http"), `${id}: must name its upstream`);
  assert.match(g.url, /^\/[a-z0-9-]+\/index\.html$/, `${id}: url must be a same-origin page`);
}

// the two lists partition the registry — no entry in both, none in neither
assert.equal(
  BUNDLED_WEB_GAME_IDS.length + SELF_HOSTED_WEB_GAME_IDS.length, WEB_GAME_IDS.length,
  "every game is either bundled or self-hosted, never both and never neither",
);
for (const id of SELF_HOSTED_WEB_GAME_IDS) {
  assert.ok(!BUNDLED_WEB_GAME_IDS.includes(id), `${id} cannot be both`);
}

// —— the bundled ones really are here ————————————————————————————————————
for (const id of BUNDLED_WEB_GAME_IDS) {
  assert.ok(existsSync(`public${WEB_GAMES[id].url}`),
    `${id} is listed as bundled but public${WEB_GAMES[id].url} does not exist — either add it or mark it selfHosted`);
}

// —— and the self-hosted ones are NOT committed ————————————————————————————
// This is the one that matters. If a build ever lands in the repo, this fails.
const gitignore = readFileSync(".gitignore", "utf8");
for (const id of SELF_HOSTED_WEB_GAME_IDS) {
  const dir = WEB_GAMES[id].url.split("/")[1];
  assert.match(gitignore, new RegExp(`^public/${dir}/\\s*$`, "m"),
    `public/${dir}/ must be gitignored — ${id} is not ours to redistribute`);
  assert.match(WEB_GAMES[id].licence, /NOT REDISTRIBUTED/,
    `${id}: the licence field must say plainly that it is not redistributed`);
}

// —— a self-hosted game appears only when its build is really there ————————
// The fetches the probe makes: "/index.html" for the shell, then the game's
// own url. What distinguishes a real build from the single-page fallback is
// that the fallback returns the shell byte for byte.
const SHELL = "<!doctype html><title>console shell</title>";
const BUILD = "<!doctype html><title>a real build</title>";
const isShellUrl = (u) => String(u) === "/index.html";

const ok = async (u) => ({ ok: true, text: async () => (isShellUrl(u) ? SHELL : BUILD) });
const fallback = async (u) => ({ ok: true, text: async () => SHELL });   // the SPA answered
const missing = async () => ({ ok: false, text: async () => "" });
const offline = async () => { throw new Error("offline"); };

const someSelfHosted = SELF_HOSTED_WEB_GAME_IDS[0];
assert.ok(someSelfHosted, "there should be at least one self-hosted entry to check");

resetSelfHostedProbes();
assert.equal(await selfHostedPresent(someSelfHosted, ok), true, "present build → shown");
resetSelfHostedProbes();
assert.equal(await selfHostedPresent(someSelfHosted, missing), false, "absent build → hidden, no 404 tile");
// the one that actually bites: Pages serves the console's own index.html for
// any unknown path, so a 200 proves nothing and every tile would always show
resetSelfHostedProbes();
assert.equal(await selfHostedPresent(someSelfHosted, fallback), false,
  "a single-page fallback is not a build — status is 200, so only the body can tell");
resetSelfHostedProbes();
assert.equal(await selfHostedPresent(someSelfHosted, offline), false, "a failed probe hides it rather than throwing");

// a bundled game is never probed — it ships, so it is always shown
resetSelfHostedProbes();
assert.equal(await selfHostedPresent(BUNDLED_WEB_GAME_IDS[0], ok), false,
  "selfHostedPresent only answers for self-hosted entries");
assert.equal(await selfHostedPresent("no-such-game", ok), false);

// probed once per page, not once per render. The shell is fetched once too and
// shared across every self-hosted game, so only the per-game request is counted.
resetSelfHostedProbes();
let gameCalls = 0;
const counting = async (u) => {
  const isShell = String(u) === "/index.html";
  if (!isShell) gameCalls++;
  return { ok: true, text: async () => (isShell ? SHELL : "<!doctype html><title>a real build</title>") };
};
assert.equal(await selfHostedPresent(someSelfHosted, counting), true);
await selfHostedPresent(someSelfHosted, counting);
assert.equal(gameCalls, 1, "the probe is remembered");

console.log(
  "webgames ok ·", BUNDLED_WEB_GAME_IDS.length, "bundled,",
  SELF_HOSTED_WEB_GAME_IDS.length, "self-hosted and gitignored",
);
