// The cross-media bar. Horizontal categories, vertical items, info panels,
// trophies, disc drive. Navigation: arrows/WASD + Enter/Esc, or a gamepad.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CATEGORIES, TROPHIES, type XmbItem } from "../content";
import { AVATARS, PLATINUM, award, resizePhoto, updateProfile, type Profile } from "../profiles";
import { CORES, CORE_NAMES, addGame, listGames, addPhoto, listPhotos, type GameRecord, type PhotoRecord } from "../gamesdb";
import { THEMES, applyTheme, currentThemeIndex } from "../theme";
import { CHANNELS, fetchDevto, fetchGuide, fetchHN, fetchRadio, fetchRss, fetchWeather, wmo, type NewsEntry, type Weather } from "../apps";
import * as sfx from "../audio";
import { onNav, onPadChange, setNavEnabled } from "../input";
import { Icon } from "./icons";
import Tv from "./Tv";
import Guide from "./Guide";
import Photos from "./Photos";
import GamepadTest from "./GamepadTest";
import Ps2 from "./Ps2";
import PcApp from "./PcApp";
import Guestbook from "./Guestbook";
import Doom from "./Doom";
import ChessApp from "./ChessApp";
import Trivia from "./Trivia";
import Flash from "./Flash";
import Cinema from "./Cinema";
import Podcasts from "./Podcasts";
import Library from "./Library";
import MapApp from "./MapApp";
import AiChat from "./AiChat";
import WinampApp from "./WinampApp";
import YouTubeApp from "./YouTubeApp";
import TimeMachine from "./TimeMachine";
import ArtGallery from "./ArtGallery";
import WikiApp from "./WikiApp";
import { fetchApod, define, type Apod, type Definition } from "../apps";
import { startGestures, stopGestures } from "../gestures";

const CAT_SPACING = 150;

interface Toast { id: number; title: string; sub: string; tier?: string }
let toastSeq = 1;

