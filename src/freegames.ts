// Free games the console can download onto a shelf with one tap. Every entry is
// homebrew or a game its rights-holder released for free; nothing here is a
// commercial ROM. The file is fetched by the visitor's browser straight from
// the source (or through our allow-listed relay when the host sends no CORS
// header) and stored in the library like any other game — the console never
// hosts the files. `licence` records the permission we relied on.
//
// Pure data + tiny helpers, so the list is testable (systems exist, URLs are
// https, extensions match the system).

export interface FreeGame {
  id: string;
  system: string;      // registry id (systems.ts)
  title: string;
  author: string;
  year?: number;
  licence: string;     // e.g. "GPL-3.0", "Freely released by the rights holder (mamedev.org)"
  url: string;         // direct download of the file itself
  file?: string;       // name to store under when the URL's file name would not land on `system`
  size?: number;       // bytes, when known — shown before download
  note: string;        // one line for the player
  relay?: boolean;     // host sends no Access-Control-Allow-Origin → fetch via /api/rom
}

/** Hosts the /api/rom relay will fetch from (and follow redirects to). Anything else is refused there too. */
export const RELAY_HOSTS = ["www.mamedev.org", "mamedev.org", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];

const MAME_LICENCE = "Released for free, non-commercial use by the rights holder — distributed by mamedev.org";
const mame = (set: string, title: string, author: string, year: number, size: number, note: string, zip = set): FreeGame => ({
  id: `mame-${set}`, system: "mame", title, author, year, licence: MAME_LICENCE, url: `https://www.mamedev.org/roms/${set}/${zip}.zip`, size, note, relay: true,
});
const w4 = (slug: string, title: string, author: string, size: number, note: string): FreeGame => ({
  id: `w4-${slug}`, system: "wasm4", title, author, licence: "CC BY-NC-SA 4.0 (WASM-4 carts archive)", url: `https://raw.githubusercontent.com/aduros/wasm4/main/site/static/carts/${slug}.wasm`, size, note,
});
const gh = (id: string, system: string, title: string, author: string, year: number, licence: string, url: string, size: number, note: string, file?: string): FreeGame => ({
  id, system, title, author, year, licence, url, size, note, relay: true, ...(file ? { file } : {}),
});

export const FREE_GAMES: FreeGame[] = [
  // MAME's own site distributes these with the rights-holders' permission. Only
  // sets that MAME 2003-Plus (our arcade core) knows are listed — falcnwld and
  // topgunnr are on mamedev.org but not in this core.
  mame("gridlee", "Gridlee", "Videa", 1982, 25516, "Unreleased 1983 arcade shooter; Select inserts a coin"),
  mame("robby", "Robby Roto", "Bally/Midway (Dave Nutting Associates)", 1981, 27915, "Dig through rock, rescue the miners"),
  mame("alienar", "Alien Arena", "Duncan Brown", 1985, 17005, "Two-player arena shooter; Select inserts a coin"),
  mame("carpolo", "Car Polo", "Exidy", 1977, 5562, "Four-player car polo — one of Exidy's first"),
  mame("circus", "Circus", "Exidy", 1977, 6152, "Bounce clowns off a seesaw to pop balloons"),
  mame("crash", "Crash", "Exidy", 1979, 5776, "Drive the maze, dodge the chaser"),
  mame("fax", "FAX", "Exidy", 1983, 198449, "Trivia quiz cabinet — thousands of questions"),
  mame("fireone", "Fire One", "Exidy", 1979, 23227, "Two-player submarine duel"),
  mame("hardhat", "Hard Hat", "Exidy", 1982, 19938, "Construction-site maze chase"),
  mame("looping", "Looping", "Video Games GmbH", 1982, 22684, "Loop-the-loop plane through the tunnels"),
  mame("ripcord", "Rip Cord", "Exidy", 1979, 5906, "Skydive onto the moving targets"),
  mame("robotbwl", "Robot Bowl", "Exidy", 1977, 5608, "Ten-pin bowling, 1977 style"),
  mame("sidetrac", "Side Trak", "Exidy", 1979, 5491, "Switch the tracks, keep the train alive"),
  mame("spectar", "Spectar", "Exidy", 1980, 10105, "Targ's sequel — hunt the Wummels"),
  mame("starfire", "Star Fire", "Exidy", 1979, 16748, "First-person space combat, sit-down classic"),
  mame("supertnk", "Super Tank", "Video Games GmbH", 1981, 13383, "Tank battle across a mined field"),
  mame("targ", "Targ", "Exidy", 1980, 8157, "Ram the Targs in the Crystal City grid"),
  mame("teetert", "Teeter Torture", "Exidy", 1982, 24417, "Balance the seesaw, shoot the balloons"),
  // Open-source homebrew with GitHub release builds (GitHub sends no CORS header → relay)
  gh("nes-nova", "nes", "Nova the Squirrel", "NovaSquirrel", 2018, "GPL-3.0 — https://github.com/NovaSquirrel/NovaTheSquirrel", "https://github.com/NovaSquirrel/NovaTheSquirrel/releases/download/v1.0.6a/nova.nes", 262160, "Open-source NES platformer with block-moving puzzles"),
  gh("gb-ucity", "gb", "µCity", "AntonioND", 2018, "GPL-3.0+ — https://github.com/AntonioND/ucity", "https://github.com/AntonioND/ucity/releases/download/v1.3/ucity.gbc", 131072, "SimCity-style city builder for Game Boy Color"),
  gh("a26-bounstryk", "atari2600", "Bounstryk", "Egar Garcia", 2021, "Apache-2.0 — https://github.com/egar-garcia/bounstryk", "https://github.com/egar-garcia/bounstryk/releases/latest/download/bounstryk.bin", 8192, "Homebrew 2600 arcade action — 8 KB of it", "bounstryk.a26"),
  // WASM-4 carts archive (CC BY-NC-SA 4.0, authors credited) — served by GitHub with CORS
  w4("watris", "Watris", "Bruno Garcia", 2628, "Falling blocks on the WASM-4 fantasy console"),
  w4("2048", "2048", "Peter Hellberg", 12469, "Slide the tiles to 2048"),
  w4("antcopter", "Antcopter", "Eduardo Bart", 33454, "Tiny helicopter platformer"),
  w4("escape-guldur", "Escape Guldur", "Chris Heyes", 28350, "Dungeon escape, one screen at a time"),
  w4("dashy-dango", "Dashy Dango", "samX500", 47101, "Dash through the enemies to score"),
  w4("first-flight", "First Flight", "bootra", 63858, "Fly the course before the fuel runs out"),
];

export const freeGamesFor = (systems: readonly string[]): FreeGame[] => FREE_GAMES.filter((g) => systems.includes(g.system));

/** The URL the browser actually fetches: direct, or through the relay for hosts without CORS. */
export const downloadUrl = (g: FreeGame) => (g.relay ? `/api/rom?url=${encodeURIComponent(g.url)}` : g.url);

export const fileNameOf = (g: Pick<FreeGame, "url" | "file"> & { id?: string }) =>
  g.file ?? decodeURIComponent(g.url.split("/").pop() ?? `${g.id}.bin`).split("?")[0];
