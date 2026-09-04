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
  size?: number;       // bytes, when known — shown before download
  note: string;        // one line for the player
  relay?: boolean;     // host sends no Access-Control-Allow-Origin → fetch via /api/rom
}

/** Hosts the /api/rom relay will fetch from. Anything else is refused there too. */
export const RELAY_HOSTS = ["www.mamedev.org", "mamedev.org"];

export const FREE_GAMES: FreeGame[] = [
  // MAME's own site distributes these with the rights-holders' permission
  { id: "mame-gridlee", system: "mame", title: "Gridlee", author: "Videa", year: 1983, licence: "Freely released by the rights holder — distributed by mamedev.org", url: "https://www.mamedev.org/roms/gridlee/gridlee.zip", size: 25516, note: "Unreleased 1983 arcade shooter; Select inserts a coin", relay: true },
  { id: "mame-robby", system: "mame", title: "Robby Roto", author: "Bally/Midway (Dave Nutting Associates)", year: 1981, licence: "Freely released by the rights holder — distributed by mamedev.org", url: "https://www.mamedev.org/roms/robby/robby.zip", size: 27915, note: "Dig through rock, rescue the miners", relay: true },
  { id: "mame-alienar", system: "mame", title: "Alien Arena", author: "Duncan Brown", year: 1985, licence: "Freely released by the author — distributed by mamedev.org", url: "https://www.mamedev.org/roms/alienar/alienar.zip", size: 17005, note: "Two-player arena shooter; Select inserts a coin", relay: true },
];

export const freeGamesFor = (systems: readonly string[]): FreeGame[] => FREE_GAMES.filter((g) => systems.includes(g.system));

/** The URL the browser actually fetches: direct, or through the relay for hosts without CORS. */
export const downloadUrl = (g: FreeGame) => (g.relay ? `/api/rom?url=${encodeURIComponent(g.url)}` : g.url);

export const fileNameOf = (g: FreeGame) => decodeURIComponent(g.url.split("/").pop() ?? `${g.id}.bin`).split("?")[0];
