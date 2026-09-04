// URL routes for the crossbar. Pure — no DOM, no signals — so it can be tested in
// node and so a deep link means the same thing everywhere it is parsed.
//
//   #/app/<id>            an app is open (the id is one of ROUTE_APPS)
//   #/<cat>               a crossbar category is focused
//   #/<cat>/<folder>      a folder inside that category is open (Games only today)
//   #/room/<CODE>         a PS2 online room invite
//
// Folders exist because the Games column outgrew a flat list: PlayStation groups
// its games, so do we. The folder id is part of the address so "send me the link
// to the PC games" works and Back/Forward walks in and out of a folder.

export const ROUTE_APPS = new Set([
  "doom", "doomrtx", "worlddrive", "chess", "trivia", "flash", "cinema", "podcasts", "library", "map", "ai", "webamp",
  "youtube", "timemachine", "art", "wiki", "lichess", "ps2", "pc", "guestbook", "browser", "visualizer", "studio", "code",
  "manual", "ps2home", "ps1home", "psphome", "retrohome", "nintendohome", "segahome", "scummvm", "karaoke", "strudel",
  "settingshub", "videoplayer", "reporewind", "rpgmaker", "renpy", "godot", "unity", "html5", "privacy", "watch", "syscity",
  "cs", "party", "board", "voiceavatar", "retrojoin", "consoletv", "analytics",
]);

export const routeSlug = (a: string) => (a === "ps2" ? "ps2home" : a);

export const appRouteHash = (a: string | null, catId: string, folder: string | null = null) =>
  a ? `#/app/${routeSlug(a)}` : folder ? `#/${catId}/${folder}` : `#/${catId}`;

export type Route = { app: string } | { cat: string; folder?: string } | { room: string };

/** Parse a location hash → what it addresses. null = not an app/category route (empty, or a #setup= link). */
export function parseRouteHash(hash: string): Route | null {
  if (!hash || /^#setup=/.test(hash)) return null;
  // ★ A room's own address. Codes are minted from an unambiguous alphabet, so
  // anything else in those four characters is not a room and is ignored rather
  // than opening an empty session.
  const rm = hash.match(/^#\/room\/([A-Z0-9]{4})$/i);
  if (rm) return { room: rm[1].toUpperCase() };
  const am = hash.match(/^#\/app\/([a-z0-9-]+)/i);
  if (am) { const id = routeSlug(am[1].toLowerCase()); return ROUTE_APPS.has(id) ? { app: id } : null; }
  const cm = hash.match(/^#\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/i);
  // "app" and "room" are namespaces, never categories — a malformed room code or
  // unknown app must fall through as "not a route", not open a phantom folder
  if (cm && !/^(app|room)$/i.test(cm[1])) return cm[2] ? { cat: cm[1].toLowerCase(), folder: cm[2].toLowerCase() } : { cat: cm[1].toLowerCase() };
  return null;
}