export default function XMB(props: {
  profile: Profile;
  onSwitchUser: () => void;
  onPlay: (g: GameRecord) => void;
}) {
  const [cat, setCat] = createSignal(1); // land on Career
  const [sels, setSels] = createSignal<Record<string, number>>({});
  const [panel, setPanel] = createSignal<{ heading: string; tag?: string; body: string[] } | null>(null);
  const [trophiesOpen, setTrophiesOpen] = createSignal(false);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [games, setGames] = createSignal<GameRecord[]>([]);
  const [clock, setClock] = createSignal("");
  const [spotify, setSpotify] = createSignal<{ url: string; label: string } | null>(null);
  const [inputMode, setInputMode] = createSignal<null | "spotify" | "tv" | "rss" | "yt">(null);
  const [themesOpen, setThemesOpen] = createSignal(false);
  const [themeIdx, setThemeIdx] = createSignal(0);
  const [links, setLinks] = createSignal<{ url: string; label: string }[]>(
    JSON.parse(localStorage.getItem("asp.spotify") ?? "[]"),
  );
  const [tvChans, setTvChans] = createSignal<{ url: string; label: string }[]>(
    JSON.parse(localStorage.getItem("asp.tv") ?? "[]"),
  );
  const [rssFeeds, setRssFeeds] = createSignal<{ url: string; label: string }[]>(
    JSON.parse(localStorage.getItem("asp.rss") ?? "[]"),
  );
  const [tv, setTv] = createSignal<{ url: string; label: string } | null>(null);
  const [guideOpen, setGuideOpen] = createSignal<null | "tv" | "radio">(null);
  let guideNav: ((a: Parameters<Parameters<typeof onNav>[0]>[0]) => void) | undefined;
  const [radioOn, setRadioOn] = createSignal(false);
  const [station, setStation] = createSignal<{ url: string; label: string } | null>(null);
  const [recentStations, setRecentStations] = createSignal<{ url: string; label: string }[]>(
    JSON.parse(localStorage.getItem("asp.radiohist") ?? "[]"),
  );
  const [photos, setPhotos] = createSignal<PhotoRecord[]>([]);
  const [viewerOpen, setViewerOpen] = createSignal(false);
  let viewerNav: ((a: Parameters<Parameters<typeof onNav>[0]>[0]) => void) | undefined;
  const [statusWeather, setStatusWeather] = createSignal("");
  const [padName, setPadName] = createSignal<string | null>(null);
  const [ytQuery, setYtQuery] = createSignal(""); // AI agent → YouTube search handoff
  const [padTest, setPadTest] = createSignal(false);
  const [app, setApp] = createSignal<null | "doom" | "chess" | "trivia" | "flash" | "cinema" | "podcasts" | "library" | "map" | "ai" | "webamp" | "youtube" | "timemachine" | "art" | "wiki" | "lichess" | "ps2" | "pc" | "guestbook">(null);
  let appNav: ((a: Parameters<Parameters<typeof onNav>[0]>[0]) => void) | undefined;
  const [apod, setApod] = createSignal<{ loading: boolean; data?: Apod } | null>(null);
  const [dict, setDict] = createSignal<{ result?: Definition | null; looking: boolean } | null>(null);
  const [yt, setYt] = createSignal<string | null>(null);
  const [gesturesOn, setGesturesOn] = createSignal(false);
  const [gestureTut, setGestureTut] = createSignal(false);
  let gestureBox!: HTMLDivElement;
  let dictInput!: HTMLInputElement;
  const [saver, setSaver] = createSignal(false);
  let lastActive = Date.now();
  let radioEl!: HTMLAudioElement;
  let galleryInput!: HTMLInputElement;
  let restoreInput!: HTMLInputElement;
  const [news, setNews] = createSignal<{ label: string; entries: NewsEntry[]; sel: number; loading: boolean; error?: string } | null>(null);
  const [weather, setWeather] = createSignal<{ loading: boolean; data?: Weather } | null>(null);
  let fileInput!: HTMLInputElement;
  let photoInput!: HTMLInputElement;
  let linkInput!: HTMLInputElement;
  const [avatarVer, setAvatarVer] = createSignal(0);

  const gameItems = createMemo<XmbItem[]>(() => [
    { id: "doom", title: "DOOM", sub: "1993 shareware · DOS in your browser (WASM)", icon: "skull", action: { type: "doom" } },
    { id: "chess", title: "Chess vs Stockfish", sub: "The real engine, running on this device", icon: "knight", action: { type: "chess" } },
    { id: "lichesstv", title: "Lichess TV", sub: "Watch live grandmaster games", icon: "knight", action: { type: "lichess-tv" } },
    { id: "trivia", title: "Trivia Arcade", sub: "10 questions · Open Trivia DB", icon: "question", action: { type: "trivia" } },
    { id: "flash", title: "Flash Arcade", sub: "Ruffle WASM + the Internet Archive", icon: "lightning", action: { type: "flash" } },
    { id: "ps2", title: "PlayStation 2", sub: "Experimental emulator · desktop only", icon: "disc", action: { type: "ps2" } },
    { id: "pc", title: "Other OS", sub: "A whole x86 PC — KolibriOS, runs in the console", icon: "power", action: { type: "pc" } },
    { id: "insert", title: "Insert Disc…", sub: "Load a ROM you own — read locally, never uploaded", icon: "plus", action: { type: "insert-disc" } },
    ...games().map((g) => ({
      id: `g-${g.id}`,
      title: g.name.replace(/\.[^.]+$/, ""),
      sub: `${CORE_NAMES[g.core] ?? g.core} · ${(g.size / 1048576).toFixed(1)} MB · played ${g.plays ?? 0}×`,
      icon: "disc",
      action: { type: "play-game" as const, gameId: g.id },
    })),
  ]);

  const musicItems = createMemo<XmbItem[]>(() => [
    { id: "radio-guide", title: "Radio Stations", sub: "Search ~3,000 live stations worldwide", icon: "globe", action: { type: "radio-guide" } },
    { id: "podcasts", title: "Podcasts", sub: "Search any show — plays in the background", icon: "rss", action: { type: "podcasts" } },
    { id: "winamp", title: "Winamp", sub: "The 1997 legend, resurrected in JS", icon: "lightning", action: { type: "webamp" } },
    ...(station()
      ? [{ id: "radio-stop", title: `■ Stop — ${station()!.label}`, sub: "Now playing", icon: "speaker", action: { type: "radio-play" as const, url: "", label: "" } }]
      : []),
    ...recentStations()
      .filter((r) => r.label !== station()?.label)
      .map((r, i) => ({
        id: `rh-${i}`, title: r.label, sub: "Recently played station", icon: "note",
        action: { type: "radio-play" as const, url: r.url, label: r.label },
      })),
    { id: "radio", title: "Console Radio", sub: "Generative lo-fi — synthesized live", icon: "note", action: { type: "music-toggle" } },
    {
      id: "sp-default", title: "lofi beats", sub: "Spotify · curated focus playlist", icon: "disc",
      action: { type: "spotify", url: "https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn", label: "lofi beats" },
    },
    ...links().map((l, i) => ({
      id: `sp-${i}`,
      title: l.label,
      sub: "Spotify · your link",
      icon: "disc",
      action: { type: "spotify" as const, url: l.url, label: l.label },
    })),
    { id: "sp-link", title: "Connect Spotify…", sub: "Paste any playlist, album or track link", icon: "plus", action: { type: "spotify-link" } },
  ]);

  const tvItems = createMemo<XmbItem[]>(() => [
    { id: "tv-guide", title: "Channel Guide", sub: "Search ~17,000 live channels worldwide", icon: "globe", action: { type: "tv-guide" } },
    ...CHANNELS.map((c, i) => ({
      id: `tv-${i}`, title: c.label, sub: c.sub, icon: "tv",
      action: { type: "tv" as const, url: c.url, label: c.label },
    })),
    ...tvChans().map((c, i) => ({
      id: `tvu-${i}`, title: c.label, sub: "Your channel · HLS", icon: "tv",
      action: { type: "tv" as const, url: c.url, label: c.label },
    })),
    { id: "tv-add", title: "Add Channel…", sub: "Paste an HLS (.m3u8) stream URL", icon: "plus", action: { type: "tv-add" } },
  ]);

  const newsItems = createMemo<XmbItem[]>(() => [
    { id: "hn", title: "Hacker News", sub: "Front page, live", icon: "rss", action: { type: "news", source: "hn", label: "Hacker News" } },
    { id: "devto", title: "DEV Community", sub: "Top posts this week", icon: "rss", action: { type: "news", source: "devto", label: "DEV Community" } },
    { id: "library", title: "Library", sub: "Search & read books — Open Library", icon: "book", action: { type: "books" } },
    ...rssFeeds().map((f, i) => ({
      id: `rss-${i}`, title: f.label, sub: "Your feed · RSS", icon: "rss",
      action: { type: "news" as const, source: "rss" as const, label: f.label, url: f.url },
    })),
    { id: "rss-add", title: "Add RSS Feed…", sub: "Any RSS or Atom URL", icon: "plus", action: { type: "news-add" } },
  ]);

  const photoItems = createMemo<XmbItem[]>(() => [
    ...(photos().length
      ? [{ id: "slideshow", title: "Slideshow", sub: `${photos().length} photo${photos().length > 1 ? "s" : ""} · Ken Burns drift`, icon: "camera", action: { type: "photos-view" as const } }]
      : []),
    { id: "photos-add", title: "Add Photos…", sub: "Stored in this browser only — never uploaded", icon: "plus", action: { type: "photos-add" } },
    { id: "art", title: "Art Gallery", sub: "Masterpieces · The Met, New York", icon: "spark", action: { type: "art" } },
    { id: "apod", title: "Astronomy Photo of the Day", sub: "Live from NASA", icon: "spark", action: { type: "apod" } },
  ]);

  const itemsOf = (ci: number): XmbItem[] =>
    CATEGORIES[ci].id === "game" ? gameItems()
    : CATEGORIES[ci].id === "music" ? musicItems()
    : CATEGORIES[ci].id === "tv" ? tvItems()
    : CATEGORIES[ci].id === "news" ? newsItems()
    : CATEGORIES[ci].id === "photo" ? photoItems()
    : CATEGORIES[ci].items;

  const selOf = (ci: number) => Math.min(sels()[CATEGORIES[ci].id] ?? 0, Math.max(0, itemsOf(ci).length - 1));

  const refreshGames = () => listGames(props.profile.id).then(setGames);
  const refreshPhotos = () => listPhotos(props.profile.id).then(setPhotos);
  onMount(() => { refreshGames(); refreshPhotos(); });

  // —— radio playback: persists while you browse, PS3-music style ——
  function playStation(c: { url: string; label: string }) {
    if (sfx.radioPlaying()) { sfx.radioToggle(); setRadioOn(false); } // synth off
    setStation(c);
    radioEl.src = c.url;
    radioEl.play().catch(() => { pushToast("Station unreachable", "Try another one"); setStation(null); });
    const next = [c, ...recentStations().filter((r) => r.label !== c.label)].slice(0, 4);
    setRecentStations(next);
    localStorage.setItem("asp.radiohist", JSON.stringify(next));
  }
  function stopStation() {
    radioEl.pause();
    radioEl.src = "";
    setStation(null);
  }

  // —— playtime tracking ——
  const ptId = setInterval(() => {
    props.profile.playtime = (props.profile.playtime ?? 0) + 30;
    updateProfile(props.profile);
  }, 30_000);
  onCleanup(() => clearInterval(ptId));

  // —— clock (12/24h — Date and Time Settings) ——
  const [clock24, setClock24] = createSignal(localStorage.getItem("asp.clock24") !== "12");
  const tickClock = () => {
    const d = new Date();
    const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
    const t = clock24() ? `${String(h).padStart(2, "0")}:${mm}` : `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`;
    setClock(`${d.getDate()}/${d.getMonth() + 1}  ${t}`);
  };
  tickClock();
  const clockId = setInterval(tickClock, 5000);
  onCleanup(() => clearInterval(clockId));

  // —— battery: PS3-style status icon via the Battery API (Chromium only —
  // icon simply doesn't render where the API doesn't exist) ——
  const [battery, setBattery] = createSignal<{ level: number; charging: boolean } | null>(null);
  let battCleanup: (() => void) | undefined;
  (navigator as any).getBattery?.().then((b: any) => {
    const upd = () => setBattery({ level: b.level, charging: b.charging });
    upd();
    b.addEventListener("levelchange", upd);
    b.addEventListener("chargingchange", upd);
    battCleanup = () => { b.removeEventListener("levelchange", upd); b.removeEventListener("chargingchange", upd); };
  });
  onCleanup(() => battCleanup?.());

  // —— toasts & trophies ——
  const pushToast = (title: string, sub: string, tier?: string) => {
    const t: Toast = { id: toastSeq++, title, sub, tier };
    setToasts((x) => [...x, t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 4200);
  };
  // award() mutates the profile object — bump a version signal so counts react
  const [trophyVer, setTrophyVer] = createSignal(0);
  const awardT = (id: string) => {
    const hadPlat = !!props.profile.trophies["platinum"];
    const def = award(props.profile, id);
    setTrophyVer((v) => v + 1);
    if (def) {
      sfx.trophy();
      pushToast(`Trophy earned — ${def.name}`, def.desc, def.tier);
      if (!hadPlat && props.profile.trophies["platinum"]) {
        setTimeout(() => { sfx.trophy(); pushToast(`PLATINUM — ${PLATINUM.name}`, PLATINUM.desc, "platinum"); }, 1400);
      }
    }
  };
  onMount(() => awardT("boot"));

  const markSeen = (id: string) => {
    props.profile.seen[id] = true;
    updateProfile(props.profile);
    const all = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`).every((k) => props.profile.seen[k]);
    if (all("career", 5)) awardT("historian");
    if (all("project", 5)) awardT("curious");
    if (all("skill", 5)) awardT("polyglot");
  };

  // —— actions ——
  function act(item: XmbItem) {
    const a = item.action;
    switch (a.type) {
      case "panel":
        sfx.confirm();
        setPanel({ heading: a.heading, tag: a.tag, body: a.body });
        markSeen(item.id);
        break;
      case "link":
        sfx.confirm();
        awardT("network");
        window.open(a.href, a.href.startsWith("http") ? "_blank" : "_self");
        break;
      case "insert-disc":
        sfx.confirm();
        fileInput.click();
        break;
      case "play-game": {
        sfx.confirm();
        const g = games().find((x) => x.id === a.gameId);
        if (g) { awardT("disc"); props.onPlay(g); }
        break;
      }
      case "music-toggle": {
        const on = sfx.radioToggle();
        setRadioOn(on);
        sfx.confirm();
        if (on) awardT("dj");
        pushToast("Console Radio", on ? "Now playing — generative lo-fi" : "Radio off");
        break;
      }
      case "spotify":
        sfx.confirm();
        awardT("dj");
        setSpotify({ url: a.url, label: a.label });
        break;
      case "spotify-link":
      case "tv-add":
      case "news-add":
        sfx.confirm();
        setInputMode(a.type === "spotify-link" ? "spotify" : a.type === "tv-add" ? "tv" : "rss");
        setTimeout(() => { setNavEnabled(false); linkInput.focus(); }, 50);
        break;
      case "tv":
        sfx.confirm();
        awardT("zapper");
        setTv({ url: a.url, label: a.label });
        break;
      case "tv-guide":
        sfx.confirm();
        setGuideOpen("tv");
        break;
      case "radio-guide":
        sfx.confirm();
        setGuideOpen("radio");
        break;
      case "radio-play":
        sfx.confirm();
        if (!a.url) stopStation();
        else { awardT("worldband"); playStation({ url: a.url, label: a.label }); }
        break;
      case "photos-add":
        sfx.confirm();
        galleryInput.click();
        break;
      case "photos-view":
        sfx.confirm();
        setViewerOpen(true);
        break;
      case "doom":
        sfx.confirm();
        awardT("doomguy");
        setApp("doom");
        break;
      case "chess":
        sfx.confirm();
        setApp("chess");
        break;
      case "trivia":
        sfx.confirm();
        setApp("trivia");
        break;
      case "flash":
        sfx.confirm();
        setApp("flash");
        break;
      case "video-ia":
        sfx.confirm();
        setApp("cinema");
        break;
      case "video-yt":
        sfx.confirm();
        setInputMode("yt");
        setTimeout(() => { setNavEnabled(false); linkInput.focus(); }, 50);
        break;
      case "podcasts":
        sfx.confirm();
        setApp("podcasts");
        break;
      case "books":
        sfx.confirm();
        awardT("bookworm");
        setApp("library");
        break;
      case "map":
        sfx.confirm();
        setApp("map");
        break;
      case "ai-chat":
        sfx.confirm();
        setApp("ai");
        break;
      case "webamp":
        sfx.confirm();
        awardT("dj");
        setApp("webamp");
        break;
      case "youtube":
        sfx.confirm();
        setApp("youtube");
        break;
      case "timemachine":
        sfx.confirm();
        awardT("timetraveler");
        setApp("timemachine");
        break;
      case "art":
        sfx.confirm();
        awardT("curator");
        setApp("art");
        break;
      case "wiki":
        sfx.confirm();
        setApp("wiki");
        break;
      case "lichess-tv":
        sfx.confirm();
        setApp("lichess");
        break;
      case "dictionary":
        sfx.confirm();
        setDict({ looking: false });
        setTimeout(() => { setNavEnabled(false); dictInput.focus(); }, 50);
        break;
      case "apod":
        sfx.confirm();
        awardT("stargazer");
        setApod({ loading: true });
        fetchApod()
          .then((data) => setApod({ loading: false, data }))
          .catch(() => { setApod(null); pushToast("NASA is busy", "APOD rate-limited right now — try later"); });
        break;
      case "gamepad-test":
        sfx.confirm();
        setPadTest(true);
        break;
      case "ps2":
        sfx.confirm();
        setApp("ps2");
        break;
      case "pc":
        sfx.confirm();
        setApp("pc");
        break;
      case "guestbook":
        sfx.confirm();
        setApp("guestbook");
        break;
      case "gesture-toggle":
        if (gesturesOn()) {
          stopGestures();
          setGesturesOn(false);
          gestureBox.innerHTML = "";
          pushToast("Camera navigation off", "");
        } else {
          sfx.confirm();
          setGestureTut(true); // tutorial first, camera second
        }
        break;
      case "whats-new": {
        sfx.confirm();
        const p = props.profile;
        const recent = Object.entries(p.trophies)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([id, ts]) => {
            const t = id === "platinum" ? PLATINUM : TROPHIES.find((x) => x.id === id);
            return `🏆 ${t?.name ?? id} — ${new Date(ts).toLocaleDateString()}`;
          });
        const mins = Math.round((p.playtime ?? 0) / 60);
        setPanel({
          heading: "What's New",
          tag: `${p.name.toUpperCase()} — MEMBER SINCE ${new Date(p.created).toLocaleDateString()}`,
          body: [
            ...(recent.length ? recent : ["No trophies yet — go explore."]),
            `🕹 ${games().length} game${games().length === 1 ? "" : "s"} in the library · 📷 ${photos().length} photo${photos().length === 1 ? "" : "s"} in the gallery`,
            `⏱ ${mins < 60 ? mins + " min" : (mins / 60).toFixed(1) + " h"} on this console`,
          ],
        });
        break;
      }
      case "backup": {
        sfx.confirm();
        const dump = {
          profiles: localStorage.getItem("asp.profiles.v1"),
          theme: localStorage.getItem("asp.theme"),
          spotify: localStorage.getItem("asp.spotify"),
          tv: localStorage.getItem("asp.tv"),
          rss: localStorage.getItem("asp.rss"),
          radiohist: localStorage.getItem("asp.radiohist"),
        };
        const a2 = document.createElement("a");
        a2.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }));
        a2.download = "console-backup.json";
        a2.click();
        URL.revokeObjectURL(a2.href);
        pushToast("Backup saved", "console-backup.json — games & photos stay in the browser");
        break;
      }
      case "restore":
        sfx.confirm();
        restoreInput.click();
        break;
      case "news": {
        sfx.confirm();
        awardT("wellread");
        setNews({ label: a.label, entries: [], sel: 0, loading: true });
        const load = a.source === "hn" ? fetchHN() : a.source === "devto" ? fetchDevto() : fetchRss(a.url!);
        load
          .then((entries) => setNews((n) => (n ? { ...n, entries, loading: false } : n)))
          .catch(() => setNews((n) => (n ? { ...n, loading: false, error: "Couldn't reach this feed right now." } : n)));
        break;
      }
      case "weather":
        sfx.confirm();
        setWeather({ loading: true });
        fetchWeather()
          .then((data) => {
            setWeather({ loading: false, data });
            setStatusWeather(`${wmo(data.code)[0]} ${data.temp}°`);
          })
          .catch(() => setWeather(null));
        break;
      case "photo":
        sfx.confirm();
        photoInput.click();
        break;
      case "themes":
        sfx.confirm();
        setThemeIdx(currentThemeIndex());
        setThemesOpen(true);
        break;
      case "sound-toggle": {
        const muted = sfx.toggleMute();
        pushToast("Sound", muted ? "Console muted" : "Console audio on");
        break;
      }
      case "clock-format": {
        sfx.confirm();
        const v = !clock24();
        setClock24(v);
        localStorage.setItem("asp.clock24", v ? "24" : "12");
        tickClock();
        pushToast("Date and Time", v ? "24-hour clock" : "12-hour clock");
        break;
      }
      case "saver-cycle": {
        sfx.confirm();
        const OPTS = [1.5, 3, 5, 10, 0];
        const next = OPTS[(OPTS.indexOf(saverMins()) + 1) % OPTS.length];
        setSaverMins(next);
        localStorage.setItem("asp.saver", String(next));
        pushToast("Power Save", next === 0 ? "Screen saver off" : `Screen saver after ${next === 1.5 ? "90 seconds" : `${next} minutes`}`);
        break;
      }
      case "sysinfo": {
        sfx.confirm();
        const nav = navigator as any;
        const gl = document.createElement("canvas").getContext("webgl");
        const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
        const gpu = dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "not reported";
        const ua = navigator.userAgent;
        const browser = ua.match(/(Edg|OPR|Firefox|Chrome|Safari)\/[\d.]+/)?.[0]?.replace("/", " ") ?? "unknown browser";
        const os = /Mac/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : "unknown OS";
        const b = battery();
        setPanel({
          heading: "System Information",
          tag: "SYSTEM SOFTWARE 1.2 — SOLIDJS + THREE.JS + GSAP",
          body: [
            `System: ${os} · ${browser} · ${navigator.hardwareConcurrency ?? "?"} cores${nav.deviceMemory ? ` · ${nav.deviceMemory} GB RAM` : ""}`,
            `Graphics: ${gpu}`,
            `Display: ${screen.width} × ${screen.height} @ ${devicePixelRatio}× · ${crossOriginIsolated ? "cross-origin isolated (PS2 core available)" : "not isolated"}`,
            b ? `Battery: ${Math.round(b.level * 100)}%${b.charging ? " — charging" : ""}` : "Battery: not reported by this browser",
            "Storage: profiles, trophies, themes & your game library live only in this browser.",
          ],
        });
        break;
      }
      case "switch-user":
        sfx.back();
        props.onSwitchUser();
        break;
      case "trophies":
        sfx.confirm();
        setTrophiesOpen(true);
        break;
      case "restart":
        sessionStorage.removeItem("asp.resume");
        location.reload();
        break;
    }
  }

  async function onDisc(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const core = CORES[ext];
    if (!core) {
      sfx.deny();
      pushToast("Unreadable disc", `.${ext} isn't a supported format`);
      return;
    }
    const rec: GameRecord = {
      id: Math.random().toString(36).slice(2, 10),
      profileId: props.profile.id,
      name: file.name,
      core,
      size: file.size,
      addedAt: Date.now(),
      plays: 0,
      blob: file,
    };
    await addGame(rec);
    await refreshGames();
    pushToast("Disc added", `${file.name} → your game library`);
    if (games().length >= 3) awardT("collector");
    awardT("disc");
    props.onPlay(rec);
  }

  // —— link input (spotify / tv / rss share one modal) ——
  const INPUT_COPY = {
    spotify: { title: "Paste a Spotify link", ph: "https://open.spotify.com/playlist/…", hint: "Playlist, album, track or artist · ENTER to add" },
    tv: { title: "Add a TV channel", ph: "https://…/master.m3u8", hint: "Any HLS live stream URL · ENTER to tune in" },
    rss: { title: "Add an RSS feed", ph: "https://example.com/feed.xml", hint: "RSS or Atom URL · ENTER to add" },
    yt: { title: "Play a YouTube video", ph: "https://youtube.com/watch?v=…", hint: "Any YouTube link · plays right here" },
  };

  function submitLink() {
    const raw = linkInput.value.trim();
    const mode = inputMode();
    const closeInput = () => { linkInput.value = ""; setNavEnabled(true); setInputMode(null); };
    if (mode === "spotify") {
      const m = raw.match(/(playlist|album|track|artist|show|episode)[/:]([A-Za-z0-9]+)/);
      if (!m) { sfx.deny(); pushToast("Couldn't read that link", "Paste a Spotify playlist / album / track URL"); return; }
      const entry = { url: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, label: `${m[1]} · ${m[2].slice(0, 8)}…` };
      const next = [...links(), entry];
      setLinks(next);
      localStorage.setItem("asp.spotify", JSON.stringify(next));
      closeInput();
      sfx.confirm();
      setSpotify(entry);
      awardT("dj");
    } else if (mode === "tv") {
      if (!/^https?:\/\/.+/.test(raw)) { sfx.deny(); pushToast("Not a stream URL", "Paste a full http(s) HLS link"); return; }
      let label = "Custom channel";
      try { label = new URL(raw).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
      const entry = { url: raw, label };
      const next = [...tvChans(), entry];
      setTvChans(next);
      localStorage.setItem("asp.tv", JSON.stringify(next));
      closeInput();
      sfx.confirm();
      awardT("zapper");
      setTv(entry);
    } else if (mode === "yt") {
      const m = raw.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
      if (!m) { sfx.deny(); pushToast("Not a YouTube link", "Paste a full video URL"); return; }
      closeInput();
      sfx.confirm();
      setYt(m[1]);
    } else if (mode === "rss") {
      if (!/^https?:\/\/.+/.test(raw)) { sfx.deny(); pushToast("Not a feed URL", "Paste a full http(s) RSS/Atom link"); return; }
      let label = "Custom feed";
      try { label = new URL(raw).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
      const entry = { url: raw, label };
      const next = [...rssFeeds(), entry];
      setRssFeeds(next);
      localStorage.setItem("asp.rss", JSON.stringify(next));
      closeInput();
      sfx.confirm();
      pushToast("Feed added", `${label} → News`);
    }
  }

  async function onPhoto(file: File) {
    try {
      const dataUrl = await resizePhoto(file);
      props.profile.avatarImg = dataUrl;
      updateProfile(props.profile);
      setAvatarVer((v) => v + 1);
      sfx.confirm();
      pushToast("Profile photo updated", "Looking sharp");
    } catch {
      sfx.deny();
      pushToast("Couldn't read that image", "Try a JPG or PNG");
    }
  }

  async function onGallery(files: File[]) {
    for (const f of files) {
      await addPhoto({
        id: Math.random().toString(36).slice(2, 10),
        profileId: props.profile.id,
        name: f.name,
        addedAt: Date.now(),
        blob: f,
      });
    }
    await refreshPhotos();
    awardT("shutterbug");
    pushToast("Photos added", `${files.length} → the gallery`);
    setViewerOpen(true);
  }

  function onRestore(file: File) {
    file.text().then((txt) => {
      const dump = JSON.parse(txt);
      if (!dump.profiles) throw new Error("not a backup");
      for (const [k, key] of [["profiles", "asp.profiles.v1"], ["theme", "asp.theme"], ["spotify", "asp.spotify"], ["tv", "asp.tv"], ["rss", "asp.rss"], ["radiohist", "asp.radiohist"]] as const) {
        if (dump[k]) localStorage.setItem(key, dump[k]);
      }
      location.reload();
    }).catch(() => { sfx.deny(); pushToast("Not a console backup", "Pick a console-backup.json file"); });
  }

  // —— the AI agent's hands: map spoken app names onto real console actions ——
  function aiCommand(app: string, arg?: string): boolean {
    const openApp = (a: typeof app) => { setApp(a as any); return true; };
    switch (app) {
      case "youtube-search": setYtQuery(arg ?? ""); return openApp("youtube");
      case "ps2": case "playstation": return openApp("ps2");
      case "pc": case "otheros": case "linux": case "kolibri": return openApp("pc");
      case "guestbook": return openApp("guestbook");
      case "doom": awardT("doomguy"); return openApp("doom");
      case "chess": return openApp("chess");
      case "lichess": return openApp("lichess");
      case "trivia": return openApp("trivia");
      case "flash": return openApp("flash");
      case "youtube": return openApp("youtube");
      case "cinema": case "movies": awardT("cinephile"); return openApp("cinema");
      case "podcasts": return openApp("podcasts");
      case "winamp": awardT("dj"); return openApp("webamp");
      case "library": case "books": awardT("bookworm"); return openApp("library");
      case "wiki": case "wikipedia": return openApp("wiki");
      case "map": case "earth": case "globe": return openApp("map");
      case "timemachine": awardT("timetraveler"); return openApp("timemachine");
      case "art": awardT("curator"); return openApp("art");
      case "radio": setGuideOpen("radio"); return true;
      case "tv": setGuideOpen("tv"); return true;
      case "spotify":
        setSpotify({ url: "https://open.spotify.com/embed/playlist/37i9dQZF1DWWQRwui0ExPn", label: "lofi beats" });
        return true;
      case "weather":
        setWeather({ loading: true });
        fetchWeather().then((data) => { setWeather({ loading: false, data }); setStatusWeather(`${wmo(data.code)[0]} ${data.temp}°`); }).catch(() => setWeather(null));
        return true;
      case "apod": awardT("stargazer"); setApod({ loading: true }); fetchApod().then((data) => setApod({ loading: false, data })).catch(() => setApod(null)); return true;
      case "news": setNews({ label: "Hacker News", entries: [], sel: 0, loading: true }); fetchHN().then((entries) => setNews((n) => (n ? { ...n, entries, loading: false } : n))).catch(() => setNews(null)); return true;
      case "photos": if (photos().length) { setViewerOpen(true); return true; } return false;
      case "trophies": setTrophiesOpen(true); return true;
      case "whatsnew": act({ id: "whatsnew", title: "", icon: "", action: { type: "whats-new" } }); return true;
      case "themes": setThemeIdx(currentThemeIndex()); setThemesOpen(true); return true;
      default: return false;
    }
  }

  // —— navigation (keyboard + gamepad via onNav; mouse clicks & wheel reuse it) ——
  const handleNav = (action: Parameters<Parameters<typeof onNav>[0]>[0]) => {
    lastActive = Date.now();
    if (saver()) { setSaver(false); return; }
    if (padTest()) { if (action === "back") setPadTest(false); return; }
    if (app()) {
      // bound apps route their own nav; doom/map/ai/webamp own the keyboard outright
      if (["chess", "trivia", "flash", "cinema", "podcasts", "library", "youtube", "art", "wiki"].includes(app()!)) appNav?.(action);
      else if (app() === "lichess" && action === "back") { sfx.back(); setApp(null); }
      return;
    }
    if (yt()) {
      if (action === "back") { sfx.back(); setYt(null); }
      return;
    }
    if (apod()) {
      if (action === "back" || action === "confirm") { sfx.back(); setApod(null); }
      return;
    }
    if (dict()) {
      if (action === "back") { sfx.back(); setNavEnabled(true); setDict(null); }
      return;
    }
    if (viewerOpen()) {
      if (action === "back") { sfx.back(); setViewerOpen(false); }
      else viewerNav?.(action);
      return;
    }
    if (guideOpen()) {
      if (action === "back") { sfx.back(); setGuideOpen(null); }
      else guideNav?.(action);
      return;
    }
    if (gestureTut()) {
      if (action === "confirm") {
        setGestureTut(false);
        startGestures((a) => handleNav(a))
          .then((video) => {
            setGesturesOn(true);
            gestureBox.appendChild(video);
            pushToast("Camera navigation on", "You're on air — wave away");
          })
          .catch(() => { sfx.deny(); pushToast("Camera unavailable", "Permission denied or no webcam"); });
      }
      if (action === "back") { sfx.back(); setGestureTut(false); }
      return;
    }
    if (themesOpen()) {
      const n = THEMES.length;
      if (action === "left" || action === "up") { setThemeIdx((themeIdx() + n - 1) % n); sfx.tickH(); applyTheme(THEMES[themeIdx()].color); awardT("stylist"); }
      if (action === "right" || action === "down") { setThemeIdx((themeIdx() + 1) % n); sfx.tickH(); applyTheme(THEMES[themeIdx()].color); awardT("stylist"); }
      if (action === "back" || action === "confirm") { sfx.back(); setThemesOpen(false); }
      return;
    }
    if (tv()) {
      if (action === "back") { sfx.back(); setTv(null); }
      return;
    }
    if (news()) {
      const n = news()!;
      if (action === "up" && n.sel > 0) { setNews({ ...n, sel: n.sel - 1 }); sfx.tickV(); }
      if (action === "down" && n.sel < n.entries.length - 1) { setNews({ ...n, sel: n.sel + 1 }); sfx.tickV(); }
      if (action === "confirm" && n.entries[n.sel]) { sfx.confirm(); window.open(n.entries[n.sel].url, "_blank"); }
      if (action === "back") { sfx.back(); setNews(null); }
      return;
    }
    if (weather()) {
      if (action === "back" || action === "confirm") { sfx.back(); setWeather(null); }
      return;
    }
    if (spotify()) {
      if (action === "back") { sfx.back(); setSpotify(null); }
      return;
    }
    if (inputMode()) {
      if (action === "back") { sfx.back(); setNavEnabled(true); setInputMode(null); }
      return;
    }
    if (trophiesOpen()) {
      if (action === "back" || action === "confirm") { sfx.back(); setTrophiesOpen(false); }
      return;
    }
    if (panel()) {
      if (action === "back" || action === "confirm") { sfx.back(); setPanel(null); }
      return;
    }
    const items = itemsOf(cat());
    switch (action) {
      case "left":
        if (cat() > 0) { setCat(cat() - 1); sfx.tickH(); }
        break;
      case "right":
        if (cat() < CATEGORIES.length - 1) { setCat(cat() + 1); sfx.tickH(); }
        break;
      case "up": {
        const s = selOf(cat());
        if (s > 0) { setSels({ ...sels(), [CATEGORIES[cat()].id]: s - 1 }); sfx.tickV(); }
        break;
      }
      case "down": {
        const s = selOf(cat());
        if (s < items.length - 1) { setSels({ ...sels(), [CATEGORIES[cat()].id]: s + 1 }); sfx.tickV(); }
        break;
      }
      case "confirm": {
        const it = items[selOf(cat())];
        if (it) act(it);
        break;
      }
      case "options":
        setTrophiesOpen(true);
        break;
      case "back":
        break;
    }
  };
  onNav(handleNav);

  // mouse wheel scrolls the item list
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) {
      handleNav(wheelAcc > 0 ? "down" : "up");
      wheelAcc = 0;
    }
  };

  // —— screensaver: PS-style drifting clock after idle (Power Save Settings) ——
  const [saverMins, setSaverMins] = createSignal(Number(localStorage.getItem("asp.saver") ?? 1.5));
  const poke = () => { lastActive = Date.now(); if (saver()) setSaver(false); };
  addEventListener("pointermove", poke);
  addEventListener("pointerdown", poke);
  addEventListener("keydown", poke);
  const saverId = setInterval(() => {
    const busy = tv() || guideOpen() || spotify() || news() || inputMode() || viewerOpen() || app() || yt() || apod() || dict();
    if (!busy && saverMins() > 0 && Date.now() - lastActive > saverMins() * 60_000) setSaver(true);
  }, 5000);
  onCleanup(() => {
    if (gesturesOn()) stopGestures();
    clearInterval(saverId);
    removeEventListener("pointermove", poke);
    removeEventListener("pointerdown", poke);
    removeEventListener("keydown", poke);
  });

  // —— the old ways ——
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let kIdx = 0;
  const onKonami = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    kIdx = k === KONAMI[kIdx] ? kIdx + 1 : k === KONAMI[0] ? 1 : 0;
    if (kIdx === KONAMI.length) {
      kIdx = 0;
      awardT("konami");
      document.querySelector(".xmb")?.classList.add("roll");
      setTimeout(() => document.querySelector(".xmb")?.classList.remove("roll"), 1300);
    }
  };
  addEventListener("keydown", onKonami);
  onCleanup(() => removeEventListener("keydown", onKonami));

  // —— controller detection: POLL-based + debounced (see input.ts). Ignores the
  // spurious connect/disconnect events that make pads "flicker". ——
  let padFirst = true;
  onPadChange((id) => {
    if (id === null) {
      if (padName()) pushToast("🎮 Controller disconnected", "");
      setPadName(null);
      padFirst = true;
      return;
    }
    const name = id.replace(/\s*\(.*\)\s*/, "").trim() || "Controller";
    setPadName(name);
    if (padFirst) { pushToast(`🎮 ${name} connected`, "Use the d-pad or left stick"); padFirst = false; }
  });

  // item vertical layout — selected sits just under the icon row, previous
  // items stack compressed above it (authentic XMB cross layout)
  // clearance above the category label (d=0 at 118) and below the hint bar
  const itemY = (d: number) => (d < 0 ? -92 + d * 52 : d === 0 ? 118 : 118 + 92 + (d - 1) * 80);

  const trophyCount = () => {
    trophyVer();
    return Object.keys(props.profile.trophies).length;
  };
  // profile is a mutable plain object — avatarVer bumps make this re-read
  const avatarSrc = () => {
    avatarVer();
    return props.profile.avatarImg;
  };

  return (
    <div class="xmb" onWheel={onWheel}>
      {/* status bar */}
      <div class="status">
        <div class="status-user">
          <Show
            when={avatarSrc()}
            fallback={
              <span class="status-avatar" style={{ background: AVATARS[props.profile.avatar]?.bg }}>
                {AVATARS[props.profile.avatar]?.glyph}
              </span>
            }
          >
            <img class="status-avatar" src={avatarSrc()} alt="" />
          </Show>
          {props.profile.name}
          <span class="status-troph">🏆 {trophyCount()}</span>
          <Show when={radioOn() || station()}>
            <span class="status-radio">♪ {station()?.label ?? ""}</span>
          </Show>
        </div>
        <Show when={statusWeather()}><span class="status-weather">{statusWeather()}</span></Show>
        <Show when={padName()}><span class="status-pad" title={padName()!}>🎮</span></Show>
        <Show when={battery()}>
          <span
            class="status-batt"
            classList={{ low: battery()!.level <= 0.15 && !battery()!.charging, charging: battery()!.charging }}
            title={`Battery ${Math.round(battery()!.level * 100)}%${battery()!.charging ? " — charging" : ""}`}
          >
            <span class="batt-body">
              <span class="batt-cell" classList={{ on: battery()!.level > 0.05 }} />
              <span class="batt-cell" classList={{ on: battery()!.level > 0.4 }} />
              <span class="batt-cell" classList={{ on: battery()!.level > 0.7 }} />
            </span>
            <span class="batt-cap" />
          </span>
        </Show>
        <div class="status-clock">{clock()}</div>
      </div>

      {/* category strip */}
      <div class="cat-strip" style={{ transform: `translateX(${-cat() * CAT_SPACING}px)` }}>
        <For each={CATEGORIES}>
          {(c, i) => (
            <div
              class="cat"
              classList={{ active: i() === cat() }}
              style={{ left: `${i() * CAT_SPACING}px` }}
              onClick={() => { if (i() !== cat()) { setCat(i()); sfx.tickH(); } }}
            >
              <div class="cat-icon"><Icon name={c.icon} /></div>
              <div class="cat-label">{c.label}</div>
            </div>
          )}
        </For>
      </div>

      {/* item column for the active category */}
      <div class="item-col">
        <For each={itemsOf(cat())}>
          {(item, i) => {
            const d = () => i() - selOf(cat());
            return (
              <div
                class="item"
                classList={{ selected: d() === 0, above: d() < 0, offscreen: d() > 4 || d() < -3 }}
                style={{ transform: `translateY(${itemY(d())}px)` }}
                onClick={() => {
                  if (d() === 0) act(item);
                  else { setSels({ ...sels(), [CATEGORIES[cat()].id]: i() }); sfx.tickV(); }
                }}
              >
                <div class="item-icon"><Icon name={item.icon} /></div>
                <div class="item-text">
                  <div class="item-title">{item.title}</div>
                  <Show when={d() === 0 && item.sub}>
                    <div class="item-sub">{item.sub}</div>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* info panel */}
      <Show when={panel()}>
        <div class="panel-backdrop" onClick={() => setPanel(null)} />
        <div class="panel">
          <Show when={panel()!.tag}><div class="panel-tag">{panel()!.tag}</div></Show>
          <div class="panel-heading">{panel()!.heading}</div>
          <div class="panel-body">
            <For each={panel()!.body}>{(b) => <p>{b}</p>}</For>
          </div>
          <div class="panel-hint"><span class="btn-o" /> Back</div>
        </div>
      </Show>

      {/* trophy collection */}
      <Show when={trophiesOpen()}>
        <div class="panel-backdrop" onClick={() => setTrophiesOpen(false)} />
        <div class="panel trophies">
          <div class="panel-tag">TROPHY COLLECTION — {trophyCount()} / {TROPHIES.length + 1}</div>
          <div class="panel-heading">{props.profile.name}</div>
          <div class="trophy-list">
            <For each={[PLATINUM, ...TROPHIES]}>
              {(t) => (
                <div class="trophy-row" classList={{ earned: !!props.profile.trophies[t.id] }}>
                  <span class={`trophy-gem tier-${t.tier}`}>▮</span>
                  <div>
                    <div class="trophy-name">{props.profile.trophies[t.id] ? t.name : t.tier === "platinum" ? "?????" : t.name}</div>
                    <div class="trophy-desc">{t.desc}</div>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="panel-hint"><span class="btn-o" /> Back</div>
        </div>
      </Show>

      {/* spotify player */}
      <Show when={spotify()}>
        <div class="panel-backdrop" onClick={() => setSpotify(null)} />
        <div class="spotify-panel">
          <div class="spotify-head">
            <div class="panel-tag">SPOTIFY — {spotify()!.label.toUpperCase()}</div>
            <button class="ghost-btn" onClick={() => { sfx.back(); setSpotify(null); }}>✕</button>
          </div>
          <iframe credentialless={true}
            src={`${spotify()!.url}?theme=0`}
            width="100%"
            height="420"
            style={{ border: "0", "border-radius": "12px" }}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title="Spotify player"
          />
          <div class="panel-hint"><span class="btn-o" /> Esc — close · keeps playing? open in a tab for background play</div>
        </div>
      </Show>

      {/* link input (spotify / tv channel / rss feed) */}
      <Show when={inputMode()}>
        <div class="panel-backdrop" />
        <div class="modal">
          <div class="panel-tag">{inputMode() === "spotify" ? "CONNECT SPOTIFY" : inputMode() === "tv" ? "LIVE TV" : "NEWS"}</div>
          <div class="modal-title">{INPUT_COPY[inputMode()!].title}</div>
          <input
            ref={linkInput}
            class="modal-input"
            placeholder={INPUT_COPY[inputMode()!].ph}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") submitLink();
              if (e.key === "Escape") { setNavEnabled(true); setInputMode(null); }
            }}
          />
          <div class="modal-hint">{INPUT_COPY[inputMode()!].hint} · saved on this console</div>
        </div>
      </Show>

      {/* live tv */}
      <Show when={tv()}>
        <Tv url={tv()!.url} label={tv()!.label} onClose={() => { sfx.back(); setTv(null); }} />
      </Show>

      {/* channel / station guides */}
      <Show when={guideOpen() === "tv"}>
        <Guide
          title="CHANNEL GUIDE — LIVE FROM IPTV-ORG"
          loadingText="Tuning the antenna… fetching ~17,000 public channels"
          footNote="public streams — some are offline or geo-blocked"
          fetch={fetchGuide}
          bind={(f) => (guideNav = f)}
          onPlay={(c) => { awardT("zapper"); setGuideOpen(null); setTv({ url: c.url, label: c.title }); }}
          onClose={() => setGuideOpen(null)}
        />
      </Show>
      <Show when={guideOpen() === "radio"}>
        <Guide
          title="RADIO STATIONS — LIVE FROM RADIO-BROWSER.INFO"
          loadingText="Scanning the airwaves… fetching the top 3,000 stations"
          footNote="keeps playing while you browse the console"
          fetch={fetchRadio}
          bind={(f) => (guideNav = f)}
          onPlay={(c) => { awardT("worldband"); setGuideOpen(null); playStation({ url: c.url, label: c.title }); }}
          onClose={() => setGuideOpen(null)}
        />
      </Show>

      {/* photo slideshow */}
      <Show when={viewerOpen() && photos().length}>
        <Photos
          photos={photos()}
          bind={(f) => (viewerNav = f)}
          onClose={() => setViewerOpen(false)}
        />
      </Show>

      {/* ———— the wild apps ———— */}
      <Show when={app() === "doom"}><Doom onClose={() => setApp(null)} /></Show>
      <Show when={app() === "chess"}>
        <ChessApp bind={(f) => (appNav = f)} onWin={() => awardT("tactician")} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "trivia"}>
        <Trivia bind={(f) => (appNav = f)} onScore={(n) => { if (n >= 8) awardT("quizmaster"); }} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "flash"}>
        <Flash bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "cinema"}>
        <Cinema bind={(f) => (appNav = f)} onWatch={() => awardT("cinephile")} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "podcasts"}>
        <Podcasts
          bind={(f) => (appNav = f)}
          onPlayAudio={(url, label) => { awardT("dj"); playStation({ url, label }); }}
          onClose={() => setApp(null)}
        />
      </Show>
      <Show when={app() === "library"}>
        <Library bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "map"}><MapApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "ai"}>
        <AiChat
          onFirstChat={() => awardT("aifriend")}
          onCommand={(a, arg) => aiCommand(a, arg)}
          onClose={() => setApp((cur) => (cur === "ai" ? null : cur))}
        />
      </Show>
      <Show when={app() === "webamp"}>
        <WinampApp stations={recentStations()} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "youtube"}>
        <YouTubeApp bind={(f) => (appNav = f)} initialQuery={ytQuery()} onClose={() => { setYtQuery(""); setApp(null); }} />
      </Show>
      <Show when={app() === "timemachine"}>
        <TimeMachine onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "art"}>
        <ArtGallery bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "wiki"}>
        <WikiApp bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "ps2"}><Ps2 onClose={() => setApp(null)} /></Show>
      <Show when={app() === "pc"}><PcApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "guestbook"}><Guestbook userName={props.profile.name} onClose={() => setApp(null)} /></Show>
      <Show when={app() === "lichess"}>
        <div class="fullapp">
          <iframe credentialless={true} class="fullapp-frame" src="https://lichess.org/tv/frame?theme=brown&bg=dark" allow="fullscreen" title="Lichess TV" />
          <button class="session-eject" onClick={() => { sfx.back(); setApp(null); }}>⏏ CLOSE</button>
        </div>
      </Show>

      {/* youtube player */}
      <Show when={yt()}>
        <div class="fullapp">
          <iframe credentialless={true}
            class="fullapp-frame"
            src={`https://www.youtube-nocookie.com/embed/${yt()}?autoplay=1`}
            allow="autoplay; encrypted-media; fullscreen"
            title="YouTube"
          />
          <button class="session-eject" onClick={() => { sfx.back(); setYt(null); }}>⏏ STOP</button>
        </div>
      </Show>

      {/* NASA APOD */}
      <Show when={apod()}>
        <div class="apod" onClick={() => setApod(null)}>
          <Show when={apod()!.data} fallback={<div class="guide-loading">Asking NASA…</div>}>
            <Show
              when={apod()!.data!.media_type === "image"}
              fallback={<iframe credentialless={true} class="fullapp-frame" src={apod()!.data!.url} allow="fullscreen" title="APOD" />}
            >
              <img class="apod-img" src={apod()!.data!.hdurl ?? apod()!.data!.url} alt="" />
            </Show>
            <div class="apod-caption">
              <div class="apod-title">{apod()!.data!.title} <span class="apod-date">{apod()!.data!.date}</span></div>
              <div class="apod-text">{apod()!.data!.explanation}</div>
            </div>
          </Show>
        </div>
      </Show>

      {/* dictionary */}
      <Show when={dict()}>
        <div class="panel-backdrop" onClick={() => { setNavEnabled(true); setDict(null); }} />
        <div class="modal dict-modal">
          <div class="panel-tag">DICTIONARY</div>
          <input
            ref={dictInput}
            class="modal-input"
            placeholder="Type a word…"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const w = e.currentTarget.value.trim();
                if (!w) return;
                setDict({ looking: true });
                define(w).then((r) => setDict({ looking: false, result: r }));
              }
              if (e.key === "Escape") { setNavEnabled(true); setDict(null); }
            }}
          />
          <Show when={dict()!.looking}><div class="modal-hint">looking it up…</div></Show>
          <Show when={dict()!.result === null}><div class="modal-hint">no such word — even the OED gave up</div></Show>
          <Show when={dict()!.result}>
            <div class="dict-word">{dict()!.result!.word} <span class="dict-phon">{dict()!.result!.phonetic ?? ""}</span></div>
            <div class="dict-meanings">
              <For each={dict()!.result!.meanings}>
                {(m) => (
                  <div class="dict-m">
                    <span class="dict-pos">{m.pos}</span>
                    <For each={m.defs}>{(d) => <p>{d}</p>}</For>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="modal-hint">ENTER — look up · Esc — close</div>
        </div>
      </Show>

      {/* gesture tutorial */}
      <Show when={gestureTut()}>
        <div class="panel-backdrop" onClick={() => setGestureTut(false)} />
        <div class="modal gesture-tut">
          <div class="panel-tag">CAMERA NAVIGATION — HOW IT WORKS</div>
          <div class="gtut-rows">
            <div class="gtut-row"><span class="gtut-icon">✋</span><div><b>Swipe an open hand</b><br />left / right / up / down moves the menu — like flicking through the air</div></div>
            <div class="gtut-row"><span class="gtut-icon">🤏</span><div><b>Pinch thumb + index</b><br />that's your ✕ button — it selects</div></div>
            <div class="gtut-row"><span class="gtut-icon">💡</span><div><b>Best results</b><br />arm's length from the camera, decent light, one hand in frame</div></div>
          </div>
          <div class="gtut-note">Everything runs on your device — the camera feed never leaves this browser. A small mirror appears bottom-right while it's on; turn it off in Settings any time.</div>
          <div class="modal-hint">ENTER — start the camera · Esc — not now</div>
        </div>
      </Show>

      <Show when={padTest()}><GamepadTest onClose={() => setPadTest(false)} /></Show>

      {/* gesture cam PiP */}
      <div class="gesture-box" classList={{ on: gesturesOn() }} ref={gestureBox} />

      {/* screensaver */}
      <Show when={saver()}>
        <div class="saver" onClick={() => setSaver(false)}>
          <div class="saver-clock">
            <div class="saver-time">{clock().split("  ")[1]}</div>
            <div class="saver-date">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
          </div>
        </div>
      </Show>

      {/* news reader */}
      <Show when={news()}>
        <div class="panel-backdrop" onClick={() => setNews(null)} />
        <div class="panel news-panel">
          <div class="panel-tag">NEWS — {news()!.label.toUpperCase()}</div>
          <Show when={!news()!.loading} fallback={<div class="news-loading">Fetching headlines…</div>}>
            <Show when={!news()!.error} fallback={<div class="news-loading">{news()!.error}</div>}>
              <div class="news-list">
                <For each={news()!.entries}>
                  {(e, i) => (
                    <div
                      class="news-row"
                      classList={{ selected: i() === news()!.sel }}
                      onClick={() => { setNews({ ...news()!, sel: i() }); window.open(e.url, "_blank"); }}
                    >
                      <div class="news-title">{e.title}</div>
                      <div class="news-meta">{e.meta}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
          <div class="panel-hint"><span class="btn-x" /> open article · <span class="btn-o" /> back</div>
        </div>
      </Show>

      {/* weather */}
      <Show when={weather()}>
        <div class="panel-backdrop" onClick={() => setWeather(null)} />
        <div class="modal weather-modal">
          <div class="panel-tag">WEATHER — {weather()!.data?.place.toUpperCase() ?? ""}</div>
          <Show when={weather()!.data} fallback={<div class="news-loading">Reading the sky…</div>}>
            <div class="weather-now">
              <span class="weather-emoji">{wmo(weather()!.data!.code)[0]}</span>
              <span class="weather-temp">{weather()!.data!.temp}°C</span>
              <div class="weather-desc">
                {wmo(weather()!.data!.code)[1]}
                <div class="weather-wind">wind {weather()!.data!.wind} km/h</div>
              </div>
            </div>
            <div class="weather-days">
              <For each={weather()!.data!.days}>
                {(d) => (
                  <div class="weather-day">
                    <div class="weather-day-name">{d.day}</div>
                    <div class="weather-day-emoji">{wmo(d.code)[0]}</div>
                    <div class="weather-day-temp">{d.max}° <span>{d.min}°</span></div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="modal-hint">open-meteo.com · Esc — close</div>
        </div>
      </Show>

      {/* theme chooser */}
      <Show when={themesOpen()}>
        <div class="panel-backdrop" onClick={() => setThemesOpen(false)} />
        <div class="modal themes-modal">
          <div class="panel-tag">CONSOLE THEME</div>
          <div class="modal-title">{THEMES[themeIdx()].name}</div>
          <div class="theme-row">
            <For each={THEMES}>
              {(t, i) => (
                <div
                  class="theme-swatch"
                  classList={{ active: i() === themeIdx() }}
                  style={{ background: t.color ?? "conic-gradient(#8a8f98,#c8b45a,#7fb069,#3fa7a0,#4a7fc8,#8e6bb4,#c85555,#8a8f98)" }}
                  onClick={() => { setThemeIdx(i()); applyTheme(t.color); sfx.tickH(); awardT("stylist"); }}
                />
              )}
            </For>
          </div>
          <div class="modal-hint">←→ preview live · ENTER / Esc — done</div>
        </div>
      </Show>

      {/* toasts */}
      <div class="toasts">
        <For each={toasts()}>
          {(t) => (
            <div class="toast" classList={{ [`tier-${t.tier}`]: !!t.tier }}>
              <Show when={t.tier}><span class={`trophy-gem tier-${t.tier}`}>▮</span></Show>
              <div>
                <div class="toast-title">{t.title}</div>
                <div class="toast-sub">{t.sub}</div>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* controls hint */}
      <div class="hint-bar">
        <span><b>←→↑↓</b> navigate</span>
        <span><span class="btn-x" /> Enter — select</span>
        <span><span class="btn-o" /> Esc — back</span>
        <span>🎮 supported</span>
      </div>

      {/* on-screen controller — shown on touch devices; drives the exact same
          nav as the keyboard/gamepad so every app just works */}
      <div class="touchpad">
        <div class="tpad-dpad">
          {(["up", "left", "right", "down"] as const).map((dir) => (
            <button
              class={`tpad-d tpad-${dir}`}
              onPointerDown={(e) => { e.preventDefault(); handleNav(dir); }}
              aria-label={dir}
            >{{ up: "▲", down: "▼", left: "◀", right: "▶" }[dir]}</button>
          ))}
        </div>
        <div class="tpad-ab">
          <button class="tpad-btn tpad-o" onPointerDown={(e) => { e.preventDefault(); handleNav("back"); }} aria-label="back"><span class="btn-o" /></button>
          <button class="tpad-btn tpad-x" onPointerDown={(e) => { e.preventDefault(); handleNav("confirm"); }} aria-label="select"><span class="btn-x" /></button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInput}
        hidden
        accept=".gba,.gb,.gbc,.nes,.fds,.sfc,.smc,.md,.gen,.bin,.n64,.z64,.v64,.nds"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onDisc(f);
        }}
      />
      <input
        type="file"
        ref={photoInput}
        hidden
        accept="image/*"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onPhoto(f);
        }}
      />
      <input
        type="file"
        ref={galleryInput}
        hidden
        multiple
        accept="image/*"
        onChange={(e) => {
          const fs = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (fs.length) onGallery(fs);
        }}
      />
      <input
        type="file"
        ref={restoreInput}
        hidden
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onRestore(f);
        }}
      />
      {/* radio keeps playing under everything, PS3-music style */}
      <audio ref={radioEl} hidden onError={() => { if (station()) { pushToast("Station dropped", "The stream went quiet — pick another"); setStation(null); } }} />
    </div>
  );
}
