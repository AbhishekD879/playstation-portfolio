// The cross-media bar. Horizontal categories, vertical items, info panels,
// trophies, disc drive. Navigation: arrows/WASD + Enter/Esc, or a gamepad.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { CAREER, CATEGORIES, PROJECTS, TROPHIES, type XmbItem } from "../content";
import { AVATARS, PLATINUM, award, resizePhoto, updateProfile, type Profile } from "../profiles";
import { addGame, listGames, addPhoto, listPhotos, fsAccessSupported, type GameRecord, type PhotoRecord } from "../gamesdb";
import { BG_MODES, THEMES, applyCustomHsl, applyTheme, bgMode, currentThemeIndex, loadCustomHsl, setBgMode, setUpscale, upscale, frameGen, setFrameGen } from "../theme";
import { UPSCALE_MODES, upscaleSupported } from "../upscale";
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
import { ROUTE_APPS, appRouteHash, parseRouteHash } from "./routes";
import { GAME_TOP, HIDDEN_GAME_ITEMS, folderOf, type GameFolder } from "./gameFolders";
import { ALL_EXTS, SYSTEMS, classifyFile, systemsOf } from "../systems";
import PalmSession from "../emulator/PalmSession";
import FramePlayer from "../emulator/FramePlayer";
import { bootJ2me } from "../j2me";
import { biosState } from "../bios";
import { WEB_GAMES, WEB_GAME_IDS } from "../webgames";
import WebGameApp from "../emulator/WebGameApp";
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
import Ps2EnginePick from "./Ps2EnginePick";
import PcApp from "./PcApp";
import Guestbook from "./Guestbook";
import Browser from "./Browser";
import Visualizer from "./Visualizer";
import Studio from "./Studio";
import CodeApp from "./CodeApp";
import Manual from "./Manual";
import GameShelf from "./GameShelf";
import PadLadder from "./PadLadder";
import Online from "./Online";
import Doom from "./Doom";
import DoomRtx from "./DoomRtx";
import WorldDrive from "./WorldDrive";
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
import SystemCity from "./SystemCity";
import CsApp from "./CsApp";
import PartyHub from "./PartyHub";
import RetroJoin from "./RetroJoin";
import BoardGames from "./BoardGames";
import ShareBar from "./ShareBar";
import ConsoleTv from "./ConsoleTv";
import { makeRoomCode } from "../ps2mp/webrtc";
import { readPartyName } from "../ps2mp/partyName";
import Analytics from "./Analytics";
import SplatView, { isSplatFile } from "./SplatView";
import UpscaleLayer from "./UpscaleLayer";
import { dsGyroAim, dsTriggers } from "../dualsense";
import VoiceAvatar from "./VoiceAvatar";
import WikiApp from "./WikiApp";
import Privacy from "./Privacy";
import WatchParty from "./WatchParty";
import { fetchApod, define, type Apod, type Definition } from "../apps";
import { startGestures, stopGestures } from "../gestures";

const CAT_SPACING = 150;

