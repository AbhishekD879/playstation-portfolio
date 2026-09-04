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
};

export const WEB_GAME_IDS = Object.keys(WEB_GAMES);
