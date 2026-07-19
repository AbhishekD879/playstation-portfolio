// The cross-media bar. Horizontal categories, vertical items, info panels,
// trophies, disc drive. Navigation: arrows/WASD + Enter/Esc, or a gamepad.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CAREER, CATEGORIES, PROJECTS, TROPHIES, type XmbItem } from "../content";
import { AVATARS, PLATINUM, award, resizePhoto, updateProfile, type Profile } from "../profiles";
import { CORES, PS2_EXTS, PSP_ONLY_EXTS, PSX_ONLY_EXTS, addGame, listGames, addPhoto, listPhotos, fsAccessSupported, type GameRecord, type PhotoRecord } from "../gamesdb";
import { BG_MODES, THEMES, applyCustomHsl, applyTheme, bgMode, currentThemeIndex, loadCustomHsl, setBgMode } from "../theme";
import { LAB_FLAT, LAB_GROUPS, LAB_GUIDES, labEnabled, rateFeature, toggleLab } from "../labs";
import { deviceSummary } from "../gpu";
import { CHANNELS, fetchDevto, fetchGuide, fetchHN, fetchRadio, fetchRss, fetchWeather, wmo, type NewsEntry, type Weather } from "../apps";
import * as sfx from "../audio";
import { onCcNav, onNav, onPadChange, onSystemButton, primaryPad, rumble, rumbleEnabled, setCcActive, setNavEnabled, setRumble } from "../input";
import { setBridgePaused } from "../gamepadBridge";
import { hasWebGPU } from "../gpu";
import { MODEL_BUDGET_MB, residentModels } from "../models";
import { startPresence, visitorCount } from "../p2p";
import { iconOf } from "../prefs";
import { tr } from "../translate";
import { startTabSync } from "../sync";
import { fluidNavPulse } from "./FluidBg";
import DepthPhoto from "./DepthPhoto";
import ControlCenter from "./ControlCenter";
import { asrSupported, record } from "../asr";
import { registerActions } from "../consoleBus";
import { Icon } from "./icons";
import Tv from "./Tv";
import Guide from "./Guide";
import Photos from "./Photos";
import GamepadTest from "./GamepadTest";
import Ps2 from "./Ps2";
import PcApp from "./PcApp";
import Guestbook from "./Guestbook";
import Browser from "./Browser";
import Visualizer from "./Visualizer";
import Studio from "./Studio";
import CodeApp from "./CodeApp";
import Manual from "./Manual";
import GameShelf from "./GameShelf";
import Doom from "./Doom";
import DoomRtx from "./DoomRtx";
import Karaoke from "./Karaoke";
import SettingsApp from "./SettingsApp";
import VideoPlayer from "./VideoPlayer";
import RepoRewind from "./RepoRewind";
import RpgMaker from "./RpgMaker";
import { engineFamily, listRpgGames } from "../rpgm";
import { enterRest, exitRest, resting } from "../rest";
import { dsBattery } from "../dualsense";
import { composeSnapshot, downloadSnapshot, shareSnapshot } from "../photomode";
import { applySetup, readSetupHash } from "../statefiles";
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
import Privacy from "./Privacy";
import { fetchApod, define, type Apod, type Definition } from "../apps";
import { startGestures, stopGestures } from "../gestures";

const CAT_SPACING = 150;