// —— URL routing ————————————————————————————————————————————————————————————
// A refresh should land you back where you were. We mirror the open app (and, on
// the home crossbar, the current category) into the URL HASH — hash, not path,
// so it needs zero server config and never collides with the pathname-based
// /admin route or the ?pad= controller mode. Shape: `#/app/<id>` for an open app,
// `#/<categoryId>` for the home crossbar. `#setup=` share links are left alone.
/** "3h 42m" / "12m" / "48s" — playtime is stored as seconds on the profile. */
function fmtPlaytime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
// URL routes live in routes.ts (pure, tested): #/app/<id>, #/<cat>, #/<cat>/<folder>, #/room/<CODE>

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
  const [splatFile, setSplatFile] = createSignal<File | null>(null);
  const [app, setAppRaw] = createSignal<null | "doom" | "doomrtx" | "worlddrive" | "chess" | "trivia" | "flash" | "cinema" | "podcasts" | "library" | "map" | "ai" | "webamp" | "youtube" | "timemachine" | "art" | "wiki" | "lichess" | "ps2" | "pc" | "guestbook" | "browser" | "visualizer" | "studio" | "code" | "manual" | "ps2home" | "ps1home" | "psphome" | "retrohome" | "nintendohome" | "segahome" | "arcadehome" | "consoleshome" | "computershome" | "mobilehome" | "palm" | "fantasyhome" | "frame" | "micropolis" | "jazz" | "scummvm" | "karaoke" | "strudel" | "settingshub" | "videoplayer" | "reporewind" | "rpgmaker" | "renpy" | "godot" | "unity" | "html5" | "privacy" | "watch" | "syscity" | "cs" | "party" | "retrojoin" | "board" | "voiceavatar" | "consoletv" | "analytics">(null);

  // Opening/closing an app goes through the native View Transitions API (now
  // Baseline for same-document), so the console cross-fades like real system
  // software instead of snapping. Solid applies signal changes to the DOM
  // synchronously, which is exactly what startViewTransition's callback needs.
  // Falls back to a plain set where the API is missing or motion is reduced.
  const setApp: typeof setAppRaw = ((v: any) => {
    const doc = document as any;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof doc.startViewTransition !== "function" || reduced) return setAppRaw(v);
    let out: any;
    // A transition superseded by the next one rejects with AbortError, which is
    // normal (open an app, close it quickly) but surfaced as an unhandled
    // rejection in every visitor's console. The DOM change has already been
    // applied by then, so there is nothing to recover — just don't log noise.
    const t = doc.startViewTransition(() => { out = setAppRaw(v); });
    t?.finished?.catch?.(() => {});
    t?.updateCallbackDone?.catch?.(() => {});
    t?.ready?.catch?.(() => {});
    return out;
  }) as typeof setAppRaw;
  const [ps2Boot, setPs2Boot] = createSignal<GameRecord | null>(null);
  // false = not joining · true = show the code box · "ABCD" = join that room
  const [ps2Join, setPs2Join] = createSignal<boolean | string>(false);
  // Controllers for the next PS2 disc. Lives on the PS2 HOME screen, outside the
  // emulator component, so it is settled before the disc gesture exists. An
  // earlier version put this in a step BETWEEN the disc and the boot, which
  // broke player one; that space stays empty permanently.
  const [ps2Players, setPs2Players] = createSignal(1);
  // Who can join is decided on the Online screen now, before anyone arrives —
  // it used to be a panel over the running game, which is after the fact.
  const [ps2Public, setPs2Public] = createSignal(true);
  // Minted here, before the room exists, so the invite link on the Online screen
  // is the link people actually arrive on. A fresh one per room.
  const [ps2Code, setPs2Code] = createSignal(makeRoomCode());
  // The name a room calls you: chosen on this device, profile name as fallback.
  const [partyName, setPartyName] = createSignal(readPartyName(""));
  const roomName = () => partyName() || props.profile.name;
  const [tvCode, setTvCode] = createSignal<string | null>(null);
  const [ps2Lobby, setPs2Lobby] = createSignal(false);
  // armed by "host this" on the Online screen; Ps2 opens the room once the
  // game is actually running, since hosting streams the emulator's canvas
  const [ps2AutoHost, setPs2AutoHost] = createSignal(false);
  const [ps2JoinTitle, setPs2JoinTitle] = createSignal("");
  const [ccOpen, setCcOpen] = createSignal(false);
  let ccNav: ((a: Parameters<Parameters<typeof onNav>[0]>[0]) => void) | undefined;

  // route a library record to the right engine: PS2 discs boot the Play! app
  // (auto-loading the disc), everything else goes to the EmulatorJS session
  function playRecord(g: GameRecord) {
    // a system that cannot boot without firmware says so here, in the console's
    // words, instead of letting the core crash on an empty BIOS folder
    const spec = SYSTEMS[g.core]?.bios;
    if (spec?.required) {
      void biosState(g.core).then((st) => {
        if (st.ok) { launchRecord(g); return; }
        sfx.deny();
        const need = spec.match ? `a .${spec.match} file` : spec.anyOf ? `one of ${st.missing.join(", ")}` : st.missing.join(", ");
        pushToast(`${SYSTEMS[g.core].name} needs its BIOS`, `Add ${need} under Systems on this shelf, then play again`);
      });
      return;
    }
    launchRecord(g);
  }
  function launchRecord(g: GameRecord) {
    awardT("disc");
    if (g.sys === "ps2") { setPs2Boot(g); setPs2Join(false); setApp("ps2"); }
    else if (g.core === "palm") { setPalmBoot(g); setApp("palm"); }
    else if (SYSTEMS[g.core]?.engine === "frame") { setFrameBoot(g); setApp("frame"); }
    else if (SYSTEMS[g.core]?.engine === "tab") { if (!bootJ2me(g, SYSTEMS[g.core].tab)) pushToast("Pop-up blocked", "Allow pop-ups for this site — Java ME games open in their own tab"); }
    else props.onPlay(g);
  }
  // DEV ONLY. Boots a disc straight into the PS2 app, bypassing the library so
  // a 4GB ISO is never copied into IndexedDB. Exists because the two real entry
  // points — showOpenFilePicker and a library record — cannot be driven from an
  // automated browser, which made the multiplayer paths untestable without a
  // human clicking through an OS file dialog. Stripped from production builds.
  if (import.meta.env.DEV) onMount(() => {
    const i = document.createElement("input");
    i.type = "file"; i.id = "devdisc"; i.hidden = true;
    i.onchange = () => {
      const f = i.files?.[0];
      if (!f) return;
      // data-players on the input picks the seat count the Online screen would
      setPs2Players(Math.max(1, Math.min(6, Number(i.dataset.players) || 1)));
      setPs2Boot({
        id: "dev", profileId: props.profile.id, name: f.name, core: "ps2", sys: "ps2",
        size: f.size, addedAt: Date.now(), plays: 0, kind: "copy", blob: f,
      } as GameRecord);
      setPs2Join(false); setApp("ps2");
    };
    document.body.appendChild(i);
    onCleanup(() => i.remove());
  });

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
  let splatInput!: HTMLInputElement;
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
  const [godotCount, setGodotCount] = createSignal(0);
  const [unityCount, setUnityCount] = createSignal(0);
  const [html5Count, setHtml5Count] = createSignal(0);
  // Platform shelves: which library systems each home shows. RETRO_SYSTEMS (the
  // old all-in-one shelf) stays so #/app/retrohome keeps working.
  const NINTENDO_SYSTEMS = systemsOf("nintendo");
  const SEGA_SYSTEMS = systemsOf("sega");
  const ARCADE_SYSTEMS = systemsOf("arcade");
  const CONSOLE_SYSTEMS = systemsOf("consoles");
  const COMPUTER_SYSTEMS = systemsOf("computers");
  const MOBILE_SYSTEMS = systemsOf("mobile");
  const FANTASY_SYSTEMS = systemsOf("fantasy");
  // engines that live in their own page (TIC-80, WASM-4) boot through one frame player
  const [frameBoot, setFrameBoot] = createSignal<GameRecord | null>(null);
  const shelfOfFamily: Record<string, AppId> = { fantasy: "fantasyhome", mobile: "mobilehome", computers: "computershome" };
  // a Palm program boots its own player (CloudpilotEmu), like a PS2 disc boots Play!
  const [palmBoot, setPalmBoot] = createSignal<GameRecord | null>(null);
  const shelfCount = (systems: readonly string[]) => games().filter((g) => !g.sys && systems.includes(g.core)).length;

  const gameItems = createMemo<XmbItem[]>(() => [
    { id: "doom", title: "DOOM", sub: "Built-in game · the 1993 shareware, playable now", icon: "skull", action: { type: "doom" } },
    ...(hasWebGPU() ? [{ id: "doomrtx", title: "DOOM RTX", sub: "E1M1 path-traced in real time — WebGPU ray tracing", icon: "lightning", action: { type: "doom-rtx" as const } }] : []),
    { id: "worlddrive", title: "World Drive", sub: "Drive the real Earth — any street, any mountain pass, from open maps", icon: "globe", action: { type: "worlddrive" as const } },
    { id: "chess", title: "Chess vs Stockfish", sub: "Built-in game · the real engine, on this device", icon: "knight", action: { type: "chess" } },
    { id: "trivia", title: "Trivia Arcade", sub: "Built-in game · 10 questions, endless rounds", icon: "question", action: { type: "trivia" } },
    { id: "fantasy", title: "Fantasy Consoles", sub: `WASM-4 carts — 64 KB games, open format, thousands are free${shelfCount(FANTASY_SYSTEMS) ? ` · ${shelfCount(FANTASY_SYSTEMS)} in your shelf` : ""}`, icon: "cube", action: { type: "shelf", id: "fantasyhome" } },
    { id: "flash", title: "Flash Arcade", sub: "Built-in arcade · classic Flash games, streamed", icon: "lightning", action: { type: "flash" } },
    { id: "ps2", title: "PlayStation 2", sub: `Library, downloads & 2-player online${ps2Count() ? ` · ${ps2Count()} in your shelf` : ""}`, icon: "disc", action: { type: "ps2-home" } },
    { id: "ps1", title: "PlayStation", sub: `The original — .chd/.pbp discs, no BIOS needed${psxCount() ? ` · ${psxCount()} in your shelf` : ""}`, icon: "disc", action: { type: "ps1-home" } },
    { id: "psp", title: "PlayStation Portable", sub: `PSP library & downloads — experimental (PPSSPP)${pspCount() ? ` · ${pspCount()} in your shelf` : ""}`, icon: "handheld", action: { type: "psp-home" } },
    // "retro" is the old every-system shelf. It keeps its route (#/app/retrohome)
    // but the column now shows the two platform shelves below instead.
    { id: "retro", title: "Retro Games", sub: `NES · SNES · GBA · N64 & more — library + downloads${retroCount() ? ` · ${retroCount()} in your shelf` : ""}`, icon: "gamepad", action: { type: "retro-home" } },
    { id: "nintendo", title: "Nintendo", sub: `NES · Super Nintendo · Nintendo 64 · Game Boy · GBA · DS · Virtual Boy${shelfCount(NINTENDO_SYSTEMS) ? ` · ${shelfCount(NINTENDO_SYSTEMS)} in your shelf` : ""}`, icon: "gamepad", action: { type: "shelf", id: "nintendohome" } },
    { id: "sega", title: "Sega", sub: `Mega Drive · Master System · Game Gear · Sega CD · 32X · Saturn · Dreamcast${shelfCount(SEGA_SYSTEMS) ? ` · ${shelfCount(SEGA_SYSTEMS)} in your shelf` : ""}`, icon: "gamepad", action: { type: "shelf", id: "segahome" } },
    { id: "arcade", title: "Arcade", sub: `Neo Geo · CPS1/CPS2 · classic MAME — bring your romsets, insert coin${shelfCount(ARCADE_SYSTEMS) ? ` · ${shelfCount(ARCADE_SYSTEMS)} in your shelf` : ""}`, icon: "gamepad", action: { type: "shelf", id: "arcadehome" } },
    { id: "consoles", title: "More Consoles", sub: `PC Engine · Neo Geo Pocket · WonderSwan · Atari · 3DO · ColecoVision & more${shelfCount(CONSOLE_SYSTEMS) ? ` · ${shelfCount(CONSOLE_SYSTEMS)} in your shelf` : ""}`, icon: "handheld", action: { type: "shelf", id: "consoleshome" } },
    { id: "mobile", title: "Mobile", sub: `Palm OS and Java ME — bring your Palm ROM and .prc programs, or Nokia-era .jar games${shelfCount(MOBILE_SYSTEMS) ? ` · ${shelfCount(MOBILE_SYSTEMS)} in your shelf` : ""}`, icon: "phone", action: { type: "shelf", id: "mobilehome" } },
    { id: "computers", title: "Computers", sub: `Amiga · Commodore 64 · ZX Spectrum · Amstrad CPC · your own PC disk image (Windows 95/98, DOS)${shelfCount(COMPUTER_SYSTEMS) ? ` · ${shelfCount(COMPUTER_SYSTEMS)} in your shelf` : ""}`, icon: "monitor", action: { type: "shelf", id: "computershome" } },
    { id: "cs", title: "Counter-Strike 1.6", sub: "The classic FPS in your browser — bring your files · bots & online with friends", icon: "gamepad", action: { type: "cs" as const } },
    { id: "retrojoin", title: "Join a Retro Game", sub: "Player two for a friend's NES/SNES game — they stream it, you just play", icon: "gamepad", action: { type: "retrojoin" as const } },
    { id: "consoletv", title: "Console TV", sub: "Watch whatever is being played on this console right now — no controller needed", icon: "broadcast", action: { type: "consoletv" as const } },
    { id: "party", title: "Party Games", sub: "Jackbox-style — everyone joins with their phone. Trivia, Bluff, Quips & Draw & Guess", icon: "gamepad", action: { type: "party" as const } },
    { id: "board", title: "Board Games", sub: "Play a friend online — Connect Four, Gomoku, Reversi, Checkers & Ludo", icon: "knight", action: { type: "board" as const } },
    { id: "scummvm", title: "Point & Click", sub: "ScummVM in wasm — classic adventures, free ones included", icon: "cursor", action: { type: "scummvm" } },
    { id: "rpgmaker", title: "RPG Maker", sub: `Drop a zip of a game you own — MV/MZ play natively, 2000/2003 via EasyRPG${rpgCount() ? ` · ${rpgCount()} in your library` : ""}`, icon: "rpgmaker", action: { type: "rpg-maker" } },
    { id: "renpy", title: "Ren'Py", sub: `Drop a Ren'Py Web build — visual novels, experimental${renpyCount() ? ` · ${renpyCount()} in your library` : ""}`, icon: "renpy", action: { type: "renpy" as const } },
    { id: "godot", title: "Godot", sub: `Drop a Godot Web export (.zip) — runs natively${godotCount() ? ` · ${godotCount()} in your library` : ""}`, icon: "gamepad", action: { type: "godot" as const } },
    { id: "unity", title: "Unity", sub: `Drop a Unity WebGL build (.zip) — runs natively${unityCount() ? ` · ${unityCount()} in your library` : ""}`, icon: "gamepad", action: { type: "unity" as const } },
    { id: "html5", title: "HTML5 / WebGL", sub: `Drop any web-exported game with an index.html${html5Count() ? ` · ${html5Count()} in your library` : ""}`, icon: "gamepad", action: { type: "html5" as const } },
    // self-hosted web games with free data — play now, nothing to bring
    ...WEB_GAME_IDS.map((id) => ({ id, title: WEB_GAMES[id].title, sub: WEB_GAMES[id].sub, icon: WEB_GAMES[id].icon, action: { type: "webgame" as const, id } })),
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
    { id: "splat", title: "Open a 3D Capture", sub: "Walk into a Gaussian splat scan from your phone — .ply / .splat / .spz", icon: "cube", action: { type: "splat" } },
    { id: "art", title: "Art Gallery", sub: "Masterpieces · The Met, New York", icon: "palette", action: { type: "art" } },
    { id: "apod", title: "Astronomy Photo of the Day", sub: "Live from NASA", icon: "star", action: { type: "apod" } },
  ]);

  // —— Games is grouped like a PlayStation groups its games ————————————————
  // The column shows folders and platform shelves (GAME_TOP); opening a folder
  // lists its members in place. Which folder is open is part of the address
  // (#/game/<folder>) and survives opening and closing an app inside it.
  const [gameFolder, setGameFolderRaw] = createSignal<string | null>(null);
  const setGameFolder = (id: string | null) => setGameFolderRaw(id && GAME_TOP.some((e) => e.kind === "folder" && e.id === id) ? id : null);
  const gameLeaves = createMemo(() => gameItems().filter((i) => labEnabled(i.id) && !HIDDEN_GAME_ITEMS.has(i.id)));
  const folderItem = (f: GameFolder, members: XmbItem[]): XmbItem => ({
    id: `folder:${f.id}`, title: f.title, icon: f.icon,
    sub: `${members.length} inside · ${f.blurb}`,
    action: { type: "folder", id: f.id },
  });
  const gameColumn = createMemo<XmbItem[]>(() => {
    const leaves = gameLeaves();
    const byId = new Map(leaves.map((i) => [i.id, i] as const));
    const open = gameFolder();
    if (open) {
      const f = GAME_TOP.find((e): e is GameFolder => e.kind === "folder" && e.id === open);
      return f ? f.items.map((id) => byId.get(id)).filter((i): i is XmbItem => !!i) : [];
    }
    const placed = new Set<string>();
    const top: XmbItem[] = [];
    for (const e of GAME_TOP) {
      if (e.kind === "item") { const it = byId.get(e.id); if (it) { top.push(it); placed.add(e.id); } continue; }
      const members = e.items.map((id) => byId.get(id)).filter((i): i is XmbItem => !!i);
      e.items.forEach((id) => placed.add(id));
      if (members.length) top.push(folderItem(e, members)); // a folder with nothing enabled inside is not shown
    }
    // safety net: anything not filed stays visible, loose at the end
    for (const it of leaves) if (!placed.has(it.id)) top.push(it);
    return top;
  });
  const gameFolderTitle = () => GAME_TOP.find((e): e is GameFolder => e.kind === "folder" && e.id === gameFolder())?.title ?? "";

  // one gate for every category: Labs-disabled apps simply don't exist here
  const itemsOf = (ci: number): XmbItem[] =>
    (CATEGORIES[ci].id === "game" ? gameColumn()
    : (CATEGORIES[ci].id === "music" ? musicItems()
    : CATEGORIES[ci].id === "tv" ? tvItems()
    : CATEGORIES[ci].id === "news" ? newsItems()
    : CATEGORIES[ci].id === "photo" ? photoItems()
    : CATEGORIES[ci].items).filter((i) => labEnabled(i.id)));

  // selection is remembered per column, and per folder inside Games
  const selKey = (ci: number) => (CATEGORIES[ci].id === "game" && gameFolder() ? `game/${gameFolder()}` : CATEGORIES[ci].id);
  const selOf = (ci: number) => Math.min(sels()[selKey(ci)] ?? 0, Math.max(0, itemsOf(ci).length - 1));
  // put the cursor on an item wherever it is filed (search, deep links)
  const revealGameItem = (id: string) => {
    const gi = CATEGORIES.findIndex((c) => c.id === "game");
    if (gi < 0) return;
    setGameFolder(folderOf(id)?.id ?? null);
    const ri = itemsOf(gi).findIndex((it) => it.id === id);
    if (ri >= 0) setSels({ ...sels(), [selKey(gi)]: ri });
  };

  // —— URL routing: restore-from-hash, then keep the hash in sync ————————————
  type AppId = Exclude<ReturnType<typeof app>, null>;
  const applyRoute = () => {
    const r = parseRouteHash(location.hash);
    if (!r) return;
    if ("room" in r) {
      // Someone sent a link. Join as a player; the host's seat map decides
      // whether that is possible, exactly as the code box would.
      if (app() === "ps2") return;
      setPs2AutoHost(false); setPs2Boot(null); setPs2JoinTitle("");
      setPs2Join(r.room); setApp("ps2");
      return;
    }
    if ("app" in r && r.app) {
      // respect the Labs gate so a shared #/app/<hidden> link can't reveal an
      // opt-in easter egg (e.g. "privacy") on a console that hasn't enabled it
      // a running Palm program is not an address — that link lands on the shelf
      const target = r.app === "palm" ? "mobilehome" : r.app === "frame" ? "fantasyhome" : r.app;
      if (labEnabled(target) && app() !== target) setApp(target as AppId);
    } else if ("cat" in r) {
      if (app()) setApp(null);
      const ci = CATEGORIES.findIndex((c) => c.id === r.cat);
      if (ci >= 0 && itemsOf(ci).length) setCat(ci);
      if (r.cat === "game") setGameFolder(r.folder ?? null);
    }
  };
  // —— DualSense, per app ————————————————————————————————————————————————
  // Motion aim and trigger tension only make sense with a gun in your hands, so
  // they're armed for the shooters and cleared for everything else. Both are
  // no-ops unless a pad is actually connected over WebHID.
  const FPS_APPS = new Set(["doom", "doomrtx", "cs"]);
  createEffect(() => {
    const shooting = FPS_APPS.has(app() ?? "") && labEnabled("gyroaim");
    dsGyroAim(shooting);
    // a firm bite point on R2 — the trigger stops being a switch and starts
    // feeling like a trigger
    dsTriggers({ mode: "off" }, shooting ? { mode: "resist", start: 0.35, force: 0.55 } : { mode: "off" });
  });

  // restore synchronously during setup so a deep link opens BEFORE the sync
  // effect below runs (otherwise its first pass would overwrite the incoming hash)
  applyRoute();
  let prevAppOpen = !!app();
  createEffect(() => {
    const a = app(), catId = CATEGORIES[cat()]?.id ?? "";
    if (/^#setup=/.test(location.hash)) { prevAppOpen = !!a; return; } // don't clobber a pending share link
    const target = appRouteHash(a, catId, catId === "game" ? gameFolder() : null);
    if (location.hash !== target) {
      // opening an app pushes a new entry (Back closes it); everything else replaces
      if (a && !prevAppOpen) history.pushState(null, "", target);
      else history.replaceState(null, "", target);
    }
    prevAppOpen = !!a;
  });
  onMount(() => {
    const onRoute = () => applyRoute();            // Back/Forward + any external hash change
    addEventListener("hashchange", onRoute);
    addEventListener("popstate", onRoute);
    onCleanup(() => { removeEventListener("hashchange", onRoute); removeEventListener("popstate", onRoute); });
  });

  // a category with every app switched off in Labs simply leaves the crossbar;
  // cat() stays a raw CATEGORIES index, only rendering + nav use visible slots
  const visCats = createMemo(() => CATEGORIES.map((_, i) => i).filter((i) => itemsOf(i).length > 0));
  const visPos = (i: number) => Math.max(0, visCats().indexOf(i));

  const refreshGames = () => listGames(props.profile.id).then(setGames);
  const refreshPhotos = () => listPhotos(props.profile.id).then(setPhotos);
  const refreshRpgCounts = () => listRpgGames(props.profile.id).then((g) => {
    setRpgCount(g.filter((x) => engineFamily(x.engine) === "rpgmaker").length);
    setRenpyCount(g.filter((x) => engineFamily(x.engine) === "renpy").length);
    setGodotCount(g.filter((x) => engineFamily(x.engine) === "godot").length);
    setUnityCount(g.filter((x) => engineFamily(x.engine) === "unity").length);
    setHtml5Count(g.filter((x) => engineFamily(x.engine) === "html5").length);
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

  // the game you've launched most, for the stats strip
  const topGame = () => games().reduce<GameRecord | null>((best, g) => ((g.plays ?? 0) > (best?.plays ?? 0) ? g : best), null);

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
      case "shelf":
        sfx.confirm();
        setApp(a.id as AppId);
        break;
      case "webgame":
        sfx.confirm();
        setApp(a.id as AppId);
        break;
      case "folder": {
        sfx.confirm();
        setGameFolder(a.id);
        const gi = CATEGORIES.findIndex((c) => c.id === "game");
        if (gi >= 0 && sels()[selKey(gi)] === undefined) setSels({ ...sels(), [selKey(gi)]: 0 });
        break;
      }
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
      case "splat":
        sfx.confirm();
        splatInput.click();
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
      case "worlddrive":
        sfx.confirm();
        awardT("worlddriver");
        setApp("worlddrive");
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
      case "syscity":
        sfx.confirm();
        setApp("syscity");
        break;
      case "cs":
        sfx.confirm();
        awardT("counterterrorist");
        setApp("cs");
        break;
      case "party":
        sfx.confirm();
        setApp("party");
        break;
      case "retrojoin":
        sfx.confirm();
        setApp("retrojoin");
        break;
      case "consoletv":
        sfx.confirm();
        setApp("consoletv");
        break;
      case "analytics":
        sfx.confirm();
        setApp("analytics");
        break;
      case "board":
        sfx.confirm();
        setApp("board");
        break;
      case "voiceavatar":
        sfx.confirm();
        awardT("voicecall");
        setApp("voiceavatar");
        break;
      case "wiki":
        sfx.confirm();
        setApp("wiki");
        break;
      case "privacy":
        sfx.confirm();
        setApp("privacy");
        break;
      case "watch":
        sfx.confirm();
        setApp("watch");
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
      case "godot":
        sfx.confirm();
        setApp("godot");
        break;
      case "unity":
        sfx.confirm();
        setApp("unity");
        break;
      case "html5":
        sfx.confirm();
        setApp("html5");
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

  // Which system a file is for comes from the registry (systems.ts). A shelf
  // passes the systems it shows; when more than one of them takes the format
  // (.cue on the Sega shelf: Saturn or Sega CD) the console asks instead of
  // guessing — that is the one thing a file name cannot tell us.
  const [chooser, setChooser] = createSignal<{ name: string; choices: string[]; idx: number; resolve: (id: string | null) => void } | null>(null);
  const askSystem = (name: string, choices: string[]) =>
    new Promise<string | null>((resolve) => { sfx.tickH(); setChooser({ name, choices, idx: 0, resolve }); });
  const answerChooser = (id: string | null) => { const c = chooser(); if (!c) return; setChooser(null); c.resolve(id); };
  async function classify(name: string, candidates?: readonly string[]): Promise<{ sys?: "ps2"; core: string } | null> {
    const c = classifyFile(name, candidates);
    if (!c) return null;
    if ("choose" in c) { const id = await askSystem(name, c.choose); return id ? (id === "ps2" ? { sys: "ps2", core: "ps2" } : { core: id }) : null; }
    return c;
  }

  // which system a "bring your own" file should be tagged as, set by the home
  // that opened the picker (consumed by onDisc, which the file input calls)
  let insertPrefer: readonly string[] | undefined;

  // "Link Games from Disk…" — Chromium File System Access. Stores only handles;
  // the games stream from the user's own drive, PS2/PSP ISOs included (zero-copy).
  async function onLink(prefer?: readonly string[]) {
    if (!fsAccessSupported()) { sfx.deny(); pushToast("Not supported", "Linking needs Chrome or Edge — use Insert Cartridge to copy instead"); return; }
    let handles: FileSystemFileHandle[];
    try {
      handles = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [{ description: "Game discs & ROMs", accept: { "application/octet-stream": ALL_EXTS().map((e) => `.${e}`) } }],
      });
    } catch { return; } // picker dismissed
    let added = 0, skipped = 0;
    for (const h of handles) {
      const cls = await classify(h.name, prefer);
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
    const prefer = insertPrefer;
    insertPrefer = undefined; // consume the one-shot home context
    const cls = await classify(file.name, prefer);
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
    CATEGORIES.flatMap((c, ci) => (c.id === "game" ? gameLeaves() : itemsOf(ci)).map((item, ii) => ({ item, ci, ii, cat: c.label })));
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
    if (CATEGORIES[h.ci].id === "game") revealGameItem(h.item.id);
    else {
      const ri = itemsOf(h.ci).findIndex((it) => it.id === h.item.id);
      if (ri >= 0) setSels({ ...sels(), [selKey(h.ci)]: ri });
    }
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
      if (["chess", "trivia", "flash", "cinema", "podcasts", "library", "youtube", "art", "wiki", "ps2home", "ps1home", "psphome", "retrohome", "nintendohome", "segahome", "arcadehome", "consoleshome", "computershome", "mobilehome", "fantasyhome", "karaoke", "settingshub", "videoplayer", "reporewind", "rpgmaker", "renpy", "godot", "unity", "html5", "syscity", "worlddrive"].includes(app()!)) appNav?.(action);
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
      // Background modes · 2 = Screen Upscaling (WebGPU only) · 3-5 = custom
      // H/S/L sliders (only when custom is picked)
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
        if (action === "down" && upscaleSupported()) { setThemeRow(2); sfx.tickV(); }        // → Screen Upscaling
        else if (action === "down" && isCustom()) { setThemeRow(3); sfx.tickV(); }             // → sliders (custom only)
        if (action === "back" || action === "confirm") close();
      } else if (themeRow() === 2 && upscaleSupported()) {
        // Screen Upscaling — same interaction as Living Background: ←→ cycles
        // the mode and it applies live to whatever is on screen.
        const cur = Math.max(0, UPSCALE_MODES.findIndex((m) => m.id === upscale()));
        if (action === "left") { setUpscale(UPSCALE_MODES[(cur - 1 + UPSCALE_MODES.length) % UPSCALE_MODES.length].id); sfx.tickH(); }
        if (action === "right") { setUpscale(UPSCALE_MODES[(cur + 1) % UPSCALE_MODES.length].id); sfx.tickH(); }
        if (action === "up") { setThemeRow(1); sfx.tickV(); }
        if (action === "down" && isCustom()) { setThemeRow(3); sfx.tickV(); }
        if (action === "back" || action === "confirm") close();
      } else {
        const sliderRow = themeRow() - 3; // 0 = Hue · 1 = Saturation · 2 = Lightness
        const step = action === "left" ? -1 : action === "right" ? 1 : 0;
        if (step) {
          const c = { ...customHsl() };
          if (sliderRow === 0) c.h = (c.h + step * 6 + 360) % 360;
          if (sliderRow === 1) c.s = Math.min(90, Math.max(10, c.s + step * 4));
          if (sliderRow === 2) c.l = Math.min(75, Math.max(30, c.l + step * 3));
          setCustomHsl(c); applyCustomHsl(c.h, c.s, c.l); sfx.tickH(); awardT("stylist");
        }
        if (action === "up") { setThemeRow(Math.max(upscaleSupported() ? 2 : 1, themeRow() - 1)); sfx.tickV(); }
        if (action === "down" && themeRow() < 5) { setThemeRow(themeRow() + 1); sfx.tickV(); }
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
    if (chooser()) {
      const c = chooser()!;
      if (action === "back") { sfx.back(); answerChooser(null); }
      else if (action === "confirm") { sfx.confirm(); answerChooser(c.choices[c.idx]); }
      else if (action === "left" || action === "up") { setChooser({ ...c, idx: (c.idx + c.choices.length - 1) % c.choices.length }); sfx.tickH(); }
      else if (action === "right" || action === "down") { setChooser({ ...c, idx: (c.idx + 1) % c.choices.length }); sfx.tickH(); }
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
        if (s > 0) { setSels({ ...sels(), [selKey(cat())]: s - 1 }); sfx.tickV(); }
        break;
      }
      case "down": {
        const s = selOf(cat());
        if (s < items.length - 1) { setSels({ ...sels(), [selKey(cat())]: s + 1 }); sfx.tickV(); }
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
      case "back": {
        // inside a Games folder, ○ steps out to the folder list with the cursor
        // back on the folder you came from — the PlayStation way
        const open = gameFolder();
        if (CATEGORIES[cat()].id === "game" && open) {
          sfx.back();
          setGameFolder(null);
          const ri = itemsOf(cat()).findIndex((it) => it.id === `folder:${open}`);
          if (ri >= 0) setSels({ ...sels(), [selKey(cat())]: ri });
        }
        break;
      }
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
  // full-screen game players bring their OWN on-screen controls (RpgPlayer FABs,
  // the .gpad for PS2/DOOM), so the shell touch-controller stays out of their way.
  const GAME_TOUCH = new Set(["rpgmaker", "renpy", "godot", "unity", "html5", "ps2", "doom", "doomrtx", "scummvm", "pc"]);
  // Horizon shelves are entirely tappable — tiles, hero actions and the Control
  // Center are all real buttons — so a virtual d-pad adds nothing, and its face
  // buttons land squarely on top of the Control Center bar on a phone.
  const TAP_NATIVE = new Set(["ps2home", "ps1home", "psphome", "retrohome", "nintendohome", "segahome", "arcadehome", "consoleshome", "computershome", "mobilehome", "fantasyhome"]);
  // show the on-screen controller once you're INSIDE something (an app/panel) —
  // that's where back/select/move-focus are needed; the bare crossbar is swipe+tap.
  const touchNavHidden = () =>
    !overlayOpen() || GAME_TOUCH.has(app() ?? "") || TAP_NATIVE.has(app() ?? "");
  // touch: on the bare crossbar, a swipe navigates natively (horizontal =
  // categories, vertical = items) and a tap opens — no virtual d-pad needed.
  // Inside an app/modal the swipe is off (that surface handles its own touch).
  let swipeStart: { x: number; y: number; edge: boolean } | null = null;
  const onTouchStart = (e: TouchEvent) => {
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    // bare crossbar → swipe navigates natively. Inside an app/overlay only a
    // LEFT-EDGE swipe counts (iOS-style back), so it never fights the app's scroll.
    if (!overlayOpen()) swipeStart = { x, y, edge: false };
    else if (x < 24) swipeStart = { x, y, edge: true };
    else swipeStart = null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!swipeStart) return;
    const t = e.changedTouches[0], dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
    const edge = swipeStart.edge;
    swipeStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return; // a tap — let the item's onClick open it
    if (edge) { if (dx > 60 && Math.abs(dx) > Math.abs(dy)) handleNav("back"); return; } // edge-swipe → back
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
            <button class="status-radio" title="Stop the music" aria-label={`Stop ${station()?.label ?? "the music"}`}
              onClick={() => { stopStation(); if (sfx.radioPlaying()) sfx.radioToggle(); setRadioOn(false); sfx.tickV(); }}>
              ♪ {station()?.label ?? ""} <span class="status-radio-stop">■</span>
            </button>
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
        <Show when={CATEGORIES[cat()].id === "game" && gameFolder()}>
          <div class="folder-crumb" onClick={() => handleNav("back")}>
            <span class="crumb-root">{tr("Games")}</span><span class="crumb-sep">›</span><b>{tr(gameFolderTitle())}</b>
            <span class="crumb-hint"><span class="btn-o" /> {tr("back")}</span>
          </div>
        </Show>
        <For each={itemsOf(cat())}>
          {(item, i) => {
            const d = () => i() - selOf(cat());
            const onClick = () => {
              setSels({ ...sels(), [selKey(cat())]: i() });
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

      {/* which system is this disc for? — only when the shelf has more than one answer */}
      <Show when={chooser()}>
        <div class="panel-backdrop" onClick={() => answerChooser(null)} />
        <div class="panel" role="dialog" aria-label="Which system is this for?">
          <div class="panel-tag">Which system is this for?</div>
          <div class="panel-heading">{chooser()!.name}</div>
          <div class="panel-body">
            <p>Several systems on this shelf use this disc format. Pick the one the game was made for.</p>
            <div class="choose-sys">
              <For each={chooser()!.choices}>{(id, i) => (
                <button classList={{ on: chooser()!.idx === i() }} onClick={() => { sfx.confirm(); answerChooser(id); }}>{SYSTEMS[id]?.name ?? id}</button>
              )}</For>
            </div>
          </div>
          <div class="panel-hint"><span class="btn-x" /> choose · <span class="btn-o" /> cancel</div>
        </div>
      </Show>

      {/* trophy collection */}
      <Show when={trophiesOpen()}>
        <div class="panel-backdrop" onClick={() => setTrophiesOpen(false)} />
        <div class="panel trophies">
          <div class="panel-tag">TROPHY COLLECTION — {trophyCount()} / {TROPHIES.length + 1}</div>
          <div class="panel-heading">{props.profile.name}</div>
          {/* console stats — everything here is already tracked (profile playtime,
              per-game play counts), it just had nowhere to be seen */}
          <div class="console-stats">
            <div class="cstat"><b>{fmtPlaytime(props.profile.playtime ?? 0)}</b><span>on the console</span></div>
            <div class="cstat"><b>{trophyCount()}<i>/{TROPHIES.length + 1}</i></b><span>trophies</span></div>
            <div class="cstat"><b>{games().length}</b><span>{games().length === 1 ? "game in library" : "games in library"}</span></div>
            <div class="cstat"><b>{games().reduce((n, g) => n + (g.plays ?? 0), 0)}</b><span>games launched</span></div>
            <Show when={topGame()}><div class="cstat wide"><b>{topGame()!.name}</b><span>most played · {topGame()!.plays}×</span></div></Show>
            <div class="cstat"><b>{new Date(props.profile.created).toLocaleDateString()}</b><span>signed in since</span></div>
          </div>
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
      <Show when={app() === "worlddrive"}>
        <WorldDrive bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
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
      <Show when={app() === "syscity"}>
        <SystemCity bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "cs"}><CsApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "party"}><PartyHub onClose={() => setApp(null)} onTrophy={awardT} /></Show>
      <Show when={app() === "retrojoin"}><RetroJoin onClose={() => setApp(null)} /></Show>
      <Show when={splatFile()}>
        <SplatView file={splatFile()!} onClose={() => setSplatFile(null)} />
      </Show>
      <Show when={app() === "analytics"}>
        <Analytics
          profileId={props.profile.id}
          profileName={props.profile.name}
          playtime={props.profile.playtime ?? 0}
          trophies={Object.keys(props.profile.trophies ?? {}).length}
          onClose={() => setApp(null)}
        />
      </Show>
      <Show when={app() === "consoletv"}>
        <ConsoleTv
          code={tvCode() ?? new URLSearchParams(location.search).get("tv")?.toUpperCase() ?? undefined}
          onClose={() => { setTvCode(null); setApp(null); }}
        />
      </Show>
      <Show when={app() === "board"}><BoardGames onClose={() => setApp(null)} onTrophy={awardT} /></Show>
      <Show when={app() === "voiceavatar"}><VoiceAvatar onClose={() => setApp(null)} /></Show>
      <Show when={app() === "wiki"}>
        <WikiApp bind={(f) => (appNav = f)} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "privacy"}><Privacy onClose={() => setApp(null)} /></Show>
      <Show when={app() === "watch"}><WatchParty userName={props.profile.name} onClose={() => setApp(null)} /></Show>
      <Show when={app() === "ps2"}><Ps2 profileId={props.profile.id} players={ps2Players()} isPublic={ps2Public()} roomCode={ps2Code()} partyName={partyName()} onPartyName={setPartyName} initialJoinTitle={ps2JoinTitle()} initialGame={ps2Boot() ?? undefined} initialJoin={ps2Join()} autoHost={ps2AutoHost()} onClose={() => { setPs2AutoHost(false); setPs2Boot(null); setPs2Join(false); setApp(games().some((g) => g.sys === "ps2") ? "ps2home" : null); }} /></Show>
      <Show when={app() === "pc"}><PcApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "guestbook"}><Guestbook userName={props.profile.name} onClose={() => setApp(null)} /></Show>
      <Show when={app() === "browser"}><Browser onClose={() => setApp(null)} /></Show>
      <Show when={app() === "visualizer"}><Visualizer onClose={() => setApp(null)} /></Show>
      <Show when={app() === "studio"}><Studio onClose={() => setApp(null)} /></Show>
      <Show when={app() === "code"}><CodeApp onClose={() => setApp(null)} /></Show>
      <Show when={app() === "manual"}><Manual onClose={() => setApp(null)} /></Show>

      {/* SHARE + upscaling — one instance each; both find the live canvas themselves */}
      <ShareBar app={app()} />
      <UpscaleLayer app={app()} />

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
          onInsert={() => { insertPrefer = ["ps2"]; fileInput.click(); }}
          onLink={() => onLink(["ps2"])}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
          extra={() => (
            <>
              {/* One clear way in. Controllers, hosting, open rooms and the code
                  box all live on the Online screen now — previously they were
                  scattered across a toolbar, a button and a mid-game banner,
                  which meant you could not find the feature without already
                  knowing it existed. */}
              <button class="ghost-btn ghost-btn-key" onClick={() => { sfx.confirm(); setPs2Lobby(true); }}>Play online</button>
              {/* Which emulator discs boot on. Here rather than on the player,
                  because every launch passes through this screen and the choice
                  has to be made before a disc spins. */}
              <Ps2EnginePick />
            </>
          )}
        />
      </Show>
      <Show when={app() === "ps2home" && ps2Lobby()}>
        <Online
          players={ps2Players()}
          onPlayers={(n) => { sfx.tickH(); setPs2Players(n); }}
          isPublic={ps2Public()}
          onPublic={setPs2Public}
          code={ps2Code()}
          onNewCode={() => setPs2Code(makeRoomCode())}
          name={roomName()}
          nameIsFallback={!partyName()}
          onName={setPartyName}
          onWatch={(code) => { sfx.confirm(); setPs2Lobby(false); setTvCode(code); setApp("consoletv"); }}
          onClose={() => setPs2Lobby(false)}
          library={games().filter((g) => g.sys === "ps2")
            .map((g) => ({ id: g.id, title: g.name.replace(/\.[^.]+$/, ""), plays: g.plays, size: g.size }))}
          onHost={(id) => {
            const g = games().find((x) => x.id === id);
            if (!g) return;
            sfx.confirm(); setPs2Lobby(false); setPs2AutoHost(true); playRecord(g);
          }}
          onInsert={() => { sfx.confirm(); setPs2Lobby(false); setPs2AutoHost(true); insertPrefer = ["ps2"]; fileInput.click(); }}
          onJoin={(code, title) => { sfx.confirm(); setPs2Lobby(false); setPs2AutoHost(false); setPs2Boot(null); setPs2JoinTitle(title); setPs2Join(code); setApp("ps2"); }}
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
          onInsert={() => { insertPrefer = ["psx"]; fileInput.click(); }}
          onLink={() => onLink(["psx"])}
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
          onInsert={() => { insertPrefer = ["psp"]; fileInput.click(); }}
          onLink={() => onLink(["psp"])}
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
          onInsert={() => { insertPrefer = RETRO_SYSTEMS; fileInput.click(); }}
          onLink={() => onLink(RETRO_SYSTEMS)}
          onChanged={refreshGames}
          onClose={() => setApp(null)}
        />
      </Show>
      {/* platform shelves — one GameShelf per family, same behaviour as the old
          all-in-one retro shelf, just filtered to that family's systems */}
      <Show when={app() === "nintendohome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={NINTENDO_SYSTEMS} owned={games()}
          title="NINTENDO — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = NINTENDO_SYSTEMS; fileInput.click(); }} onLink={() => onLink(NINTENDO_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "segahome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={SEGA_SYSTEMS} owned={games()}
          title="SEGA — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = SEGA_SYSTEMS; fileInput.click(); }} onLink={() => onLink(SEGA_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "arcadehome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={ARCADE_SYSTEMS} owned={games()}
          title="ARCADE — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = ARCADE_SYSTEMS; fileInput.click(); }} onLink={() => onLink(ARCADE_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "mobilehome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={MOBILE_SYSTEMS} owned={games()}
          title="MOBILE — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = MOBILE_SYSTEMS; fileInput.click(); }} onLink={() => onLink(MOBILE_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "fantasyhome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={FANTASY_SYSTEMS} owned={games()}
          title="FANTASY CONSOLES — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = FANTASY_SYSTEMS; fileInput.click(); }} onLink={() => onLink(FANTASY_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={WEB_GAMES[app() ?? ""]} keyed>{(wg) => <WebGameApp game={wg} onClose={() => setApp(null)} />}</Show>
      <Show when={app() === "frame" && frameBoot()}>
        <FramePlayer game={frameBoot()!} onClose={() => { const fam = SYSTEMS[frameBoot()!.core]?.family ?? "fantasy"; setFrameBoot(null); setApp(shelfOfFamily[fam] ?? null); }} />
      </Show>
      <Show when={app() === "palm" && palmBoot()}>
        <PalmSession game={palmBoot()!} onClose={() => { setPalmBoot(null); setApp("mobilehome"); }} />
      </Show>
      <Show when={app() === "consoleshome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={CONSOLE_SYSTEMS} owned={games()}
          title="MORE CONSOLES — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = CONSOLE_SYSTEMS; fileInput.click(); }} onLink={() => onLink(CONSOLE_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
      </Show>
      <Show when={app() === "computershome"}>
        <GameShelf bind={(f) => (appNav = f)} profileId={props.profile.id} systems={COMPUTER_SYSTEMS} owned={games()}
          title="COMPUTERS — YOUR LIBRARY & DOWNLOADS" onPlay={playRecord} onInsert={() => { insertPrefer = COMPUTER_SYSTEMS; fileInput.click(); }} onLink={() => onLink(COMPUTER_SYSTEMS)}
          onChanged={refreshGames} onClose={() => setApp(null)} />
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
      <Show when={app() === "godot"}>
        <RpgMaker family="godot" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
      </Show>
      <Show when={app() === "unity"}>
        <RpgMaker family="unity" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
      </Show>
      <Show when={app() === "html5"}>
        <RpgMaker family="html5" profile={props.profile} bind={(f) => (appNav = f)} onClose={() => { setApp(null); void refreshRpgCounts(); }} />
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
          <Show when={upscaleSupported()}>
            <div class="bg-modes">
              <span class="bg-modes-label">SCREEN UPSCALING</span>
              <div class="bg-modes-row">
                <For each={UPSCALE_MODES}>
                  {(m) => (
                    <button class="bg-mode" classList={{ active: upscale() === m.id, cursor: themeRow() === 2 && upscale() === m.id }}
                      onClick={() => { setThemeRow(2); setUpscale(m.id); sfx.tickH(); }}>
                      <span class="bg-mode-name">{m.name}</span>
                      <span class="bg-mode-sub">{m.desc}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="bg-modes">
              <span class="bg-modes-label">MOTION SMOOTHING</span>
              <div class="bg-modes-row">
                <button class="bg-mode" classList={{ active: frameGen() === "off" }}
                  onClick={() => { setFrameGen("off"); sfx.tickH(); }}>
                  <span class="bg-mode-name">Off</span>
                  <span class="bg-mode-sub">Frames shown exactly as the game presents them</span>
                </button>
                <button class="bg-mode" classList={{ active: frameGen() === "smooth" }}
                  onClick={() => { setFrameGen("smooth"); sfx.tickH(); }}>
                  <span class="bg-mode-name">Smooth</span>
                  <span class="bg-mode-sub">Synthesises the frame between two real ones, so a 30fps game moves at 60. Adds one frame of latency and can soften fast cuts — experimental</span>
                </button>
              </div>
            </div>
          </Show>
          <Show when={themeIdx() === THEMES.length}>
            <div class="theme-sliders">
              <For each={[
                { label: "Hue", key: "h" as const, min: 0, max: 360 },
                { label: "Saturation", key: "s" as const, min: 10, max: 90 },
                { label: "Lightness", key: "l" as const, min: 30, max: 75 },
              ]}>
                {(s, i) => (
                  <div class="theme-slider" classList={{ active: themeRow() === i() + 3 }}>
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
      <div class="touchpad" classList={{ "tpad-hide": touchNavHidden() }}>
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
          {/* touch is tap + scroll: content is tapped directly, so the only
              on-screen control that's always useful is Back (the d-pad + ✕ are
              hidden on touch via CSS — kept for the rare cursor-only screen). */}
          <button class="tpad-btn tpad-o" onPointerDown={(e) => { e.preventDefault(); handleNav("back"); }} aria-label="Back"><span class="btn-o" /><span class="tpad-lbl">Back</span></button>
          <button class="tpad-btn tpad-x" onPointerDown={(e) => { e.preventDefault(); handleNav("confirm"); }} aria-label="select"><span class="btn-x" /></button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInput}
        hidden
        accept={ALL_EXTS().map((e) => `.${e}`).join(",")}
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
        ref={splatInput}
        hidden
        accept=".ply,.splat,.spz,.ksplat"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          // the picker's accept list is a hint, not a guarantee — check the name
          if (f && isSplatFile(f.name)) setSplatFile(f);
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
