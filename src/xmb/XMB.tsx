// The cross-media bar. Horizontal categories, vertical items, info panels,
// trophies, disc drive. Navigation: arrows/WASD + Enter/Esc, or a gamepad.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CATEGORIES, TROPHIES, type XmbItem } from "../content";
import { AVATARS, PLATINUM, award, resizePhoto, updateProfile, type Profile } from "../profiles";
import { CORES, PS2_EXTS, PSP_ONLY_EXTS, addGame, listGames, addPhoto, listPhotos, fsAccessSupported, type GameRecord, type PhotoRecord } from "../gamesdb";
import { THEMES, applyCustomHsl, applyTheme, currentThemeIndex, loadCustomHsl } from "../theme";
import { LAB_APPS, labEnabled, toggleLab } from "../labs";
import { CHANNELS, fetchDevto, fetchGuide, fetchHN, fetchRadio, fetchRss, fetchWeather, wmo, type NewsEntry, type Weather } from "../apps";
import * as sfx from "../audio";
import { onCcNav, onNav, onPadChange, onSystemButton, rumble, rumbleEnabled, setCcActive, setNavEnabled, setRumble } from "../input";
import { setBridgePaused } from "../gamepadBridge";
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
  const [themeRow, setThemeRow] = createSignal(0); // 0 = swatches · 1-3 = custom H/S/L sliders
  const [customHsl, setCustomHsl] = createSignal(loadCustomHsl());
  const [labsOpen, setLabsOpen] = createSignal(false);
  const [labsIdx, setLabsIdx] = createSignal(0);
  const [labsTick, setLabsTick] = createSignal(0); // re-render pulse for toggle states
  const [soundOpen, setSoundOpen] = createSignal(false);
  const [soundIdx, setSoundIdx] = createSignal(0);
  const [sndTick, setSndTick] = createSignal(0); // re-render pulse for volume/pack/mute
  // keep the focused Labs row in view while the pad scrolls the list
  createEffect(() => { labsIdx(); labsOpen() && document.querySelector(".labs-row.active")?.scrollIntoView({ block: "nearest" }); });
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
  const [app, setApp] = createSignal<null | "doom" | "chess" | "trivia" | "flash" | "cinema" | "podcasts" | "library" | "map" | "ai" | "webamp" | "youtube" | "timemachine" | "art" | "wiki" | "lichess" | "ps2" | "pc" | "guestbook" | "browser" | "visualizer" | "studio" | "code" | "manual" | "ps2home" | "psphome" | "retrohome">(null);
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
  const retroCount = () => games().filter((g) => g.sys !== "ps2" && g.core !== "psp").length;
  const gameItems = createMemo<XmbItem[]>(() => [
    { id: "doom", title: "DOOM", sub: "Built-in game · the 1993 shareware, playable now", icon: "skull", action: { type: "doom" } },
    { id: "chess", title: "Chess vs Stockfish", sub: "Built-in game · the real engine, on this device", icon: "knight", action: { type: "chess" } },
    { id: "trivia", title: "Trivia Arcade", sub: "Built-in game · 10 questions, endless rounds", icon: "question", action: { type: "trivia" } },
    { id: "flash", title: "Flash Arcade", sub: "Built-in arcade · classic Flash games, streamed", icon: "lightning", action: { type: "flash" } },
    { id: "ps2", title: "PlayStation 2", sub: `Library, downloads & 2-player online${ps2Count() ? ` · ${ps2Count()} in your shelf` : ""}`, icon: "disc", action: { type: "ps2-home" } },
    { id: "psp", title: "PlayStation Portable", sub: `PSP library & downloads — experimental (PPSSPP)${pspCount() ? ` · ${pspCount()} in your shelf` : ""}`, icon: "disc", action: { type: "psp-home" } },
    { id: "retro", title: "Retro Games", sub: `NES · SNES · GBA · N64 & more — library + downloads${retroCount() ? ` · ${retroCount()} in your shelf` : ""}`, icon: "gamepad", action: { type: "retro-home" } },
    { id: "lichesstv", title: "Lichess TV", sub: "Spectate · live grandmaster games", icon: "knight", action: { type: "lichess-tv" } },
  ]);

  const RETRO_SYSTEMS = ["gba", "gb", "nes", "snes", "segaMD", "n64", "nds"] as const;

  const musicItems = createMemo<XmbItem[]>(() => [
    { id: "radio-guide", title: "Radio Stations", sub: "Search ~3,000 live stations worldwide", icon: "globe", action: { type: "radio-guide" } },
    { id: "podcasts", title: "Podcasts", sub: "Search any show — plays in the background", icon: "mic", action: { type: "podcasts" } },
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
    { id: "visualizer", title: "Visualizer", sub: "Music visualizations — reacts to the radio & mic", icon: "wave", action: { type: "visualizer" } },
    { id: "studio", title: "Studio", sub: "Playable synth, drum machine & MIDI — synthesized live", icon: "note", action: { type: "studio" } },
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
      if (e.key !== "`" || !e.isTrusted) return;
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      e.stopPropagation(); e.preventDefault();
      sfx.tickH();
      setCcOpen(!ccOpen());
    };
    document.addEventListener("keydown", key, true);
    onCleanup(() => document.removeEventListener("keydown", key, true));
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
      case "labs":
        sfx.confirm();
        setLabsIdx(0);
        setLabsOpen(true);
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
  function classify(name: string, prefer?: "ps2" | "psp"): { sys?: "ps2"; core: string } | null {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (PSP_ONLY_EXTS.includes(ext)) return { core: "psp" };
    if (["iso", "cso"].includes(ext)) return prefer === "psp" ? { core: "psp" } : { sys: "ps2", core: "ps2" };
    if (PS2_EXTS.includes(ext)) return { sys: "ps2", core: "ps2" }; // chd/isz — PS2 only
    const core = CORES[ext];
    return core ? { core } : null;
  }

  // which system a "bring your own" file should be tagged as, set by the home
  // that opened the picker (consumed by onDisc, which the file input calls)
  let insertPrefer: "ps2" | "psp" | undefined;

  // "Link Games from Disk…" — Chromium File System Access. Stores only handles;
  // the games stream from the user's own drive, PS2/PSP ISOs included (zero-copy).
  async function onLink(prefer?: "ps2" | "psp") {
    if (!fsAccessSupported()) { sfx.deny(); pushToast("Not supported", "Linking needs Chrome or Edge — use Insert Cartridge to copy instead"); return; }
    let handles: FileSystemFileHandle[];
    try {
      handles = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [{ description: "Game discs & ROMs", accept: { "application/octet-stream": [".iso", ".cso", ".chd", ".isz", ".pbp", ".gba", ".gb", ".gbc", ".nes", ".fds", ".sfc", ".smc", ".md", ".gen", ".n64", ".z64", ".v64", ".nds"] } }],
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
  async function voiceCmd() {
    if (vListening()) return;
    setVListening(true);
    sfx.tickH();
    pushToast("🎤 Listening…", "Say “open doom”, “weather”, or “search lofi on youtube”");
    const rec = record();
    setTimeout(() => rec.stop(), 4000); // short command window
    let text = "";
    try { text = await rec.done; } catch { setVListening(false); return; }
    setVListening(false);
    const t = text.toLowerCase().trim();
    if (!t) { pushToast("🎤 Didn't catch that", "Try again — say “open chess”"); return; }
    // "search X on youtube"
    const yt = t.match(/(?:search|find|play|watch)\s+(.+?)\s+on\s+you\s?tube/) ?? (/you\s?tube/.test(t) ? t.match(/(?:search|find|play|watch|for)\s+(.+)/) : null);
    if (yt?.[1]) { pushToast(`🎤 “${text}”`, "Searching YouTube"); aiCommand("youtube-search", yt[1].trim()); return; }
    const hit = VOICE_MAP.find(([re]) => re.test(t));
    if (hit && aiCommand(hit[1])) { pushToast(`🎤 “${text}”`, `Opening ${hit[1]}`); return; }
    pushToast(`🎤 “${text}”`, "Say “open <app>” — e.g. doom, weather, radio, studio");
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

  // —— navigation (keyboard + gamepad via onNav; mouse clicks & wheel reuse it) ——
  const handleNav = (action: Parameters<Parameters<typeof onNav>[0]>[0], src?: import("../input").NavSource) => {
    lastActive = Date.now();
    if (saver()) { setSaver(false); return; }
    if (ccOpen()) { ccNav?.(action); return; } // Control Center owns the pad while open
    if (padTest()) { if (action === "back") setPadTest(false); return; }
    if (app()) {
      // bound apps route their own nav; the rest are keyboard-driven owner apps
      if (["chess", "trivia", "flash", "cinema", "podcasts", "library", "youtube", "art", "wiki", "ps2home", "psphome", "retrohome"].includes(app()!)) appNav?.(action);
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
      if (themeRow() === 0) {
        if (action === "left") { setThemeIdx((themeIdx() + n - 1) % n); sfx.tickH(); applyIdx(); }
        if (action === "right") { setThemeIdx((themeIdx() + 1) % n); sfx.tickH(); applyIdx(); }
        if (action === "down" && isCustom()) { setThemeRow(1); sfx.tickV(); }
        if (action === "back" || action === "confirm") { sfx.back(); setThemesOpen(false); setThemeRow(0); }
      } else {
        const step = action === "left" ? -1 : action === "right" ? 1 : 0;
        if (step) {
          const c = { ...customHsl() };
          if (themeRow() === 1) c.h = (c.h + step * 6 + 360) % 360;
          if (themeRow() === 2) c.s = Math.min(90, Math.max(10, c.s + step * 4));
          if (themeRow() === 3) c.l = Math.min(75, Math.max(30, c.l + step * 3));
          setCustomHsl(c); applyCustomHsl(c.h, c.s, c.l); sfx.tickH(); awardT("stylist");
        }
        if (action === "up") { setThemeRow(themeRow() - 1); sfx.tickV(); }
        if (action === "down" && themeRow() < 3) { setThemeRow(themeRow() + 1); sfx.tickV(); }
        if (action === "back" || action === "confirm") { sfx.back(); setThemesOpen(false); setThemeRow(0); }
      }
      return;
    }
    if (labsOpen()) {
      const n = LAB_APPS.length;
      if (action === "up") { setLabsIdx((labsIdx() + n - 1) % n); sfx.tickV(); }
      if (action === "down") { setLabsIdx((labsIdx() + 1) % n); sfx.tickV(); }
      if (action === "confirm") { toggleLab(LAB_APPS[labsIdx()].id); setLabsTick(labsTick() + 1); sfx.confirm(); }
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
      case "left": {
        const vs = visCats(), p = vs.indexOf(cat());
        if (p > 0) { setCat(vs[p - 1]); sfx.tickH(); }
        break;
      }
      case "right": {
        const vs = visCats(), p = vs.indexOf(cat());
        if (p >= 0 && p < vs.length - 1) { setCat(vs[p + 1]); sfx.tickH(); }
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
  onSystemButton(() => { sfx.tickH(); setCcOpen(!ccOpen()); });
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
        <Show when={asrSupported()}>
          <button class="status-mic" classList={{ listening: vListening() }} title="voice command (on-device)" onClick={voiceCmd}><Icon name="mic" /></button>
        </Show>
        <button class="status-mic status-cc" title="Control Center — phone controller, DualSense, volume, theme (` or PS button)" onClick={() => { sfx.tickH(); setCcOpen(!ccOpen()); }}><Icon name="sliders" /></button>
        <Show when={padName()}><span class="status-pad" title={padName()!}><Icon name="gamepad" /></span></Show>
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
                <div class="cat-icon"><Icon name={c.icon} /></div>
                <div class="cat-label">{c.label}</div>
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
          <Show when={themeIdx() === THEMES.length}>
            <div class="theme-sliders">
              <For each={[
                { label: "Hue", key: "h" as const, min: 0, max: 360 },
                { label: "Saturation", key: "s" as const, min: 10, max: 90 },
                { label: "Lightness", key: "l" as const, min: 30, max: 75 },
              ]}>
                {(s, i) => (
                  <div class="theme-slider" classList={{ active: themeRow() === i() + 1 }}>
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

      <Show when={labsOpen()}>
        <div class="panel-backdrop" onClick={() => setLabsOpen(false)} />
        <div class="modal labs-modal">
          <div class="panel-tag">LABS — YOUR CONSOLE, YOUR APPS</div>
          <div class="labs-note">Everything ships on. Switch an app off and it disappears from the crossbar — flip it back any time. {(labsTick(), null)}</div>
          <div class="labs-list">
            <For each={LAB_APPS}>
              {(a, i) => (
                <button
                  class="labs-row"
                  classList={{ active: labsIdx() === i() }}
                  onClick={() => { setLabsIdx(i()); toggleLab(a.id); setLabsTick(labsTick() + 1); sfx.confirm(); }}
                >
                  <span class="labs-cat">{a.cat}</span>
                  <span class="labs-title">{a.title}</span>
                  <span class="labs-state" classList={{ off: (labsTick(), !labEnabled(a.id)) }}>{(labsTick(), labEnabled(a.id)) ? "ON" : "OFF"}</span>
                </button>
              )}
            </For>
          </div>
          <div class="modal-hint">↑↓ browse · <span class="btn-x" /> toggle · <span class="btn-o" /> done</div>
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