interface Toast { id: number; title: string; sub: string; tier?: string; icon?: string }
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
  const [spotifyOpen, setSpotifyOpen] = createSignal(false); // panel hidden ≠ music stopped
  const [inputMode, setInputMode] = createSignal<null | "spotify" | "tv" | "rss" | "yt">(null);
  const [themesOpen, setThemesOpen] = createSignal(false);
  const [themeIdx, setThemeIdx] = createSignal(0);
  const [themeRow, setThemeRow] = createSignal(0); // 0 = swatches · 1-3 = custom H/S/L sliders
  const [customHsl, setCustomHsl] = createSignal(loadCustomHsl());
  const [labsOpen, setLabsOpen] = createSignal(false);
  const [labsIdx, setLabsIdx] = createSignal(0);
  const [labsTick, setLabsTick] = createSignal(0); // re-render pulse for toggle states
  const [labsGuide, setLabsGuide] = createSignal<string | null>(null); // flag id whose tutorial card is open
  const [labsWarn, setLabsWarn] = createSignal<string | null>(null); // armed "enable anyway" warning
  let labsWarnTimer: ReturnType<typeof setTimeout> | null = null;
  // enabling a ⚠/✕ feature takes two presses — the first shows what it'll cost
  const tryToggle = (id: string) => {
    const turningOn = !labEnabled(id);
    const fit = rateFeature(id);
    if (turningOn && fit && fit.level !== "ready" && labsWarn() !== id) {
      setLabsWarn(id);
      sfx.deny();
      if (labsWarnTimer) clearTimeout(labsWarnTimer);
      labsWarnTimer = setTimeout(() => setLabsWarn(null), 5000);
      return;
    }
    if (labsWarnTimer) clearTimeout(labsWarnTimer);
    setLabsWarn(null);
    toggleLab(id);
    setLabsTick(labsTick() + 1);
    sfx.confirm();
  };
  const [soundOpen, setSoundOpen] = createSignal(false);
  const [soundIdx, setSoundIdx] = createSignal(0);
  const [sndTick, setSndTick] = createSignal(0); // re-render pulse for volume/pack/mute
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchSel, setSearchSel] = createSignal(0);
  let searchInput: HTMLInputElement | undefined;
  const [labsQuery, setLabsQuery] = createSignal("");
  let labsInput: HTMLInputElement | undefined;
  // Labs filter: matching a group name keeps all its flags; otherwise match each
  // flag's title/description. Empty groups drop out.
  const labsGroupsView = () => {
    const q = labsQuery().toLowerCase().trim();
    if (!q) return LAB_GROUPS;
    return LAB_GROUPS
      .map((g) => ({ group: g.group, icon: g.icon, items: g.group.toLowerCase().includes(q) ? g.items : g.items.filter((f) => f.title.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length);
  };
  const labsView = () => labsGroupsView().flatMap((g) => g.items);
  // keep the focused Labs row in view while the pad scrolls the list; reset the
  // cursor whenever the filter changes
  createEffect(() => { labsQuery(); setLabsIdx(0); });
  createEffect(() => { labsIdx(); labsOpen() && document.querySelector(".labs-row.active")?.scrollIntoView({ block: "nearest" }); });
  // keep the focused search result in view; reset selection when the query changes
  createEffect(() => { searchQuery(); setSearchSel(0); });
  createEffect(() => { searchSel(); searchOpen() && document.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" }); });

  // Modern CSS Polish rides a root class (container queries, sticky-stuck
  // headers, height:auto animations, scroll reveals — all in styles.css)
  createEffect(() => document.documentElement.classList.toggle("moderncss", labEnabled("moderncss")));

  // Search-match highlighting via the CSS Custom Highlight API — the query
  // lights up inside result titles without wrapping a single span
  createEffect(() => {
    const q = searchQuery().trim().toLowerCase();
    searchResults(); // re-run when the list changes
    const HL = (CSS as any).highlights;
    if (!HL || !labEnabled("moderncss")) return;
    queueMicrotask(() => {
      HL.delete("search-hit");
      if (!q || !searchOpen()) return;
      const ranges: Range[] = [];
      document.querySelectorAll(".search-result-title").forEach((el) => {
        const node = el.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) return;
        const text = (node.textContent ?? "").toLowerCase();
        let at = text.indexOf(q);
        while (at !== -1) {
          const r = new Range();
          r.setStart(node, at); r.setEnd(node, at + q.length);
          ranges.push(r);
          at = text.indexOf(q, at + q.length);
        }
      });
      if (ranges.length) HL.set("search-hit", new (window as any).Highlight(...ranges));
    });
  });
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
  const [vListening, setVListening] = createSignal(false); // XMB voice command
  const [padTest, setPadTest] = createSignal(false);
  const [app, setApp] = createSignal<null | "doom" | "doomrtx" | "chess" | "trivia" | "flash" | "cinema" | "podcasts" | "library" | "map" | "ai" | "webamp" | "youtube" | "timemachine" | "art" | "wiki" | "lichess" | "ps2" | "pc" | "guestbook" | "browser" | "visualizer" | "studio" | "code" | "manual" | "ps2home" | "ps1home" | "psphome" | "retrohome" | "scummvm" | "karaoke" | "strudel" | "settingshub" | "videoplayer" | "reporewind" | "rpgmaker" | "renpy" | "web" | "privacy">(null);
  const [ps2Boot, setPs2Boot] = createSignal<GameRecord | null>(null);
  const [ps2Join, setPs2Join] = createSignal(false);
  const [ccOpen, setCcOpen] = createSignal(false);
  let ccNav: ((a: Parameters<Parameters<typeof onNav>[0]>[0]) => void) | undefined;

  // route a library record to the right engine: PS2 discs boot the Play! app
  // (auto-loading the disc), everything else goes to the EmulatorJS session
  function playRecord(g: GameRecord) {
    awardT("disc");
    if (g.sys === "ps2") { setPs2Boot(g); setPs2Join(false); setApp("ps2"); }
    else props.onPlay(g);
  }
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

  // built-in games, then the two "consoles" — each opens its own home with a
  // browsable library (your games + a downloadable catalog) inside it
  const ps2Count = () => games().filter((g) => g.sys === "ps2").length;
  const pspCount = () => games().filter((g) => g.core === "psp").length;
  const psxCount = () => games().filter((g) => g.core === "psx").length;
  const retroCount = () => games().filter((g) => g.sys !== "ps2" && g.core !== "psp" && g.core !== "psx").length;
  const [rpgCount, setRpgCount] = createSignal(0);
  const [renpyCount, setRenpyCount] = createSignal(0);
  const [webCount, setWebCount] = createSignal(0);
  const gameItems = createMemo<XmbItem[]>(() => [
    { id: "doom", title: "DOOM", sub: "Built-in game · the 1993 shareware, playable now", icon: "skull", action: { type: "doom" } },
    ...(hasWebGPU() ? [{ id: "doomrtx", title: "DOOM RTX", sub: "E1M1 path-traced in real time — WebGPU ray tracing", icon: "lightning", action: { type: "doom-rtx" as const } }] : []),
    { id: "chess", title: "Chess vs Stockfish", sub: "Built-in game · the real engine, on this device", icon: "knight", action: { type: "chess" } },
    { id: "trivia", title: "Trivia Arcade", sub: "Built-in game · 10 questions, endless rounds", icon: "question", action: { type: "trivia" } },
    { id: "flash", title: "Flash Arcade", sub: "Built-in arcade · classic Flash games, streamed", icon: "lightning", action: { type: "flash" } },
    { id: "ps2", title: "PlayStation 2", sub: `Library, downloads & 2-player online${ps2Count() ? ` · ${ps2Count()} in your shelf` : ""}`, icon: "disc", action: { type: "ps2-home" } },
    { id: "ps1", title: "PlayStation", sub: `The original — .chd/.pbp discs, no BIOS needed${psxCount() ? ` · ${psxCount()} in your shelf` : ""}`, icon: "disc", action: { type: "ps1-home" } },
    { id: "psp", title: "PlayStation Portable", sub: `PSP library & downloads — experimental (PPSSPP)${pspCount() ? ` · ${pspCount()} in your shelf` : ""}`, icon: "handheld", action: { type: "psp-home" } },
    { id: "retro", title: "Retro Games", sub: `NES · SNES · GBA · N64 & more — library + downloads${retroCount() ? ` · ${retroCount()} in your shelf` : ""}`, icon: "gamepad", action: { type: "retro-home" } },
    { id: "scummvm", title: "Point & Click", sub: "ScummVM in wasm — classic adventures, free ones included", icon: "cursor", action: { type: "scummvm" } },
    { id: "rpgmaker", title: "RPG Maker", sub: `Drop a zip of a game you own — MV/MZ play natively, 2000/2003 via EasyRPG${rpgCount() ? ` · ${rpgCount()} in your library` : ""}`, icon: "rpgmaker", action: { type: "rpg-maker" } },
    { id: "renpy", title: "Ren'Py", sub: `Drop a Ren'Py Web build — visual novels, experimental${renpyCount() ? ` · ${renpyCount()} in your library` : ""}`, icon: "renpy", action: { type: "renpy" as const } },
    { id: "webgames", title: "Web & Engine Games", sub: `Drop a web-exported game — Godot · Unity · WebGL · Wolf RPG${webCount() ? ` · ${webCount()} in your library` : ""}`, icon: "gamepad", action: { type: "web-games" as const } },
    { id: "lichesstv", title: "Lichess TV", sub: "Spectate · live grandmaster games", icon: "knight", action: { type: "lichess-tv" } },
  ]);

  const RETRO_SYSTEMS = ["gba", "gb", "nes", "snes", "segaMD", "n64", "nds"] as const;

  const musicItems = createMemo<XmbItem[]>(() => [
    { id: "radio-guide", title: "Radio Stations", sub: "Search ~3,000 live stations worldwide", icon: "wave", action: { type: "radio-guide" } },
    { id: "podcasts", title: "Podcasts", sub: "Search any show — plays in the background", icon: "mic", action: { type: "podcasts" } },
    { id: "winamp", title: "Winamp", sub: "The 1997 legend, resurrected in JS", icon: "equalizer", action: { type: "webamp" } },
    { id: "karaoke", title: "Karaoke", sub: "Any song you own — vocals cancelled live, you sing", icon: "mic", action: { type: "karaoke" } },
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
    { id: "visualizer", title: "Visualizer", sub: "Music visualizations — reacts to the radio & mic", icon: "wave", action: { type: "visualizer" } },
    { id: "studio", title: "Studio", sub: "Playable synth, drum machine & MIDI — synthesized live", icon: "note", action: { type: "studio" } },
    { id: "strudel", title: "Live Code", sub: "Strudel — algorithmic beats typed live (TidalCycles)", icon: "pen", action: { type: "strudel" } },
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
    { id: "tv-guide", title: "Channel Guide", sub: "Search ~17,000 live channels worldwide", icon: "tv", action: { type: "tv-guide" } },
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
      ? [{ id: "slideshow", title: "Photo Library", sub: `${photos().length} photo${photos().length > 1 ? "s" : ""} · browse — slideshow on demand`, icon: "camera", action: { type: "photos-view" as const } }]
      : []),
    { id: "photos-add", title: "Add Photos…", sub: "Stored in this browser only — never uploaded", icon: "plus", action: { type: "photos-add" } },
    { id: "photomode", title: "Photo Mode", sub: "Snapshot the living console — framed, shareable, on-device", icon: "camera", action: { type: "photo-mode" } },
    { id: "art", title: "Art Gallery", sub: "Masterpieces · The Met, New York", icon: "palette", action: { type: "art" } },
    { id: "apod", title: "Astronomy Photo of the Day", sub: "Live from NASA", icon: "star", action: { type: "apod" } },
  ]);

  // one gate for every category: Labs-disabled apps simply don't exist here
  const itemsOf = (ci: number): XmbItem[] =>
    (CATEGORIES[ci].id === "game" ? gameItems()
    : CATEGORIES[ci].id === "music" ? musicItems()
    : CATEGORIES[ci].id === "tv" ? tvItems()
    : CATEGORIES[ci].id === "news" ? newsItems()
    : CATEGORIES[ci].id === "photo" ? photoItems()
    : CATEGORIES[ci].items).filter((i) => labEnabled(i.id));

  const selOf = (ci: number) => Math.min(sels()[CATEGORIES[ci].id] ?? 0, Math.max(0, itemsOf(ci).length - 1));

  // a category with every app switched off in Labs simply leaves the crossbar;
  // cat() stays a raw CATEGORIES index, only rendering + nav use visible slots
  const visCats = createMemo(() => CATEGORIES.map((_, i) => i).filter((i) => itemsOf(i).length > 0));
  const visPos = (i: number) => Math.max(0, visCats().indexOf(i));

  const refreshGames = () => listGames(props.profile.id).then(setGames);
  const refreshPhotos = () => listPhotos(props.profile.id).then(setPhotos);
  const refreshRpgCounts = () => listRpgGames(props.profile.id).then((g) => {
    setRpgCount(g.filter((x) => engineFamily(x.engine) === "rpgmaker").length);
    setRenpyCount(g.filter((x) => engineFamily(x.engine) === "renpy").length);
    setWebCount(g.filter((x) => engineFamily(x.engine) === "web").length);
  });
  onMount(() => {
    refreshGames();
    refreshPhotos();
    refreshRpgCounts();
    localStorage.setItem("asp.lastProfile", props.profile.id); // tab-sync reload resumes here
    startTabSync();
    // presence joins a P2P lobby — deferred so boot stays snappy
    if (labEnabled("presence")) setTimeout(() => { if (labEnabled("presence")) void startPresence(); }, 6000);
    // a shared #setup= link landed here — offer to apply it (never silently)
    const checkSetupHash = () => void readSetupHash().then((s) => { if (s && Object.keys(s).length) setSetupImport(s); });
    checkSetupHash();
    addEventListener("hashchange", checkSetupHash);
    onCleanup(() => removeEventListener("hashchange", checkSetupHash));
  });

  // —— XMB Photo Mode: freeze the scene into a framed, shareable card ————————
  const [snapshot, setSnapshot] = createSignal<{ blob: Blob; url: string } | null>(null);
  async function takeSnapshot() {
    sfx.confirm();
    const blob = await composeSnapshot({ profile: props.profile.name, category: CATEGORIES[cat()].label });
    if (!blob) { pushToast("Photo Mode", "Couldn't capture the scene on this device"); return; }
    setSnapshot({ blob, url: URL.createObjectURL(blob) });
  }
  const closeSnapshot = () => { const s = snapshot(); if (s) URL.revokeObjectURL(s.url); setSnapshot(null); };

  // —— shared-setup import confirm ————————————————————————————————————————————
  const [setupImport, setSetupImport] = createSignal<Record<string, string> | null>(null);

  // Career Trophy Stats — first landing on Career/Projects each session pops
  // the headline numbers, PSN style
  createEffect(() => {
    if (!labEnabled("statspop")) return;
    const id = CATEGORIES[cat()]?.id;
    if ((id !== "career" && id !== "projects") || sessionStorage.getItem("asp.stats." + id)) return;
    sessionStorage.setItem("asp.stats." + id, "1");
    setTimeout(() => {
      if (id === "career") pushToast(`Career — ${CAREER.length} roles shipped`, "Slide down to walk the timeline", "gold");
      else pushToast(`Projects — ${PROJECTS.length} builds on the shelf`, "Every one opens — press ✕", "gold");
    }, 600);
  });

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
  const pushToast = (title: string, sub: string, tier?: string, icon?: string) => {
    const t: Toast = { id: toastSeq++, title, sub, tier, icon };
    setToasts((x) => [...x, t]);
    if (!tier) sfx.notify(); // trophy toasts get their own fanfare (sfx.trophy) at the call site
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
      rumble(0.9, 0.7, 320); // celebratory buzz on unlock
      pushToast(`Trophy earned — ${def.name}`, def.desc, def.tier);
      if (!hadPlat && props.profile.trophies["platinum"]) {
        setTimeout(() => { sfx.trophy(); rumble(1, 0.9, 600); pushToast(`PLATINUM — ${PLATINUM.name}`, PLATINUM.desc, "platinum"); }, 1400);
      }
    }
  };
  onMount(() => awardT("boot"));

  // ` (backquote) toggles the Control Center — keyboard twin of the PS button.
  // Capture phase so games underneath never see it; text fields keep their `.
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "`" || !e.isTrusted || !labEnabled("cc")) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      e.stopPropagation(); e.preventDefault();
      sfx.tickH();
      setCcOpen(!ccOpen());
    };
    document.addEventListener("keydown", key, true);
    onCleanup(() => document.removeEventListener("keydown", key, true));
  });

  // "/" opens global search (when not typing / in an app or overlay)
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || !e.isTrusted) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || app() || ccOpen() || saver() || searchOpen()) return;
      e.preventDefault();
      openSearch();
    };
    addEventListener("keydown", key);
    onCleanup(() => removeEventListener("keydown", key));
  });

  // Push-to-talk for the HEADER voice-command mic (the lightweight Whisper →
  // keyword path — no LLM, no model pick, no chat). Hold N on the keyboard or
  // R2 on a controller from the home screen; release to run the command.
  onMount(() => {
    const active = () => app() === null && !ccOpen() && !saver() && labEnabled("voice");
    const kd = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || !e.isTrusted || e.repeat) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || !active()) return;
      e.preventDefault();
      startVoice();
    };
    const ku = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "n" && vListening()) stopVoice(); };
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    let raf = 0, r2Prev = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const on = !!primaryPad()?.buttons[7]?.pressed; // R2
      if (on && !r2Prev && active()) startVoice();
      else if (!on && r2Prev && vListening()) stopVoice();
      r2Prev = on;
    };
    raf = requestAnimationFrame(poll);
    onCleanup(() => { removeEventListener("keydown", kd); removeEventListener("keyup", ku); cancelAnimationFrame(raf); });
  });

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
      case "ps2-home":
        sfx.confirm();
        setApp("ps2home");
        break;
      case "psp-home":
        sfx.confirm();
        setApp("psphome");
        break;
      case "ps1-home":
        sfx.confirm();
        setApp("ps1home");
        break;
      case "retro-home":
        sfx.confirm();
        setApp("retrohome");
        break;
      case "insert-disc":
        sfx.confirm();
        fileInput.click();
        break;
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
        setSpotifyOpen(true);
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
      case "doom-rtx":
        sfx.confirm();
        setApp("doomrtx");
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
      case "privacy":
        sfx.confirm();
        setApp("privacy");
        break;
      case "lichess-tv":
        sfx.confirm();
        setApp("lichess");
        break;
      case "scummvm":
        sfx.confirm();
        setApp("scummvm");
        break;
      case "rpg-maker":
        sfx.confirm();
        setApp("rpgmaker");
        break;
      case "renpy":
        sfx.confirm();
        setApp("renpy");
        break;
      case "web-games":
        sfx.confirm();
        setApp("web");
        break;
      case "karaoke":
        sfx.confirm();
        setApp("karaoke");
        break;
      case "strudel":
        sfx.confirm();
        setApp("strudel");
        break;
      case "settings-hub":
        sfx.confirm();
        setApp("settingshub");
        break;
      case "video-player":
        sfx.confirm();
        setApp("videoplayer");
        break;
      case "repo-rewind":
        sfx.confirm();
        setApp("reporewind");
        break;
      case "photo-mode":
        void takeSnapshot();
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
      case "browser":
        sfx.confirm();
        setApp("browser");
        break;
      case "visualizer":
        sfx.confirm();
        setApp("visualizer");
        break;
      case "studio":
        sfx.confirm();
        setApp("studio");
        break;
      case "code":
        sfx.confirm();
        setApp("code");
        break;
      case "manual":
        sfx.confirm();
        setApp("manual");
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
        setThemeRow(0);
        setCustomHsl(loadCustomHsl());
        setThemesOpen(true);
        break;
      case "labs": // legacy deep-link — Labs now lives inside Console Settings
        sfx.confirm();
        setApp("settingshub");
        break;
      case "sound-settings":
        sfx.confirm();
        setSoundIdx(0);
        setSoundOpen(true);
        break;
      case "sound-toggle": {
        const muted = sfx.toggleMute();
        pushToast("Sound", muted ? "Console muted" : "Console audio on");
        break;
      }
      case "rumble-toggle": {
        const on = !rumbleEnabled();
        setRumble(on);
        if (on) rumble(0.8, 0.6, 200);
        pushToast("Vibration", on ? "Controller rumble on" : "Controller rumble off");
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
            `On-device AI: ${residentModels().length
              ? residentModels().map((m) => `${m.label} (${m.sizeMB} MB, idle ${m.idleS}s)`).join(" · ")
              : "no models in memory right now"} — budget ${MODEL_BUDGET_MB} MB for this device; idle models free themselves after 3 min, downloads stay cached on disk.`,
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

  // classify any ROM/disc by extension → {sys:"ps2"} / PSP / a retro core.
  // .iso/.cso are shared by PS2 and PSP, so the home you're adding from decides
  // (prefer): PS2 home → ps2, PSP home → psp.
  function classify(name: string, prefer?: "ps2" | "psp" | "psx"): { sys?: "ps2"; core: string } | null {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pbp") return prefer === "psx" ? { core: "psx" } : { core: "psp" }; // PBP: PSP eboot or PS1 disc
    if (PSP_ONLY_EXTS.includes(ext)) return { core: "psp" };
    if (PSX_ONLY_EXTS.includes(ext)) return { core: "psx" };
    if (["iso", "cso"].includes(ext)) return prefer === "psp" ? { core: "psp" } : { sys: "ps2", core: "ps2" };
    if (ext === "chd") return prefer === "psx" ? { core: "psx" } : { sys: "ps2", core: "ps2" }; // CHD: PS2 or PS1
    if (PS2_EXTS.includes(ext)) return { sys: "ps2", core: "ps2" }; // isz — PS2 only
    if (ext === "img") return prefer === "psx" ? { core: "psx" } : null; // raw track, PS1-home only
    const core = CORES[ext];
    return core ? { core } : null;
  }

  // which system a "bring your own" file should be tagged as, set by the home
  // that opened the picker (consumed by onDisc, which the file input calls)
  let insertPrefer: "ps2" | "psp" | "psx" | undefined;

  // "Link Games from Disk…" — Chromium File System Access. Stores only handles;
  // the games stream from the user's own drive, PS2/PSP ISOs included (zero-copy).
  async function onLink(prefer?: "ps2" | "psp" | "psx") {
    if (!fsAccessSupported()) { sfx.deny(); pushToast("Not supported", "Linking needs Chrome or Edge — use Insert Cartridge to copy instead"); return; }
    let handles: FileSystemFileHandle[];
    try {
      handles = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [{ description: "Game discs & ROMs", accept: { "application/octet-stream": [".iso", ".cso", ".chd", ".isz", ".pbp", ".img", ".cue", ".ccd", ".m3u", ".gba", ".gb", ".gbc", ".nes", ".fds", ".sfc", ".smc", ".md", ".gen", ".n64", ".z64", ".v64", ".nds"] } }],
      });
    } catch { return; } // picker dismissed
    let added = 0, skipped = 0;
    for (const h of handles) {
      const cls = classify(h.name, prefer);
      if (!cls) { skipped++; continue; }
      const f = await h.getFile();
      await addGame({
        id: Math.random().toString(36).slice(2, 10), profileId: props.profile.id,
        name: h.name, core: cls.core, sys: cls.sys, size: f.size,
        addedAt: Date.now(), plays: 0, kind: "link", handle: h, origin: "disk",
      });
      added++;
    }
    await refreshGames();
    sfx.confirm();
    pushToast(added ? "Games linked" : "Nothing added", added ? `${added} game${added === 1 ? "" : "s"} on your shelf${skipped ? ` · ${skipped} skipped` : ""}` : "Unsupported file types");
    if (added && games().length >= 3) awardT("collector");
    if (added) awardT("disc");
  }

  async function onDisc(file: File) {
    const cls = classify(file.name, insertPrefer);
    insertPrefer = undefined; // consume the one-shot home context
    if (!cls) {
      sfx.deny();
      pushToast("Unreadable disc", `.${file.name.split(".").pop()} isn't a supported format`);
      return;
    }
    const rec: GameRecord = {
      id: Math.random().toString(36).slice(2, 10),
      profileId: props.profile.id,
      name: file.name,
      core: cls.core,
      sys: cls.sys,
      size: file.size,
      addedAt: Date.now(),
      plays: 0,
      kind: "copy",
      blob: file,
    };
    await addGame(rec);
    await refreshGames();
    pushToast("Disc added", `${file.name} → your game library`);
    if (games().length >= 3) awardT("collector");
    awardT("disc");
    playRecord(rec);
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
      setSpotifyOpen(true);
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
      case "browser": case "web": case "internet": return openApp("browser");
      case "visualizer": case "visualiser": return openApp("visualizer");
      case "studio": case "synth": case "music-studio": return openApp("studio");
      case "code": case "playground": case "terminal": return openApp("code");
      case "manual": case "docs": case "documentation": return openApp("manual");
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
      case "sound": case "mute": { const m = sfx.toggleMute(); pushToast("Sound", m ? "Console muted" : "Console audio on"); return true; }
      case "ai": case "assistant": return openApp("ai");
      default: return false;
    }
  }

  // —— XMB voice command: tap the mic, speak, it opens what you asked for.
  // Push-to-talk (Whisper, ~4s window) — NOT always-on, which would drain the
  // battery. Keyword-routed to aiCommand, so no LLM spin-up for "open X". ——
  const VOICE_MAP: [RegExp, string][] = [
    [/\bdoom\b/, "doom"], [/\bchess\b/, "chess"], [/lichess/, "lichess"], [/trivia/, "trivia"],
    [/flash/, "flash"], [/(ps2|playstation 2)/, "ps2"], [/(other os|kolibri|\bpc\b|linux)/, "pc"],
    [/(code|playground|terminal)/, "code"], [/guest ?book/, "guestbook"], [/(browser|internet|the web)/, "browser"],
    [/wiki/, "wiki"], [/dictionary/, "dictionary"], [/(time machine|wayback)/, "timemachine"],
    [/(planet|globe|earth|\bmap\b)/, "map"], [/weather/, "weather"], [/visuali[sz]er/, "visualizer"],
    [/(studio|synth|keyboard)/, "studio"], [/(radio|music)/, "radio"], [/(cinema|movie|film)/, "cinema"],
    [/podcast/, "podcasts"], [/winamp/, "webamp"], [/(art|gallery|museum)/, "art"],
    [/(space|astronomy|nasa|apod)/, "apod"], [/news/, "news"], [/photo/, "photos"],
    [/troph/, "trophies"], [/theme/, "themes"], [/(assistant|\bai\b|abhishek)/, "ai"],
  ];
  // The header mic is push-to-talk: start on press, run on release. No LLM,
  // no model pick — just Whisper → keyword route. Mouse click toggles it (with
  // a safety auto-stop); holding N or R2 on the home screen does the same.
  let voiceRec: { stop: () => void; done: Promise<string> } | null = null;
  let voiceSafety: any = 0;
  function startVoice() {
    if (vListening()) return;
    setVListening(true);
    sfx.tickH();
    pushToast("🎤 Listening…", "Say “open doom”, “weather”, or “search lofi on youtube”");
    voiceRec = record();
    voiceRec.done.then(processVoice).catch(() => { setVListening(false); voiceRec = null; });
  }
  function stopVoice() { if (voiceRec) voiceRec.stop(); } // resolves .done → processVoice
  function processVoice(text: string) {
    setVListening(false); voiceRec = null;
    const t = text.toLowerCase().trim();
    if (!t) { pushToast("🎤 Didn't catch that", "Try again — say “open chess”"); return; }
    // "search X on youtube"
    const yt = t.match(/(?:search|find|play|watch)\s+(.+?)\s+on\s+you\s?tube/) ?? (/you\s?tube/.test(t) ? t.match(/(?:search|find|play|watch|for)\s+(.+)/) : null);
    if (yt?.[1]) { pushToast(`🎤 “${text}”`, "Searching YouTube"); aiCommand("youtube-search", yt[1].trim()); return; }
    const hit = VOICE_MAP.find(([re]) => re.test(t));
    if (hit && aiCommand(hit[1])) { pushToast(`🎤 “${text}”`, `Opening ${hit[1]}`); return; }
    pushToast(`🎤 “${text}”`, "Say “open <app>” — e.g. doom, weather, radio, studio");
  }
  function voiceCmd() { // header-mic click: tap to start, tap again (or ~6s) to run
    if (vListening()) { stopVoice(); return; }
    startVoice();
    clearTimeout(voiceSafety);
    voiceSafety = setTimeout(() => { if (vListening()) stopVoice(); }, 6000);
  }

  // console stats for the AI's console_status tool
  const consoleStatus = () => {
    const mins = Math.round((props.profile.playtime ?? 0) / 60);
    return `${trophyCount()} trophies earned · ${games().length} game${games().length === 1 ? "" : "s"} in the library · ${mins < 60 ? mins + " min" : (mins / 60).toFixed(1) + " h"} played on this console.`;
  };

  // —— console control bus: every granular action the AI co-pilot can drive.
  // This is the console's internal "MCP" — ids + descriptions feed the agent's
  // RAG memory and system prompt, and console_control invokes them. ——
  const [mapCmd, setMapCmd] = createSignal<"tour" | "iss" | "satellite" | "">("");
  const APP_NAMES = "doom, chess, lichess, trivia, flash, ps2, pc, code, guestbook, browser, visualizer, studio, youtube, cinema, podcasts, winamp, library, wiki, dictionary, map, timemachine, art, apod, weather, tv, news, photos, trophies, whatsnew, themes, ai";
  registerActions([
    { id: "app.open", description: `Open any console app by name. Valid names: ${APP_NAMES}.`, params: [{ name: "name", description: "app name", required: true }],
      run: (a) => (aiCommand(String(a.name).toLowerCase().trim()) ? `Opened ${a.name}.` : `No app called "${a.name}". Valid: ${APP_NAMES}`) },
    { id: "youtube.search", description: "Open YouTube and search for videos, ready to play.", params: [{ name: "query", description: "what to search", required: true }],
      run: (a) => { aiCommand("youtube-search", String(a.query)); return `Searching YouTube for ${a.query}.`; } },
    { id: "map.world_tour", description: "Open Planet Earth and start the cinematic world tour — Google-Earth style dives into world cities with live weather.",
      run: () => { setMapCmd("tour"); aiCommand("map"); return "Starting the world tour."; } },
    { id: "map.iss", description: "Open Planet Earth and fly to the live position of the International Space Station.",
      run: () => { setMapCmd("iss"); aiCommand("map"); return "Flying to the ISS."; } },
    { id: "map.satellite", description: "Open Planet Earth in real satellite-imagery view.",
      run: () => { setMapCmd("satellite"); aiCommand("map"); return "Opening satellite view."; } },
    { id: "radio.lofi", description: "Play the console's generative lo-fi radio (background music).",
      run: () => { if (!sfx.radioPlaying()) sfx.radioToggle(); return "Lo-fi radio playing."; } },
    { id: "radio.stop", description: "Stop the console radio / background music.",
      run: () => { if (sfx.radioPlaying()) sfx.radioToggle(); return "Radio stopped."; } },
    { id: "settings.sound", description: "Turn the console's sound on or off (mute/unmute).", params: [{ name: "state", description: "on or off", required: true }],
      run: (a) => { const wantOn = String(a.state).toLowerCase() !== "off"; if (wantOn === sfx.isMuted()) sfx.toggleMute(); return `Sound ${wantOn ? "on" : "off"}.`; } },
    { id: "settings.theme", description: `Set the console colour theme by name. Themes: ${THEMES.map((t) => t.name).join(", ")}.`, params: [{ name: "name", description: "theme name", required: true }],
      run: (a) => { const t = THEMES.find((x) => x.name.toLowerCase().includes(String(a.name).toLowerCase())); if (!t) return `No theme "${a.name}". Themes: ${THEMES.map((x) => x.name).join(", ")}`; applyTheme(t.color); pushToast("Theme", t.name); return `Theme set to ${t.name}.`; } },
    { id: "settings.clock", description: "Set the status clock to 12-hour or 24-hour format.", params: [{ name: "format", description: "12 or 24", required: true }],
      run: (a) => { const v = String(a.format).includes("24"); setClock24(v); localStorage.setItem("asp.clock24", v ? "24" : "12"); tickClock(); return `Clock set to ${v ? 24 : 12}-hour.`; } },
    { id: "settings.rumble", description: "Turn controller vibration (rumble) on or off.", params: [{ name: "state", description: "on or off", required: true }],
      run: (a) => { const on = String(a.state).toLowerCase() !== "off"; setRumble(on); if (on) rumble(0.8, 0.6, 200); return `Rumble ${on ? "on" : "off"}.`; } },
    { id: "settings.screensaver", description: "Set when the screensaver starts, in minutes (0 = off).", params: [{ name: "minutes", description: "0, 1.5, 3, 5 or 10", required: true }],
      run: (a) => { const m = parseFloat(String(a.minutes)) || 0; setSaverMins(m); localStorage.setItem("asp.saver", String(m)); return m ? `Screensaver after ${m} minutes.` : "Screensaver off."; } },
    { id: "xmb.goto", description: `Move the XMB menu to a category. Categories: ${CATEGORIES.map((c) => c.label).join(", ")}.`, params: [{ name: "category", description: "category name", required: true }],
      run: (a) => { const i = CATEGORIES.findIndex((c) => c.label.toLowerCase() === String(a.category).toLowerCase().trim()); if (i < 0) return `No category "${a.category}".`; if (!itemsOf(i).length) return `"${CATEGORIES[i].label}" is empty — its apps are switched off in Labs.`; setCat(i); return `On ${CATEGORIES[i].label}.`; } },
    { id: "trophies.show", description: "Open the trophy collection panel.", run: () => { setTrophiesOpen(true); return "Trophies open."; } },
    { id: "screensaver.start", description: "Start the screensaver (drifting clock) right now.", run: () => { setSaver(true); return "Screensaver on — any key wakes it."; } },
    { id: "console.status", description: "Report the visitor's stats: trophies, game library size, playtime.", run: () => consoleStatus() },
  ]);

  // —— global search: find & launch any app or section on the console ——
  interface SearchHit { item: XmbItem; ci: number; ii: number; cat: string }
  const searchIndex = (): SearchHit[] =>
    CATEGORIES.flatMap((c, ci) => itemsOf(ci).map((item, ii) => ({ item, ci, ii, cat: c.label })));
  const searchResults = (): SearchHit[] => {
    const q = searchQuery().toLowerCase().trim();
    const all = searchIndex();
    if (!q) return all.slice(0, 40);
    const score = (h: SearchHit) => {
      const t = h.item.title.toLowerCase(), s = (h.item.sub ?? "").toLowerCase();
      if (t.startsWith(q)) return 4;
      if (t.includes(q)) return 3;
      if (s.includes(q)) return 2;
      if (h.cat.toLowerCase().includes(q)) return 1;
      return 0;
    };
    return all.map((h) => ({ h, s: score(h) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.h);
  };
  const openSearch = () => { if (!labEnabled("search")) return; sfx.confirm(); setSearchQuery(""); setSearchSel(0); setSearchOpen(true); setTimeout(() => searchInput?.focus(), 40); };
  const launchSearch = (h: SearchHit) => {
    setSearchOpen(false);
    setCat(h.ci);
    const ri = itemsOf(h.ci).findIndex((it) => it.id === h.item.id);
    if (ri >= 0) setSels({ ...sels(), [CATEGORIES[h.ci].id]: ri });
    act(h.item);
  };

  // —— Labs guides: execute a card's "take me there" deep-link. If the flag is
  // off we switch it on first — the button IS the tutorial's payoff. ——
  const runLabGo = (id: string, go: string) => {
    if (!labEnabled(id) && id !== "crt") { toggleLab(id); setLabsTick(labsTick() + 1); }
    setLabsGuide(null);
    setLabsOpen(false);
    sfx.confirm();
    if (go.startsWith("app:")) {
      const appId = go.slice(4);
      for (let ci = 0; ci < CATEGORIES.length; ci++) {
        const items = itemsOf(ci);
        const ii = items.findIndex((i) => i.id === appId);
        if (ii >= 0) { setCat(ci); setSels({ ...sels(), [CATEGORIES[ci].id]: ii }); act(items[ii]); return; }
      }
      pushToast("Can't reach it", "That app isn't available on this device");
      return;
    }
    switch (go) {
      case "search": openSearch(); break;
      case "cc": setCcOpen(true); break;
      case "themes": setThemesOpen(true); break;
      case "saver": setSaver(true); break;
      case "restart-demo": sessionStorage.removeItem("asp.resume"); location.reload(); break;
      case "photo-mode-demo": void takeSnapshot(); break;
      case "photo-cat": {
        const pi = CATEGORIES.findIndex((c) => c.id === "photo");
        if (pi >= 0) setCat(pi);
        pushToast("Live Photos", "Add Photos… → open the Photo Library → wait for the ◈ 3D badge");
        break;
      }
    }
  };

  // —— navigation (keyboard + gamepad via onNav; mouse clicks & wheel reuse it) ——
  const handleNav = (action: Parameters<Parameters<typeof onNav>[0]>[0], src?: import("../input").NavSource) => {
    lastActive = Date.now();
    if (resting()) { exitRest(); return; }
    if (attractOn()) { setAttractOn(false); markOnboarded(); return; }
    if (Date.now() - wokeAt < 350) return; // the wake press only wakes
    // a dozen real nav actions = they know the controls; attract retires
    if (!props.profile.onboarded && ++navMastery >= 12) markOnboarded();
    if (saver()) { setSaver(false); return; }
    if (snapshot()) { // Photo Mode preview owns the pad: ✕ share · △ save · ◯ back
      if (action === "confirm") { void shareSnapshot(snapshot()!.blob).then((ok) => { if (!ok) downloadSnapshot(snapshot()!.blob); }); }
      if (action === "options") { downloadSnapshot(snapshot()!.blob); sfx.confirm(); }
      if (action === "back") { sfx.back(); closeSnapshot(); }
      return;
    }
    if (setupImport()) {
      if (action === "confirm") applySetup(setupImport()!);
      if (action === "back") { sfx.back(); setSetupImport(null); history.replaceState(null, "", location.pathname); }
      return;
    }
    if (searchOpen()) { // pad drives the search list (keyboard uses the input's own keys)
      const rs = searchResults();
      if (action === "up") { setSearchSel(Math.max(0, searchSel() - 1)); sfx.tickV(); }
      else if (action === "down") { setSearchSel(Math.min(Math.max(0, rs.length - 1), searchSel() + 1)); sfx.tickV(); }
      else if (action === "confirm") { const h = rs[searchSel()]; if (h) launchSearch(h); }
      else if (action === "back") { sfx.back(); setSearchOpen(false); }
      return;
    }
    if (ccOpen()) { ccNav?.(action); return; } // Control Center owns the pad while open
    if (padTest()) { if (action === "back") setPadTest(false); return; }
    if (app()) {
      // bound apps route their own nav; the rest are keyboard-driven owner apps
      if (["chess", "trivia", "flash", "cinema", "podcasts", "library", "youtube", "art", "wiki", "ps2home", "ps1home", "psphome", "retrohome", "karaoke", "settingshub", "videoplayer", "reporewind", "rpgmaker", "renpy", "web"].includes(app()!)) appNav?.(action);
      else if (app() === "lichess" && action === "back") { sfx.back(); setApp(null); }
      else if (src === "pad" || src === "gesture") {
        // owner apps (map/globe, lichess…) listen to the KEYBOARD — turn pad
        // presses into the keys they already handle. Never for src "key":
        // real keystrokes reach these apps directly, and doubling them would
        // fire everything twice.
        const KEY: Partial<Record<typeof action, string>> = {
          left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
          confirm: "Enter", back: "Escape",
        };
        const key = KEY[action];
        if (key) (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
      }
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
        startGestures((a) => handleNav(a, "gesture"))
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
      const n = THEMES.length + 1; // presets + the custom swatch
      const isCustom = () => themeIdx() === THEMES.length;
      const applyIdx = () => {
        if (isCustom()) { const c = customHsl(); applyCustomHsl(c.h, c.s, c.l); }
        else applyTheme(THEMES[themeIdx()].color);
        awardT("stylist");
      };
      // rows, matching the modal's visual order: 0 = swatches · 1 = Living
      // Background modes · 2-4 = custom H/S/L sliders (only when custom is picked)
      const close = () => { sfx.back(); setThemesOpen(false); setThemeRow(0); };
      if (themeRow() === 0) {
        if (action === "left") { setThemeIdx((themeIdx() + n - 1) % n); sfx.tickH(); applyIdx(); }
        if (action === "right") { setThemeIdx((themeIdx() + 1) % n); sfx.tickH(); applyIdx(); }
        if (action === "down") { setThemeRow(1); sfx.tickV(); } // → Living Background (always present)
        if (action === "back" || action === "confirm") close();
      } else if (themeRow() === 1) {
        // Living Background — ←→ cycle the mode (applies live); the active mode
        // is the on-screen focus, so no separate cursor state is needed.
        const modes = BG_MODES.filter((m) => m.id !== "fluid" || hasWebGPU());
        const cur = Math.max(0, modes.findIndex((m) => m.id === bgMode()));
        if (action === "left") { setBgMode(modes[(cur - 1 + modes.length) % modes.length].id); sfx.tickH(); }
        if (action === "right") { setBgMode(modes[(cur + 1) % modes.length].id); sfx.tickH(); }
        if (action === "up") { setThemeRow(0); sfx.tickV(); }
        if (action === "down" && isCustom()) { setThemeRow(2); sfx.tickV(); } // → sliders (custom only)
        if (action === "back" || action === "confirm") close();
      } else {
        const sliderRow = themeRow() - 2; // 0 = Hue · 1 = Saturation · 2 = Lightness
        const step = action === "left" ? -1 : action === "right" ? 1 : 0;
        if (step) {
          const c = { ...customHsl() };
          if (sliderRow === 0) c.h = (c.h + step * 6 + 360) % 360;
          if (sliderRow === 1) c.s = Math.min(90, Math.max(10, c.s + step * 4));
          if (sliderRow === 2) c.l = Math.min(75, Math.max(30, c.l + step * 3));
          setCustomHsl(c); applyCustomHsl(c.h, c.s, c.l); sfx.tickH(); awardT("stylist");
        }
        if (action === "up") { setThemeRow(themeRow() - 1); sfx.tickV(); }
        if (action === "down" && themeRow() < 4) { setThemeRow(themeRow() + 1); sfx.tickV(); }
        if (action === "back" || action === "confirm") close();
      }
      return;
    }
    if (labsOpen()) {
      const view = labsView();
      if (labsGuide()) { // a tutorial card is up — ✕ runs it, ◯ back to the list
        if (action === "back") { sfx.back(); setLabsGuide(null); setLabsWarn(null); }
        if (action === "confirm") {
          const id = labsGuide()!, g = LAB_GUIDES[id];
          if (g?.go) runLabGo(id, g.go);
          else tryToggle(id);
        }
        return;
      }
      const n = Math.max(1, view.length);
      if (action === "up") { setLabsIdx((labsIdx() + n - 1) % n); setLabsWarn(null); sfx.tickV(); }
      if (action === "down") { setLabsIdx((labsIdx() + 1) % n); setLabsWarn(null); sfx.tickV(); }
      if (action === "confirm") { const f = view[labsIdx()]; if (f) tryToggle(f.id); }
      if (action === "right" || action === "options") { const f = view[labsIdx()]; if (f) { setLabsGuide(f.id); sfx.tickH(); } }
      if (action === "back") { sfx.back(); setLabsOpen(false); }
      return;
    }
    if (soundOpen()) {
      // rows: 0 master volume · 1 navigation sounds · 2 mute
      if (action === "up") { setSoundIdx((soundIdx() + 2) % 3); sfx.tickV(); }
      if (action === "down") { setSoundIdx((soundIdx() + 1) % 3); sfx.tickV(); }
      if (action === "left" || action === "right") {
        const d = action === "left" ? -1 : 1;
        if (soundIdx() === 0) { sfx.setVolume(sfx.getVolume() + d * 0.05); sfx.tickH(); }
        if (soundIdx() === 1) {
          const packs = sfx.SND_PACKS;
          const i = packs.findIndex((p) => p.id === sfx.getSndPack());
          sfx.setSndPack(packs[(i + d + packs.length) % packs.length].id);
          sfx.tickH(); // audition the new voice immediately
        }
        if (soundIdx() === 2) sfx.toggleMute();
        setSndTick(sndTick() + 1);
      }
      if (action === "confirm" && soundIdx() === 2) { sfx.toggleMute(); setSndTick(sndTick() + 1); }
      else if (action === "back" || action === "confirm") { sfx.back(); setSoundOpen(false); }
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
    if (spotify() && spotifyOpen()) {
      if (action === "back") { sfx.back(); setSpotifyOpen(false); } // hide — keeps playing
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
      case "left": {
        const vs = visCats(), p = vs.indexOf(cat());
        if (p > 0) { setCat(vs[p - 1]); sfx.tickH(); fluidNavPulse(-1); }
        break;
      }
      case "right": {
        const vs = visCats(), p = vs.indexOf(cat());
        if (p >= 0 && p < vs.length - 1) { setCat(vs[p + 1]); sfx.tickH(); fluidNavPulse(1); }
        break;
      }
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
        if (it) { rumble(0.35, 0.25, 60); act(it); } // light tactile tick on select
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
  // the PS/Guide button (pad index 16) toggles the Control Center from
  // anywhere — even mid-game while a bridge claims the pad
  onSystemButton(() => { if (!labEnabled("cc")) return; sfx.tickH(); setCcOpen(!ccOpen()); });
  // while CC is open it owns the pad exclusively (works even mid-game), and the
  // game bridge underneath is paused so it doesn't also react to CC navigation
  createEffect(() => { setCcActive(ccOpen()); setBridgePaused(ccOpen()); });

  // mouse wheel scrolls the item list
  let wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 40) {
      handleNav(wheelAcc > 0 ? "down" : "up");
      wheelAcc = 0;
    }
  };

  // —— idle ladder: attract (untaught) → screensaver → Rest Mode ————————————
  const [saverMins, setSaverMins] = createSignal(Number(localStorage.getItem("asp.saver") ?? 1.5));
  const [attractOn, setAttractOn] = createSignal(false);
  let wokeAt = 0; // the input that wakes rest/attract must not also navigate
  // Attract is gated on BEHAVIOR, not a fragile storage flag: it can only ever
  // appear during true idle at the home screen, and the moment the player
  // proves they know the controls (or dismisses it once) the profile is
  // marked onboarded — which rides profile backups, not just this browser.
  let navMastery = 0;
  const markOnboarded = () => {
    if (props.profile.onboarded) return;
    props.profile.onboarded = Date.now();
    updateProfile(props.profile);
  };
  const poke = () => {
    lastActive = Date.now();
    if (saver()) setSaver(false);
    if (resting()) { exitRest(); wokeAt = Date.now(); }
    if (attractOn()) { setAttractOn(false); markOnboarded(); wokeAt = Date.now(); }
  };
  addEventListener("pointermove", poke);
  addEventListener("pointerdown", poke);
  addEventListener("keydown", poke);
  const saverId = setInterval(() => {
    const busy = tv() || guideOpen() || spotifyOpen() || news() || inputMode() || viewerOpen() || app() || yt() || apod() || dict();
    if (busy) return;
    const idle = Date.now() - lastActive;
    const saverMs = saverMins() > 0 ? saverMins() * 60_000 : Infinity;
    if (labEnabled("restmode") && idle > Math.min(saverMs, 3 * 60_000) + 2 * 60_000) {
      // deepest state: dim to the breathing power light, suspend audio
      if (!resting()) { setAttractOn(false); setSaver(false); enterRest(); }
    } else if (!resting() && labEnabled("attract") && !props.profile.onboarded && idle > 45_000) {
      if (!attractOn()) { setSaver(false); setAttractOn(true); }
    } else if (!resting() && !attractOn() && labEnabled("saver") && saverMins() > 0 && idle > saverMs) {
      setSaver(true);
    }
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

  // is any app / modal / overlay open? (crossbar is "home" when this is false)
  const overlayOpen = () => !!(app() || panel() || tv() || guideOpen() || spotifyOpen() || news() || inputMode() || viewerOpen() || yt() || apod() || dict() || ccOpen() || searchOpen() || labsOpen() || soundOpen() || themesOpen() || trophiesOpen() || padTest() || saver());
  // touch: on the bare crossbar, a swipe navigates natively (horizontal =
  // categories, vertical = items) and a tap opens — no virtual d-pad needed.
  // Inside an app/modal the swipe is off (that surface handles its own touch).
  let swipeStart: { x: number; y: number } | null = null;
  const onTouchStart = (e: TouchEvent) => { swipeStart = overlayOpen() ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    if (!swipeStart) return;
    const t = e.changedTouches[0], dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return; // a tap — let the item's onClick open it
    if (Math.abs(dx) > Math.abs(dy)) handleNav(dx < 0 ? "right" : "left");
    else handleNav(dy < 0 ? "down" : "up");
  };

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
    <div class="xmb" onWheel={onWheel} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
        <Show when={labEnabled("search")}>
          <button class="status-mic status-search" title="Search — find & launch anything ( / )" onClick={openSearch}><Icon name="search" /></button>
        </Show>
        <Show when={asrSupported() && labEnabled("voice")}>
          <button class="status-mic" classList={{ listening: vListening() }} title="Voice command — click, or hold N / R2 (on-device, no model)" onClick={voiceCmd}><Icon name="mic" /></button>
        </Show>
        <Show when={labEnabled("cc")}>
          <button class="status-mic status-cc" title="Control Center — phone controller, DualSense, volume, theme (` or PS button)" onClick={() => { sfx.tickH(); setCcOpen(!ccOpen()); }}><Icon name="sliders" /></button>
        </Show>
        <Show when={visitorCount() > 0}>
          <span class="status-online" title="Other visitors browsing this console right now (serverless P2P)">◉ {visitorCount() + 1} on console</span>
        </Show>
        <Show when={padName()}>
          <span class="status-pad" title={`${padName()!}${dsBattery() != null ? ` — battery ${dsBattery()}%` : ""}`}>
            <Icon name="gamepad" />
            <Show when={labEnabled("battmeter") && dsBattery() != null}>
              <span class="batt-pct" classList={{ low: dsBattery()! <= 15 }}>{dsBattery()}%</span>
            </Show>
          </span>
        </Show>
        <Show when={labEnabled("battmeter") && battery()}>
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
            <span class="batt-pct" classList={{ low: battery()!.level <= 0.15 && !battery()!.charging }}>{Math.round(battery()!.level * 100)}%</span>
          </span>
        </Show>
        <div class="status-clock">{clock()}</div>
      </div>

      {/* the XMB crossbar — horizontal categories meet the vertical item column */}
      <div class="xmb-cross" />
      {/* faint PlayStation face-button signature */}
      <div class="ps-motif">
        <Icon name="triangle" /><Icon name="circle" /><Icon name="cross" /><Icon name="square" />
      </div>

      {/* category strip — empty (fully Labs-disabled) categories don't render */}
      <div class="cat-strip" style={{ transform: `translateX(${-visPos(cat()) * CAT_SPACING}px)` }}>
        <For each={CATEGORIES}>
          {(c, i) => (
            <Show when={visCats().includes(i())}>
              <div
                class="cat"
                classList={{ active: i() === cat() }}
                style={{ left: `${visPos(i()) * CAT_SPACING}px` }}
                onClick={() => { if (i() !== cat()) { setCat(i()); sfx.tickH(); } }}
              >
                <div class="cat-icon"><Icon name={iconOf(c.id, c.icon)} /></div>
                <div class="cat-label">{tr(c.label)}</div>
              </div>
            </Show>
          )}
        </For>
      </div>

      {/* item column for the active category */}
      <div class="item-col">
        <For each={itemsOf(cat())}>
          {(item, i) => {
            const d = () => i() - selOf(cat());
            const onClick = () => {
              setSels({ ...sels(), [CATEGORIES[cat()].id]: i() });
              sfx.confirm();
              act(item);
            };
            return (
              <div
                class="item"
                classList={{ selected: d() === 0, above: d() < 0, offscreen: d() > 4 || d() < -3 }}
                style={{ transform: `translateY(${itemY(d())}px)` }}
                onClick={onClick}
              >
                <div class="item-icon"><Icon name={iconOf(item.id, item.icon)} /></div>
                <div class="item-text">
                  <div class="item-title">{tr(item.title)}</div>
                  <Show when={d() === 0 && item.sub}><div class="item-sub">{tr(item.sub!)}</div></Show>
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

      {/* spotify player — the iframe stays mounted while hidden, so the music
          keeps playing anywhere on the console; the pill brings it back */}
      <Show when={spotify()}>
        <Show when={spotifyOpen()}>
          <div class="panel-backdrop" onClick={() => setSpotifyOpen(false)} />
        </Show>
        <div class="spotify-panel" classList={{ "bg-play": !spotifyOpen() }}>
          <div class="spotify-head">
            <div class="panel-tag">SPOTIFY — {spotify()!.label.toUpperCase()}</div>
            <span class="spotify-acts">
              <button class="ghost-btn" onClick={() => { sfx.back(); setSpotifyOpen(false); }}>hide — keep playing</button>
              <button class="ghost-btn" onClick={() => { sfx.back(); setSpotifyOpen(false); setSpotify(null); }}>⏏ stop</button>
            </span>
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
          <div class="panel-hint"><span class="btn-o" /> Esc — hide, the music keeps playing · ⏏ stops it</div>
        </div>
        <Show when={!spotifyOpen()}>
          <button class="spotify-mini" onClick={() => { sfx.confirm(); setSpotifyOpen(true); }} title="Open the Spotify player">
            <Icon name="note" />
            <span>{spotify()!.label.toUpperCase()}</span>
          </button>
        </Show>
      </Show>

      {/* link input (spotify / tv channel / rss feed) */}
      <Show when={inputMode()}>
        <div class="panel-backdrop" />
        <div class="modal">
          <div class="panel-tag">{inputMode() === "spotify" ? "CONNECT SPOTIFY" : inputMode() === "tv" ? "LIVE TV" : inputMode() === "yt" ? "YOUTUBE" : "NEWS"}</div>
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
          onChanged={refreshPhotos}
          onClose={() => setViewerOpen(false)}
        />
      </Show>

      {/* ———— the wild apps ———— */}
      <Show when={app() === "doom"}><Doom onClose={() => setApp(null)} /></Show>
      <Show when={app() === "doomrtx"}><DoomRtx onClose={() => setApp(null)} /></Show>
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
      <Show when={app() === "map"}><MapApp initialAction={mapCmd()} onClose={() => { setMapCmd(""); setApp(null); }} /></Show>
      <Show when={app() === "ai"}>
        <AiChat
          profileId={props.profile.id}
          consoleStatus={consoleStatus}
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
      <Show when={app() === "privacy"}><Privacy onClose={() => setApp(null)} /></Show>
      <Show when={app() === "ps2"}><Ps2 profileId={props.profile.id} initialGame={ps2Boot() ?? undefined} initialJoin={ps2Join()} onClose={() => { setPs2Boot(null); setPs2Join(false); setApp(games().some((g) => g.sys === "ps2") ? "ps2home" : null); }} /></Show>
      <Show when={app() === "pc"}><PcApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "guestbook"}><Guestbook userName={props.profile.name} onClose={() => setApp(null)} /></Show>
      <Show when={app() === "browser"}><Browser onClose={() => setApp(null)} /></Show>
      <Show when={app() === "visualizer"}><Visualizer onClose={() => setApp(null)} /></Show>
      <Show when={app() === "studio"}><Studio onClose={() => setApp(null)} /></Show>
      <Show when={app() === "code"}><CodeApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "manual"}><Manual onClose={() => setApp(null)} /></Show>

      {/* Control Center — PS button / ` from anywhere */}
      <ControlCenter
        open={ccOpen()}
        appOpen={!!app()}
        onClose={() => setCcOpen(false)}
        onHome={() => { setPs2Boot(null); setPs2Join(false); setApp(null); }}
        onTheme={() => { setThemeIdx(currentThemeIndex()); setThemeRow(0); setCustomHsl(loadCustomHsl()); setThemesOpen(true); }}
        bind={(f) => { ccNav = f; onCcNav(f); }}
      />
      <Show when={app() === "ps2home"}>
        <GameShelf
          bind={(f) => (appNav = f)}
          profileId={props.profile.id}
          systems={["ps2"]}
          owned={games()}
          title="PLAYSTATION 2 — YOUR LIBRARY & DOWNLOADS"
          onPlay={playRecord}
          onInsert={() => { insertPrefer = "ps2"; fileInput.click(); }}
          onLink={() => onLink("ps2")}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
          extra={() => <button class="ghost-btn" onClick={() => { sfx.confirm(); setPs2Boot(null); setPs2Join(true); setApp("ps2"); }}>🎮 Join 2-player</button>}
        />
      </Show>
      <Show when={app() === "ps1home"}>
        <GameShelf
          bind={(f) => (appNav = f)}
          profileId={props.profile.id}
          systems={["psx"]}
          owned={games()}
          title="PLAYSTATION — YOUR PS1 LIBRARY"
          onPlay={playRecord}
          onInsert={() => { insertPrefer = "psx"; fileInput.click(); }}
          onLink={() => onLink("psx")}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
        />
      </Show>
      <Show when={app() === "psphome"}>
        <GameShelf
          bind={(f) => (appNav = f)}
          profileId={props.profile.id}
          systems={["psp"]}
          owned={games()}
          title="PLAYSTATION PORTABLE — YOUR LIBRARY & DOWNLOADS"
          onPlay={playRecord}
          onInsert={() => { insertPrefer = "psp"; fileInput.click(); }}
          onLink={() => onLink("psp")}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
        />
      </Show>
      <Show when={app() === "retrohome"}>
        <GameShelf
          bind={(f) => (appNav = f)}
          profileId={props.profile.id}
          systems={[...RETRO_SYSTEMS]}
          owned={games()}
          title="RETRO GAMES — YOUR LIBRARY & DOWNLOADS"
          onPlay={playRecord}
          onInsert={() => fileInput.click()}
          onLink={onLink}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
        />
      </Show>
      <Show when={app() === "karaoke"}>
        <Karaoke bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "settingshub"}>
        <SettingsApp
          bind={(f) => (appNav = f)}
          onClose={() => setApp(null)}
          onOpenThemes={() => { setApp(null); setThemeIdx(currentThemeIndex()); setThemeRow(0); setCustomHsl(loadCustomHsl()); setThemesOpen(true); }}
          onLabGo={(id, go) => { setApp(null); runLabGo(id, go); }}
        />
      </Show>
      <Show when={app() === "videoplayer"}>
        <VideoPlayer bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "rpgmaker"}>
        <RpgMaker family="rpgmaker" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
      </Show>
      <Show when={app() === "renpy"}>
        <RpgMaker family="renpy" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
      </Show>
      <Show when={app() === "web"}>
        <RpgMaker family="web" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
      </Show>
      <Show when={app() === "reporewind"}>
        <RepoRewind bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "strudel"}>
        {/* Strudel (TidalCycles for the web) with a lo-fi starter pattern baked
            into the hash — edit anything, ctrl+enter re-evaluates live */}
        <div class="fullapp">
          <iframe credentialless={true} class="fullapp-frame" src="https://strudel.cc/#Ly8gQWJoaXNoZWtTdGF0aW9uIOKAlCBsaXZlLWNvZGVkIGxvLWZpLiBFZGl0IGFueXRoaW5nLCBjdHJsK2VudGVyIHRvIHVwZGF0ZS4Kc2V0Y3BzKDAuNSkKc3RhY2soCiAgcygiYmQgfiBbfiBiZF0gfiwgfiBzZCB+IHNkLCBoaCo4IikuYmFuaygiUm9sYW5kVFI5MDkiKS5nYWluKDAuOCksCiAgbm90ZSgiPGMyIGViMiBnMiBmMj4iKS5zKCJzYXd0b290aCIpLmxwZig2MDApLnJlbGVhc2UoMC4yKSwKICBuKCIwIDMgNyA8MTAgMTI+Iikuc2NhbGUoIkM6bWlub3IiKS5zKCJwaWFubyIpLnJvb20oMC40KS5zbG93KDIpCik=" allow="autoplay; microphone; midi" title="Strudel — live coding" />
          <button class="session-eject" onClick={() => { sfx.back(); setApp(null); }}>⏏ CLOSE</button>
        </div>
      </Show>
      <Show when={app() === "scummvm"}>
        {/* ScummVM compiled to WebAssembly (chkuendig's hosted build). Bring
            your own classic adventures via its cloud-storage hookups — and
            Beneath a Steel Sky is legally freeware, playable right away. */}
        <div class="fullapp">
          <iframe credentialless={true} class="fullapp-frame" src="https://scummvm.kuendig.io/" allow="fullscreen; autoplay" title="ScummVM — point & click classics" />
          <button class="session-eject" onClick={() => { sfx.back(); setApp(null); }}>⏏ CLOSE</button>
        </div>
      </Show>
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
              <DepthPhoto class="apod-img" src={apod()!.data!.hdurl ?? apod()!.data!.url} alt="" />
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

      {/* Rest Mode — the console breathes in the dark; any input resumes */}
      <Show when={resting()}>
        <div class="rest">
          <div class="rest-led" />
          <div class="rest-word">REST MODE</div>
        </div>
      </Show>

      {/* Attract Mode — the console demos its own controls to the untaught */}
      <Show when={attractOn()}>
        <div class="attract">
          <div class="attract-mark">A B H I S H E K S T A T I O N</div>
          <div class="attract-card">
            <For each={[
              { keys: ["←", "→"], text: "browse the categories" },
              { keys: ["↑", "↓"], text: "pick an app" },
              { keys: ["ENTER"], text: "launch it" },
              { keys: ["/"], text: "search everything" },
              { keys: ["`"], text: "control center" },
            ]}>
              {(s, i) => (
                <div class="attract-step" style={{ "animation-delay": `${i() * 3.2}s` }}>
                  <span class="attract-keys"><For each={s.keys}>{(k) => <kbd class="attract-key">{k}</kbd>}</For></span>
                  <span class="attract-text">{s.text}</span>
                </div>
              )}
            </For>
          </div>
          <div class="attract-hint">PRESS ANYTHING TO TAKE OVER</div>
        </div>
      </Show>

      {/* Photo Mode preview — full-screen, PS screenshot-viewer style */}
      <Show when={snapshot()}>
        <div class="snapview">
          <div class="snapview-tag">PHOTO MODE</div>
          <img class="snapview-img" src={snapshot()!.url} alt="Console snapshot" />
          <div class="snapview-bar">
            <button class="ps-glyph-act" onClick={() => { void shareSnapshot(snapshot()!.blob).then((ok) => { if (!ok) downloadSnapshot(snapshot()!.blob); }); }}>
              <span class="btn-x" /> share
            </button>
            <button class="ps-glyph-act" onClick={() => { downloadSnapshot(snapshot()!.blob); sfx.confirm(); }}>△ save png</button>
            <button class="ps-glyph-act" onClick={closeSnapshot}><span class="btn-o" /> back</button>
          </div>
        </div>
      </Show>

      {/* shared-setup import — the classic PS full-width band dialog */}
      <Show when={setupImport()}>
        <div class="psdialog-scrim">
          <div class="psdialog">
            <div class="psdialog-title">SHARED CONSOLE SETUP</div>
            <p class="psdialog-body">This link carries someone's console settings — theme, Labs flags, icons, fonts and language ({Object.keys(setupImport()!).length} keys). Apply them to this console? Your games, photos and profiles are untouched.</p>
            <div class="psdialog-acts">
              <button class="psdialog-btn primary" onClick={() => applySetup(setupImport()!)}>Apply & Restart</button>
              <button class="psdialog-btn" onClick={() => { sfx.back(); setSetupImport(null); history.replaceState(null, "", location.pathname); }}>Keep Mine</button>
            </div>
            <div class="psdialog-hint"><span class="btn-x" /> apply · <span class="btn-o" /> keep mine</div>
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
          <div class="modal-title">{themeIdx() < THEMES.length ? THEMES[themeIdx()].name : "Custom colour"}</div>
          <div class="theme-row">
            <For each={THEMES}>
              {(t, i) => (
                <div
                  class="theme-swatch"
                  classList={{ active: i() === themeIdx() && themeRow() === 0 }}
                  style={{ background: t.color ?? "conic-gradient(#8a8f98,#c8b45a,#7fb069,#3fa7a0,#4a7fc8,#8e6bb4,#c85555,#8a8f98)" }}
                  onClick={() => { setThemeIdx(i()); setThemeRow(0); applyTheme(t.color); sfx.tickH(); awardT("stylist"); }}
                />
              )}
            </For>
            {/* the custom swatch — a hue wheel */}
            <div
              class="theme-swatch theme-swatch-custom"
              classList={{ active: themeIdx() === THEMES.length && themeRow() === 0 }}
              style={{ background: "conic-gradient(hsl(0 60% 55%),hsl(60 60% 55%),hsl(120 60% 55%),hsl(180 60% 55%),hsl(240 60% 55%),hsl(300 60% 55%),hsl(360 60% 55%))" }}
              onClick={() => { setThemeIdx(THEMES.length); setThemeRow(0); const c = customHsl(); applyCustomHsl(c.h, c.s, c.l); sfx.tickH(); awardT("stylist"); }}
            />
          </div>
          <div class="bg-modes">
            <span class="bg-modes-label">LIVING BACKGROUND</span>
            <div class="bg-modes-row">
              <For each={BG_MODES.filter((m) => m.id !== "fluid" || hasWebGPU())}>
                {(m) => (
                  <button class="bg-mode" classList={{ active: bgMode() === m.id, cursor: themeRow() === 1 && bgMode() === m.id }}
                    onClick={() => { setThemeRow(1); setBgMode(m.id); sfx.tickH(); }}>
                    <span class="bg-mode-name">{m.label}</span>
                    <span class="bg-mode-sub">{m.sub}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
          <Show when={themeIdx() === THEMES.length}>
            <div class="theme-sliders">
              <For each={[
                { label: "Hue", key: "h" as const, min: 0, max: 360 },
                { label: "Saturation", key: "s" as const, min: 10, max: 90 },
                { label: "Lightness", key: "l" as const, min: 30, max: 75 },
              ]}>
                {(s, i) => (
                  <div class="theme-slider" classList={{ active: themeRow() === i() + 2 }}>
                    <span class="theme-slider-label">{s.label}</span>
                    <input
                      type="range" min={s.min} max={s.max} value={customHsl()[s.key]}
                      onInput={(e) => {
                        const c = { ...customHsl(), [s.key]: +e.currentTarget.value };
                        setCustomHsl(c); applyCustomHsl(c.h, c.s, c.l); awardT("stylist");
                      }}
                    />
                    <span class="theme-slider-val">{customHsl()[s.key]}{s.key === "h" ? "°" : "%"}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="modal-hint">←→ preview · {themeIdx() === THEMES.length ? "↑↓ pick a slider · " : ""}ENTER / Esc — done</div>
        </div>
      </Show>

      <Show when={searchOpen()}>
        <div class="panel-backdrop" onClick={() => setSearchOpen(false)} />
        <div class="search-overlay">
          <div class="search-bar">
            <span class="search-ico"><Icon name="search" /></span>
            <input
              ref={searchInput}
              class="search-input"
              placeholder="Search apps & sections…"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                const rs = searchResults();
                if (e.key === "ArrowDown") { e.preventDefault(); setSearchSel(Math.min(Math.max(0, rs.length - 1), searchSel() + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setSearchSel(Math.max(0, searchSel() - 1)); }
                else if (e.key === "Enter") { const h = rs[searchSel()]; if (h) launchSearch(h); }
                else if (e.key === "Escape") { sfx.back(); setSearchOpen(false); }
              }}
            />
            <span class="search-count">{searchResults().length}</span>
          </div>
          <div class="search-results">
            <For each={searchResults()}>
              {(h, i) => (
                <button
                  class="search-result"
                  classList={{ active: searchSel() === i() }}
                  onMouseEnter={() => setSearchSel(i())}
                  onClick={() => launchSearch(h)}
                >
                  <span class="search-result-ico"><Icon name={h.item.icon} /></span>
                  <span class="search-result-info">
                    <span class="search-result-title">{h.item.title}</span>
                    <Show when={h.item.sub}><span class="search-result-sub">{h.item.sub}</span></Show>
                  </span>
                  <span class="search-result-cat">{h.cat}</span>
                </button>
              )}
            </For>
            <Show when={!searchResults().length}><div class="search-empty">No matches for “{searchQuery()}”</div></Show>
          </div>
          <div class="modal-hint">type to filter · ↑↓ move · <span class="btn-x" /> open · <span class="btn-o" /> close</div>
        </div>
      </Show>

      <Show when={labsOpen()}>
        <div class="panel-backdrop" onClick={() => setLabsOpen(false)} />
        <div class="modal labs-modal">
          <div class="panel-tag">LABS — FEATURE FLAGS</div>
          {/* tutorial card — what the feature is, how to try it, and a jump straight to it */}
          <Show when={labsGuide()} keyed>
            {(gid) => {
              const g = LAB_GUIDES[gid];
              const f = LAB_FLAT.find((x) => x.id === gid);
              return (
                <div class="labs-guide">
                  <div class="labs-guide-head">
                    <span class="labs-guide-title">{f?.title ?? gid}</span>
                    <span class="labs-guide-state" classList={{ on: (labsTick(), labEnabled(gid)) }}>{(labsTick(), labEnabled(gid)) ? "● ENABLED" : "○ OFF"}</span>
                  </div>
                  <p class="labs-guide-what">{g?.what ?? f?.desc}</p>
                  <div class="labs-guide-try">HOW TO TRY IT</div>
                  <ol class="labs-guide-steps"><For each={g?.steps ?? []}>{(s) => <li>{s}</li>}</For></ol>
                  {(() => {
                    const v = rateFeature(gid);
                    if (!v) return null;
                    return (
                      <div class={`labs-guide-fit ${v.level}`}>
                        <div class="labs-guide-fit-head">
                          {v.level === "ready" ? "✓ SUITS THIS CONSOLE" : v.level === "caution" ? "⚠ RUNS HERE — WITH CAUTION" : "✕ NOT BUILT FOR THIS CONSOLE"}
                        </div>
                        <For each={v.notes}>{(note) => <div class="labs-guide-fit-note">· {note}</div>}</For>
                        <div class="labs-guide-fit-rec">{v.rec} — this console: {deviceSummary()}</div>
                      </div>
                    );
                  })()}
                  <div class="labs-guide-actions">
                    <Show when={g?.go && (g.needs !== "webgpu" || hasWebGPU())}>
                      <button class="labs-go" onClick={() => runLabGo(gid, g!.go!)}>▶ {g?.goLabel ?? "TAKE ME THERE"}</button>
                    </Show>
                    <button class="labs-go ghost" classList={{ warn: labsWarn() === gid }} onClick={() => tryToggle(gid)}>
                      {(labsTick(), labEnabled(gid)) ? "SWITCH OFF" : labsWarn() === gid ? "⚠ ENABLE ANYWAY" : "SWITCH ON"}
                    </button>
                  </div>
                  <div class="modal-hint"><span class="btn-x" /> {g?.go ? (g?.goLabel?.toLowerCase() ?? "take me there") : "toggle"} · <span class="btn-o" /> back to the list</div>
                </div>
              );
            }}
          </Show>
          <Show when={!labsGuide()}>
          <div class="labs-note">Every feature and app ships on. Flip anything off to declutter the console — turn it back on any time. Press → on any row for its guide. {(labsTick(), null)}</div>
          <div class="labs-device">THIS CONSOLE · {deviceSummary()} <span class="labs-device-legend">✓ suits it · ⚠ heavy here · ✕ can't run</span></div>
          <div class="labs-search">
            <span class="labs-search-ico"><Icon name="search" /></span>
            <input
              ref={labsInput}
              class="labs-search-input"
              placeholder="Filter features & apps…"
              value={labsQuery()}
              onInput={(e) => setLabsQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                const view = labsView();
                if (e.key === "ArrowDown") { e.preventDefault(); setLabsIdx(Math.min(Math.max(0, view.length - 1), labsIdx() + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setLabsIdx(Math.max(0, labsIdx() - 1)); }
                else if (e.key === "Enter") { const f = view[labsIdx()]; if (f) tryToggle(f.id); }
                else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
                  e.preventDefault();
                  const f = view[labsIdx()];
                  if (f) { setLabsGuide(f.id); sfx.tickH(); }
                }
                else if (e.key === "Escape") { sfx.back(); setLabsOpen(false); }
              }}
            />
          </div>
          <div class="labs-list">
            <For each={labsGroupsView()}>
              {(g) => (
                <div class="labs-group">
                  <div class="labs-group-head"><span class="labs-group-ico"><Icon name={g.icon} /></span>{g.group}</div>
                  <For each={g.items}>
                    {(f) => {
                      const my = () => labsView().indexOf(f);
                      return (
                        <button
                          class="labs-row"
                          classList={{ active: labsIdx() === my() }}
                          onClick={() => { setLabsIdx(my()); tryToggle(f.id); }}
                        >
                          <span class="labs-info">
                            <span class="labs-title">
                              {f.title}
                              {(() => { const v = rateFeature(f.id); return v ? <span class={`labs-fit ${v.level}`}>{v.level === "ready" ? "✓" : v.level === "caution" ? "⚠" : "✕"}</span> : null; })()}
                            </span>
                            <Show when={labsWarn() === f.id} fallback={<Show when={f.desc}><span class="labs-desc">{f.desc}</span></Show>}>
                              <span class="labs-desc labs-warn-text">⚠ {rateFeature(f.id)?.notes[0] ?? "heavy for this device"} — press again to enable anyway</span>
                            </Show>
                          </span>
                          <span
                            class="labs-guide-btn" title="Guide — what it is & how to try it" role="button"
                            onClick={(e) => { e.stopPropagation(); setLabsIdx(my()); setLabsGuide(f.id); sfx.tickH(); }}
                          ><Icon name="question" /></span>
                          <span class="labs-switch" classList={{ on: (labsTick(), labEnabled(f.id)) }}><span class="labs-knob" /></span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
            <Show when={!labsView().length}><div class="search-empty">No features match “{labsQuery()}”</div></Show>
          </div>
          <div class="modal-hint">type to filter · ↑↓ browse · <span class="btn-x" /> toggle · → guide · <span class="btn-o" /> done</div>
          </Show>
        </div>
      </Show>

      <Show when={soundOpen()}>
        <div class="panel-backdrop" onClick={() => setSoundOpen(false)} />
        <div class="modal sound-modal">
          <div class="panel-tag">SOUND SETTINGS</div>
          <div class="sound-row" classList={{ active: soundIdx() === 0 }}>
            <span class="sound-label">Master Volume</span>
            <input
              type="range" min="0" max="100" value={(sndTick(), Math.round(sfx.getVolume() * 100))}
              onInput={(e) => { sfx.setVolume(+e.currentTarget.value / 100); setSndTick(sndTick() + 1); }}
              onChange={() => sfx.tickH()}
            />
            <span class="sound-val">{(sndTick(), Math.round(sfx.getVolume() * 100))}%</span>
          </div>
          <div class="sound-row" classList={{ active: soundIdx() === 1 }}
            onClick={() => { const packs = sfx.SND_PACKS; const i = packs.findIndex((p) => p.id === sfx.getSndPack()); sfx.setSndPack(packs[(i + 1) % packs.length].id); setSndTick(sndTick() + 1); sfx.tickH(); }}>
            <span class="sound-label">Navigation Sounds</span>
            <span class="sound-val wide">‹ {(sndTick(), sfx.SND_PACKS.find((p) => p.id === sfx.getSndPack())?.name)} ›</span>
          </div>
          <div class="sound-row" classList={{ active: soundIdx() === 2 }}
            onClick={() => { sfx.toggleMute(); setSndTick(sndTick() + 1); }}>
            <span class="sound-label">Mute Console</span>
            <span class="sound-val">{(sndTick(), sfx.isMuted()) ? "ON" : "OFF"}</span>
          </div>
          <div class="modal-hint">↑↓ row · ←→ adjust · <span class="btn-o" /> done</div>
        </div>
      </Show>

      {/* toasts */}
      <div class="toasts">
        <For each={toasts()}>
          {(t) => (
            <div class="toast" classList={{ [`tier-${t.tier}`]: !!t.tier }}>
              <span class="toast-ico" classList={{ [`tier-${t.tier}`]: !!t.tier }}>
                <Icon name={t.tier ? "trophy" : (t.icon ?? "info")} />
              </span>
              <div class="toast-body">
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
      </div>

      {/* on-screen controller — shown on touch devices; drives the exact same
          nav as the keyboard/gamepad so every app just works */}
      <div class="touchpad" classList={{ "tpad-hide": !overlayOpen() }}>
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
        accept=".iso,.cso,.chd,.isz,.pbp,.gba,.gb,.gbc,.nes,.fds,.sfc,.smc,.md,.gen,.bin,.n64,.z64,.v64,.nds"
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
