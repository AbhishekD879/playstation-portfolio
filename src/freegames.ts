// Free games the console can download onto a shelf with one tap. Every entry is
// homebrew or a game its rights-holder released for free; nothing here is a
// commercial ROM. The file is fetched by the visitor's browser straight from
// the source (or through our allow-listed relay when the host sends no CORS
// header) and stored in the library like any other game — the console never
// hosts the files. `licence` records the permission we relied on.
//
// Pure data + tiny helpers, so the list is testable (systems exist, URLs are
// https, extensions match the system).

import { WASM4_CARTS } from "./data/wasm4carts.ts"; // explicit extension: node runs the tests on this file

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
  id, system, title, author, ...(year ? { year } : {}), licence, url, size, note, relay: true, ...(file ? { file } : {}),
});

export const FREE_GAMES: FreeGame[] = [
  // MAME's own site distributes these with the rights-holders' permission. Only
  // sets that boot in MAME 2003-Plus (our arcade core) are listed — falcnwld and
  // topgunnr are not in this core, and looping's set on mamedev.org does not
  // match what the core expects (it drops to the RetroArch menu). All 17
  // below were swept on the preview (2026-09-04) and reach their attract screens.
  mame("gridlee", "Gridlee", "Videa", 1982, 25516, "Unreleased 1983 arcade shooter; Select inserts a coin"),
  mame("robby", "Robby Roto", "Bally/Midway (Dave Nutting Associates)", 1981, 27915, "Dig through rock, rescue the miners"),
  mame("alienar", "Alien Arena", "Duncan Brown", 1985, 17005, "Two-player arena shooter; Select inserts a coin"),
  mame("carpolo", "Car Polo", "Exidy", 1977, 5562, "Four-player car polo — one of Exidy's first"),
  mame("circus", "Circus", "Exidy", 1977, 6152, "Bounce clowns off a seesaw to pop balloons"),
  mame("crash", "Crash", "Exidy", 1979, 5776, "Drive the maze, dodge the chaser"),
  mame("fax", "FAX", "Exidy", 1983, 198449, "Trivia quiz cabinet — thousands of questions"),
  mame("fireone", "Fire One", "Exidy", 1979, 23227, "Two-player submarine duel"),
  mame("hardhat", "Hard Hat", "Exidy", 1982, 19938, "Construction-site maze chase"),
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
  // Open-source homebrew found by a GitHub sweep (OSI licences, release builds; relayed). Swept on the preview before listing.
  gh("a26-berta", "atari2600", "Berta and Butterflies", "vandalton", 0, "MIT \u2014 https://github.com/vandalton/BertaAndButterflies", "https://github.com/vandalton/BertaAndButterflies/releases/download/v1.00/berta-and-butterflies.v1.00.ntsc.en.bin", 4096, "Game & Watch-style butterfly catching on the 2600", "berta-and-butterflies.a26"),
  gh("c64-quattro", "c64", "Quattro", "jlorenzetti", 0, "MIT \u2014 https://github.com/jlorenzetti/quattro", "https://github.com/jlorenzetti/quattro/releases/download/v0.1.0/quattro-v0.1.0.prg", 15148, "A sober, historically minded falling-blocks game"),
  gh("gb-rhythmland", "gb", "Rhythm Land", "Sinusoid Studios", 0, "MIT \u2014 https://github.com/sinusoid-studios/rhythm-land", "https://github.com/sinusoid-studios/rhythm-land/releases/download/v1.0.1/rhythm-land.gb", 131072, "Rhythm Heaven-style minigames for the Game Boy"),
  gh("gb-rubik", "gb", "Rubik", "NotImplementedLife", 0, "MIT \u2014 https://github.com/NotImplementedLife/rubik", "https://github.com/NotImplementedLife/rubik/releases/download/1.3/rubik_1_3.gb", 32768, "A Rubik's cube in your pocket"),
  gh("gb-crossconnect", "gb", "CrossConnect", "Quinn Painter", 0, "MIT \u2014 https://github.com/QuinnPainter/CrossConnect", "https://github.com/QuinnPainter/CrossConnect/releases/download/1.0/CrossConnect.gbc", 32768, "Wire-crossing puzzles for Game Boy Color"),
  gh("gb-airplanz", "gb", "AIRPLANZ", "NotImplementedLife", 0, "GPL-3.0 \u2014 https://github.com/NotImplementedLife/AIRPLANZ", "https://github.com/NotImplementedLife/AIRPLANZ/releases/download/1.2/AIRPLANZ_1_2.gb", 32768, "Battleship with planes, written in assembly"),
  gh("gba-blindjump", "gba", "Blind Jump", "Evan Bowman", 0, "MIT \u2014 https://github.com/evanbowman/blind-jump-portable", "https://github.com/evanbowman/blind-jump-portable/releases/download/2021.11.20.0/BlindJump.gba", 16565008, "Polished action-adventure roguelike \u2014 one of the best GBA homebrews"),
  gh("gba-notebook", "gba", "Notebook Adventure", "NotImplementedLife", 0, "GPL-3.0 \u2014 https://github.com/NotImplementedLife/NotebookAdventure", "https://github.com/NotImplementedLife/NotebookAdventure/releases/download/v1.3/NotebookAdventure-1-3.gba", 476392, "Platformer drawn in a school notebook (Retro Platform Jam #4)"),
  gh("gba-solarguard", "gba", "Solar Guard", "Deft-Spade", 0, "GPL-3.0 \u2014 https://github.com/Deft-Spade/Solar-Guard", "https://github.com/Deft-Spade/Solar-Guard/releases/download/GBA-JAM-2021/Solar_Guard_GBA_JAM_2021.gba", 4272776, "Defend the sun \u2014 GBA Jam 2021 entry"),
  gh("n64-jam2024", "n64", "N64brew Game Jam 2024", "N64brew community", 0, "MIT \u2014 https://github.com/n64brew/N64brew-GameJam2024", "https://github.com/n64brew/N64brew-GameJam2024/releases/download/1.2.1/gamejam2024.z64", 11943936, "A collection of minigames from the 2024 N64brew jam"),
  gh("n64-sblobber", "n64", "Sblobber64", "vrgl117-games", 0, "MIT \u2014 https://github.com/vrgl117-games/sblobber64", "https://github.com/vrgl117-games/sblobber64/releases/download/n64brew-jam-1/sblobber64.z64", 5819136, "N64brew jam #1 entry \u2014 theme: SIZE"),
  gh("n64-fission", "n64", "Fission Failure 64", "vrgl117-games", 0, "MIT \u2014 https://github.com/vrgl117-games/FissionFailure64", "https://github.com/vrgl117-games/FissionFailure64/releases/download/n64brew-jam-2/FissionFailure64.z64", 15335424, "N64brew jam #2 entry \u2014 keep the reactor under CONTROL"),
  gh("nds-traffic", "nds", "Traffic Escape DS", "Warioware64", 0, "Apache-2.0 \u2014 https://github.com/Warioware64/Traffic-Escape-DS", "https://github.com/Warioware64/Traffic-Escape-DS/releases/download/v1.2/Traffic_Escape_DS.nds", 19252224, "Rush Hour-style sliding traffic puzzles"),
  gh("nds-jamclown", "nds", "JamClown", "lorenzolanglois", 0, "MIT \u2014 https://github.com/lorenzolanglois/JamClown", "https://github.com/lorenzolanglois/JamClown/releases/download/v1.0/jamclown.nds", 409600, "A weekend game-jam DS game"),
  gh("nes-witchnwiz", "nes", "Witch n' Wiz", "Matt Hughson", 0, "MIT \u2014 https://github.com/mhughson/mbh-A53-witchnwiz", "https://github.com/mhughson/mbh-A53-witchnwiz/releases/download/v1.0.0-nesdevcompo/witchnwiz_2021_02_22_nes_dev_v_1_0_0.nes", 65552, "Puzzle-platformer \u2014 NESdev 2020 competition runner-up", "witchnwiz.nes"),
  gh("nes-snake", "nes", "openNES Snake", "Sebastian Dine", 0, "Zlib \u2014 https://github.com/sebastiandine/openNES-Snake", "https://github.com/sebastiandine/openNES-Snake/releases/download/v1.0.9/openNES-Snake-1.0.9.nes", 24592, "Classic snake in C for the NES"),
  gh("nes-pong", "nes", "NES Pong", "zorchenhimer", 0, "BSD-3-Clause \u2014 https://github.com/zorchenhimer/nes-pong", "https://github.com/zorchenhimer/nes-pong/releases/download/v1.2/pong_ntsc.nes", 24592, "Pong from scratch"),
  gh("nes-ghosts", "nes", "Ghosts and Graves", "Anthony Bongers", 0, "Unlicense \u2014 https://github.com/AnthonyBongers/GhostsAndGraves", "https://github.com/AnthonyBongers/GhostsAndGraves/releases/download/release_1.0.3/Ghosts_And_Graves.nes", 73744, "Tents-and-Trees logic puzzles, in 6502 assembly"),
  gh("nes-dabg", "nes", "Double Action Blaster Guys", "NovaSquirrel", 0, "Zlib \u2014 https://github.com/NovaSquirrel/DABG", "https://github.com/NovaSquirrel/DABG/releases/download/v2/dabg.nes", 32784, "Arcade-style platformer from the Nova the Squirrel author"),
  gh("psx-tetrade", "psx", "Tetrade", "Logan Campbell", 0, "MIT \u2014 https://github.com/Logan-Campbell/Tetrade", "https://github.com/Logan-Campbell/Tetrade/releases/download/v1.0/TETRADE_PSX.bin", 3196368, "Homebrew falling blocks for the original PlayStation", "tetrade.img"),
  gh("md-kleleatoms", "segaMD", "KleleAtoms", "Nightwolf-47", 0, "MIT \u2014 https://github.com/Nightwolf-47/KleleAtoms-MD", "https://github.com/Nightwolf-47/KleleAtoms-MD/releases/download/v1.2.1/kleleatoms-md-121.bin", 262144, "Chain-reaction strategy board game (SGDK)"),
  // Commodore 64 homebrew (MIT) — GitHub release builds, relayed
  gh("c64-retaliate", "c64", "Retaliate64", "Marcelo Lv Cabral", 2021, "MIT — https://github.com/lvcabral/retaliate64", "https://github.com/lvcabral/retaliate64/releases/download/v1.0.0/retaliatece.d64", 174848, "Space shooter remake — Community Edition disk"),
  gh("c64-wildboa", "c64", "Wild Boa Snake", "Tomasz Stamborski", 2021, "MIT — https://github.com/tstamborski/Wild-Boa-Snake", "https://github.com/tstamborski/Wild-Boa-Snake/releases/download/1.0/Wild.Snake.Boa.d64", 174848, "Snake, C64 style", "wild-boa-snake.d64"),
  // WASM-4 carts archive (CC BY-NC-SA 4.0, authors credited) — the whole archive, served by GitHub with CORS
  ...WASM4_CARTS.map((c) => w4(c.slug, c.title, c.author, c.size, c.note)),
];

export const freeGamesFor = (systems: readonly string[]): FreeGame[] => FREE_GAMES.filter((g) => systems.includes(g.system));

/** The URL the browser actually fetches: direct, or through the relay for hosts without CORS. */
export const downloadUrl = (g: FreeGame) => (g.relay ? `/api/rom?url=${encodeURIComponent(g.url)}` : g.url);

export const fileNameOf = (g: Pick<FreeGame, "url" | "file"> & { id?: string }) =>
  g.file ?? decodeURIComponent(g.url.split("/").pop() ?? `${g.id}.bin`).split("?")[0];
