// Games that are whole web apps of their own — engine recreations with free data
// — hosted under public/ and opened full-screen in a same-origin frame. Nothing to
// upload: they play the moment you pick them, which is what a visitor who owns no
// ROMs needs. Each entry records the licence we redistribute under.
export interface WebGame {
  id: string;        // also the app id / route (#/app/<id>)
  title: string;
  sub: string;       // one line on the crossbar
  url: string;       // same-origin page under public/
  icon: string;      // key into icons.tsx
  licence: string;
  source: string;    // upstream project
}

export const WEB_GAMES: Record<string, WebGame> = {
  micropolis: {
    id: "micropolis", title: "Micropolis", sub: "The original SimCity, open-sourced — build a city, right here, nothing to bring",
    url: "/micropolis/index.html", icon: "grid", licence: "GPL-3.0 (Micropolis terms)", source: "https://github.com/SimHacker/MicropolisCore",
  },
  jazz: {
    id: "jazz", title: "Jazz Jackrabbit", sub: "Epic's 1994 run-and-gun — the shareware episode, playable now (OpenJazz)",
    url: "/jazz/index.html", icon: "star", licence: "OpenJazz GPL-2.0 · shareware episode under Epic's shareware licence", source: "https://github.com/AlisterT/openjazz",
  },
  wolf: {
    id: "wolf", title: "Wolfenstein 3D", sub: "id's 1992 shooter — shareware episode, playable now (ECWolf)",
    url: "/wolf/index.html", icon: "skull", licence: "ECWolf GPL-2.0 · shareware episode under id Software's shareware terms", source: "https://github.com/54ac/ecwolf-js",
  },
  quake: {
    id: "quake", title: "Quake", sub: "id's 1996 shooter in WebAssembly — shareware episode or LibreQuake, nothing to bring (Qwasm)",
    url: "/quake/index.html", icon: "lightning", licence: "Qwasm GPL-2.0 · quake106.zip shareware under id's shareware terms · LibreQuake data", source: "https://github.com/GMH-Code/Qwasm",
  },
  openttd: {
    id: "openttd", title: "OpenTTD", sub: "Transport Tycoon Deluxe, open-sourced — build a rail empire, saves stay in your browser",
    url: "/openttd/index.html", icon: "globe", licence: "OpenTTD GPL-2.0 · OpenGFX GPL-2.0", source: "https://github.com/swords02/openttd-online",
  },
  diablo: {
    id: "diablo", title: "Diablo", sub: "The 1996 dungeon crawl — shareware Warrior, all sixteen levels of the Cathedral's demo (DevilutionX)",
    url: "/diablo/index.html", icon: "skull", licence: "DevilutionX Sustainable Use License 1.0 (non-commercial) · spawn.mpq shareware data as distributed by the project", source: "https://github.com/diasurgical/devilutionX",
  },
  jazz2: {
    id: "jazz2", title: "Jazz Jackrabbit 2", sub: "The 1998 sequel, rebuilt in C++ — shareware demo episode, playable now (Jazz² Resurrection)",
    url: "/jazz2/index.html", icon: "star", licence: "Jazz² Resurrection GPL-3.0 · shareware demo data under Epic's shareware terms", source: "https://github.com/deathkiller/jazz2-native",
  },
  descent: {
    id: "descent", title: "Descent", sub: "Parallax's 1995 six-degrees-of-freedom mine crawler — shareware episode, rebuilt in three.js",
    url: "/descent/index.html", icon: "cube", licence: "three-descent MIT (OPL3 synth LGPL-2.1+) · Episode 1 shareware data as distributed by the project", source: "https://github.com/mrdoob/three-descent",
  },
  duke: {
    id: "duke", title: "Duke Nukem 3D", sub: "1996's Build-engine icon — the shareware episode, all eleven levels (EDuke32)",
    url: "/duke/index.html", icon: "skull", licence: "EDuke32 GPL-2.0 · shareware DUKE.GRP 1.3D under 3D Realms' shareware terms", source: "https://github.com/DigitalCyberSoft/eduke32-wasm",
  },
  gorescript: {
    id: "gorescript", title: "Gorescript", sub: "A retro first-person shooter with an eighteen-level campaign, built on three.js",
    url: "/gorescript/index.html", icon: "triangle", licence: "MIT — engine and assets", source: "https://github.com/gorescript/gorescript",
  },
  hexgl: {
    id: "hexgl", title: "HexGL", sub: "Futuristic anti-gravity racing — the three.js showpiece, at full speed",
    url: "/hexgl/index.html", icon: "spark", licence: "MIT — engine, textures, geometry and audio", source: "https://github.com/BKcore/HexGL",
  },
  openhv: {
    id: "openhv", title: "OpenHV", sub: "A sci-fi real-time strategy game on the OpenRA engine — every asset original and freely licensed",
    url: "/openhv/index.html", icon: "chip", licence: "OpenRA engine and OpenHV mod GPL-3.0 · Hard Vacuum art and audio under Creative Commons", source: "https://github.com/OpenHV/OpenHV",
  },
};

export const WEB_GAME_IDS = Object.keys(WEB_GAMES);
