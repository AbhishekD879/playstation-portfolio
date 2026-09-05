// How the Games column is grouped. Pure data, so the invariant that matters —
// every game lives in exactly one place — can be tested without a browser.
//
// The column shows GAME_TOP in order. A "folder" entry opens in place and lists
// its member items (ids of XmbItems defined in XMB.tsx); an "item" entry is a
// game item shown at the top level as-is. Anything defined in XMB.tsx but listed
// nowhere here is still shown, loose at the end of the column, so a new item can
// never silently disappear — but the test below fails, so it gets filed.
//
// Grouping follows how a PlayStation groups its games: by platform family for
// emulated systems, by kind for everything else. New shelves (Arcade, More
// Consoles, Computers, Mobile) slot in here as they land.

export interface GameFolder {
  kind: "folder";
  id: string;        // route segment: #/game/<id>
  title: string;
  icon: string;      // key into icons.tsx
  blurb: string;     // what is inside, in the player's words
  items: string[];   // XmbItem ids, in display order
}
export interface GameTopItem { kind: "item"; id: string }
export type GameTopEntry = GameFolder | GameTopItem;

export const GAME_TOP: GameTopEntry[] = [
  { kind: "folder", id: "playstation", title: "PlayStation", icon: "disc", blurb: "PlayStation · PlayStation 2 · PSP", items: ["ps2", "ps1", "psp"] },
  { kind: "item", id: "nintendo" },
  { kind: "item", id: "sega" },
  { kind: "item", id: "arcade" },
  { kind: "item", id: "consoles" },
  { kind: "item", id: "computers" },
  { kind: "item", id: "mobile" },
  { kind: "folder", id: "pc", title: "PC Games", icon: "monitor", blurb: "DOOM · Counter-Strike · point & click · Wolf3D · Quake · Duke 3D · Descent · Diablo · OpenHV · HexGL", items: ["doom", "doomrtx", "cs", "scummvm", "micropolis", "jazz", "wolf", "quake", "openttd", "diablo", "jazz2", "descent", "duke", "gorescript", "hexgl", "openhv"] },
  { kind: "folder", id: "makers", title: "Game Makers & Web", icon: "cube", blurb: "WASM-4 · RPG Maker · Ren'Py · Godot · Unity · HTML5 · Flash", items: ["fantasy", "rpgmaker", "renpy", "godot", "unity", "html5", "flash"] },
  { kind: "folder", id: "together", title: "Play Together", icon: "users", blurb: "Party · board games · netplay · Console TV · Lichess TV", items: ["party", "board", "retrojoin", "consoletv", "lichesstv"] },
  { kind: "folder", id: "originals", title: "Console Originals", icon: "star", blurb: "Chess vs Stockfish · Trivia Arcade · World Drive", items: ["chess", "trivia", "worlddrive"] },
];

/** Items that stay reachable by their route but are not listed in the column.
 *  "retro" is the old every-system shelf, superseded by Nintendo and Sega. */
export const HIDDEN_GAME_ITEMS = new Set(["retro"]);

export const folderOf = (itemId: string): GameFolder | undefined =>
  GAME_TOP.find((e): e is GameFolder => e.kind === "folder" && e.items.includes(itemId));

/** Every item id the column knows how to place, folders and loose items alike. */
export const placedGameItemIds = (): Set<string> =>
  new Set(GAME_TOP.flatMap((e) => (e.kind === "folder" ? e.items : [e.id])));
