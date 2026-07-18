// Labs — the console's feature-flag switchboard. Two kinds of flags live here,
// organised into groups: SYSTEM FEATURES (Control Center, controllers, voice,
// visuals…) and APPS (everything on the crossbar). Everything ships ENABLED;
// Labs only ever turns things off. Core portfolio content (career, projects,
// skills, contact, about) is never optional — this is still a résumé.
import { createSignal } from "solid-js";
import { DEVICE, hasHtmlInCanvas, hasWebGPU } from "./gpu";

export interface Flag { id: string; title: string; desc: string }
export interface FlagGroup { group: string; icon: string; items: Flag[] }

// —— system features (wired into the app; toggling them off disables them) ——
const FEATURE_GROUPS: FlagGroup[] = [
  {
    group: "Interface", icon: "sliders", items: [
      { id: "search", title: "Search", desc: "Find & launch any app or section — the ⌕ button or the / key" },
      { id: "cc", title: "Control Center", desc: "Quick overlay — PS button or ` — for phone pad, DualSense, volume & theme" },
      { id: "osk", title: "On-Screen Keyboard", desc: "Pops up for text fields when you're on a controller" },
      { id: "voice", title: "Voice Commands", desc: "The header mic — click, or hold N / R2, and say “open doom”" },
      { id: "saver", title: "Screen Saver", desc: "Idle clock screen after a few minutes of no input" },
      { id: "presence", title: "Visitor Presence & P2P Play", desc: "See who else is on the console + play them at Chess — serverless P2P, nothing shared but moves" },
      { id: "tabsync", title: "Tab Sync", desc: "Theme, Labs flags & settings mirror instantly across every open tab" },
      { id: "wakelock", title: "Never-Dim Console", desc: "The screen stays awake while a game, video or karaoke is playing" },
      { id: "translate", title: "Universal Menu", desc: "Crossbar in your language — on-device AI translation, cached after first run" },
      { id: "battmeter", title: "Battery Meter", desc: "PS-style battery cells in the status bar (with a low-charge pulse)" },
    ],
  },
  {
    group: "Controllers", icon: "gamepad", items: [
      { id: "phonepad", title: "Phone Controller", desc: "Scan a QR to use your phone as a touch gamepad" },
      { id: "dualsense", title: "DualSense (WebHID)", desc: "Lightbar, rumble & battery over USB / Bluetooth" },
    ],
  },
  {
    group: "Visuals & Feel", icon: "spark", items: [
      { id: "livingbg", title: "Living Background", desc: "Animated, audio-reactive XMB wave (else a calm static backdrop)" },
      { id: "juice", title: "Launch Effects", desc: "Impact shake + haptic pulse when an app opens" },
      { id: "gpujuice", title: "Particle Bursts (WebGPU)", desc: "Compute-shader particle storms on app launch & trophies" },
      { id: "livephoto", title: "Live Photos (3D)", desc: "On-device AI depth turns gallery photos into parallax 3D" },
      { id: "enhance", title: "Photo Enhance (AI ×2)", desc: "On-device super-resolution — upscale any gallery photo, tile by tile" },
      { id: "cutout", title: "Cutout Cam (AI)", desc: "One-tap background removal — turn any photo into a clean transparent cutout" },
      { id: "clickmask", title: "Click-to-Mask (AI)", desc: "Tap any object in a photo and the console isolates it — Segment Anything, on-device" },
      { id: "transitions", title: "Motion Transitions", desc: "App launches morph and category swaps crossfade via the native View Transitions API" },
      { id: "moderncss", title: "Modern CSS Polish", desc: "Self-aware panels, sticky group headers, height-to-auto animations & scroll reveals" },
      { id: "parallaxbg", title: "Pointer Parallax Backdrop", desc: "The living background leans gently with your pointer for real depth" },
      { id: "galaxyboot", title: "Galaxy Boot (WebGPU)", desc: "A 200,000-star spiral galaxy spins up behind the boot sequence" },
      { id: "statspop", title: "Career Trophy Stats", desc: "First visit to Career/Projects pops PSN-style stat toasts" },
      { id: "vibe", title: "Vibe Search (Planet Earth)", desc: "Type a feeling — on-device embeddings fly the globe there" },
      // only browsers with the HTML-in-Canvas trial even see this switch
      ...(hasHtmlInCanvas() ? [{ id: "crt", title: "CRT Console (experimental)", desc: "The ENTIRE console on a curved phosphor tube — restarts the console" }] : []),
    ],
  },
];

/** Flags that ship OFF and are opted INTO via Labs (experimental tier). */
const DEFAULT_OFF = new Set(["crt", "galaxyboot"]); // opt-in: full-console CRT, GPU galaxy boot

// —— apps (each id matches the XmbItem id it hides on the crossbar) ——
const APPS: { id: string; title: string; cat: string }[] = [
  { id: "ai", title: "AI Abhishek — on-device LLM", cat: "Personal" },
  { id: "guestbook", title: "Guestbook", cat: "Personal" },
  { id: "whatsnew", title: "What's New", cat: "Personal" },
  { id: "radio-guide", title: "Radio Stations", cat: "Music" },
  { id: "podcasts", title: "Podcasts", cat: "Music" },
  { id: "winamp", title: "Winamp", cat: "Music" },
  { id: "karaoke", title: "Karaoke (vocal cut)", cat: "Music" },
  { id: "radio", title: "Console Radio (lo-fi synth)", cat: "Music" },
  { id: "visualizer", title: "Visualizer", cat: "Music" },
  { id: "studio", title: "Studio — synth & drum machine", cat: "Music" },
  { id: "strudel", title: "Live Code (Strudel)", cat: "Music" },
  { id: "sp-default", title: "Spotify — lofi beats playlist", cat: "Music" },
  { id: "yt", title: "YouTube", cat: "Video" },
  { id: "videoplayer", title: "Video Player (local files)", cat: "Video" },
  { id: "ia-video", title: "Archive Cinema", cat: "Video" },
  { id: "doom", title: "DOOM", cat: "Games" },
  { id: "doomrtx", title: "DOOM RTX (path-traced)", cat: "Games" },
  { id: "chess", title: "Chess vs Stockfish", cat: "Games" },
  { id: "trivia", title: "Trivia Arcade", cat: "Games" },
  { id: "flash", title: "Flash Arcade", cat: "Games" },
  { id: "ps2", title: "PlayStation 2 emulator", cat: "Games" },
  { id: "ps1", title: "PlayStation 1 (PSX)", cat: "Games" },
  { id: "insert", title: "Retro Console (cartridge loader)", cat: "Games" },
  { id: "scummvm", title: "Point & Click (ScummVM)", cat: "Games" },
  { id: "lichesstv", title: "Lichess TV", cat: "Games" },
  { id: "code", title: "Code Playground", cat: "Extras" },
  { id: "pc", title: "Other OS — x86 PC", cat: "Extras" },
  { id: "manual", title: "System Manual", cat: "Extras" },
  { id: "browser", title: "Browser", cat: "Web" },
  { id: "wiki", title: "Wikipedia", cat: "Web" },
  { id: "dict", title: "Dictionary", cat: "Web" },
  { id: "tm", title: "Time Machine", cat: "Web" },
  { id: "map", title: "Planet Earth", cat: "Web" },
  { id: "weather", title: "Weather", cat: "Web" },
  { id: "art", title: "Art Gallery", cat: "Photo" },
  { id: "apod", title: "Astronomy Photo of the Day", cat: "Photo" },
];
const APP_CAT_ICON: Record<string, string> = { Personal: "user", Music: "note", Video: "film", Games: "disc", Extras: "chip", Web: "globe", Photo: "camera", Settings: "gear" };
const APP_GROUPS: FlagGroup[] = [...new Set(APPS.map((a) => a.cat))].map((cat) => ({
  group: cat, icon: APP_CAT_ICON[cat] ?? "folder",
  items: APPS.filter((a) => a.cat === cat).map((a) => ({ id: a.id, title: a.title, desc: "" })),
}));

// —— guides: every flag can explain itself — what it is, how to try it, and a
// deep-link the console can execute ("take me there"). Apps get an
// auto-generated guide (find on crossbar → launch); features are hand-written.
export interface LabGuide {
  what: string;          // one or two plain sentences
  steps: string[];       // "TRY IT" — concrete, in order
  needs?: "webgpu";      // capability the card should report on
  go?: string;           // action id XMB executes (e.g. "app:doom", "cc", "burst-demo")
  goLabel?: string;      // button label, defaults to TAKE ME THERE
}

const FEATURE_GUIDES: Record<string, LabGuide> = {
  search: {
    what: "One search box over everything on the console — apps, career sections, settings, games.",
    steps: ["Press / anywhere (or tap ⌕ in the header)", "Type a few letters — “doom”, “résumé”, “theme”…", "↑↓ to pick, ENTER jumps straight there"],
    go: "search", goLabel: "OPEN SEARCH",
  },
  cc: {
    what: "The quick-settings overlay: volume, theme, phone-controller QR and DualSense tools, from anywhere.",
    steps: ["Press ` (backtick) or the pad's PS button — double-tap the screen on mobile", "Drag or push the left stick to ride the volume", "Scan the QR to turn your phone into a gamepad"],
    go: "cc", goLabel: "OPEN CONTROL CENTER",
  },
  osk: {
    what: "A PlayStation-style on-screen keyboard for controller users — no reaching for the desk.",
    steps: ["Connect any gamepad", "Focus a text box (search, guestbook…)", "The keyboard appears — ✕ types, △ deletes, START confirms"],
  },
  voice: {
    what: "Push-to-talk voice commands, transcribed on-device — no audio ever leaves the console.",
    steps: ["Hold the header mic (or hold N — R2 on a pad)", "Say “open doom”, “play radio”, “show trophies”…", "Let go — the console obeys"],
  },
  saver: {
    what: "An idle screen saver: a clock drifting through the dark, like a console left on overnight.",
    steps: ["Leave the console alone for a few minutes", "Any key, click or button wakes it", "Change the start delay under Settings › Power Save Settings"],
    go: "saver", goLabel: "PREVIEW IT NOW",
  },
  presence: {
    what: "Serverless P2P (Trystero over Nostr relays): a soft ◉ count in the header when other visitors are browsing, and Chess can pair two visitors for a live game. No server, no tracking — browsers just wave at each other.",
    steps: ["Open the console in a second browser or another device", "Watch the header: “◉ 2 on console”", "In Chess, tap the opponent pill — two consoles pair up and play"],
  },
  enhance: {
    what: "On-device ×2 super-resolution (Swin2SR). The photo is upscaled tile by tile with a live progress strip — nothing leaves the browser; the result is saved as a new photo.",
    steps: ["Photo › Slideshow", "Tap ◈ enhance ×2 on any photo you added", "Watch the strip — the enhanced copy lands in your gallery"],
    go: "photo-cat", goLabel: "GO TO PHOTOS",
  },
  cutout: {
    what: "AI background removal (RMBG), fully on-device: any photo becomes a clean transparent cutout — perfect for a profile avatar that isn't a rectangle.",
    steps: ["Photo › Slideshow › ◈ cutout on any photo", "Or Users › Profile Photo — the cutout option appears after you pick a picture", "The subject is lifted off its background and saved"],
    go: "photo-cat", goLabel: "GO TO PHOTOS",
  },
  clickmask: {
    what: "Segment Anything (SlimSAM), on-device: tap any object in a photo and the console masks it out into its own transparent image.",
    steps: ["Photo › Slideshow", "Tap ◈ isolate, then tap the object you want", "The isolated cutout is saved as a new photo"],
    go: "photo-cat", goLabel: "GO TO PHOTOS",
  },
  transitions: {
    what: "The native View Transitions API drives the console's motion: launching an app morphs out of the crossbar, and category swaps crossfade — no animation library, the browser does it.",
    steps: ["Launch any app and watch the wipe", "Slide ← → across categories for the crossfade", "Automatically off when your system asks for reduced motion"],
  },
  moderncss: {
    what: "A pack of 2026 CSS upgrades: panels that reflow to their own width (container queries), Labs group headers that shadow when stuck, height-to-auto animations, and scroll-in reveals — all zero JavaScript.",
    steps: ["Open Console Settings → LABS and scroll — group headers pin and pick up a shadow", "Watch list rows and tiles fade in as they scroll into view", "Everything falls back gracefully on older browsers"],
  },
  parallaxbg: {
    what: "The living background gains depth: waves and sparkles lean subtly toward your pointer, like tilting a diorama.",
    steps: ["Sit on the crossbar and glide the mouse around", "The backdrop follows a beat behind — depth, not distraction"],
    go: "themes", goLabel: "PICK A BACKDROP",
  },
  galaxyboot: {
    what: "A 200,000-star spiral galaxy — pure WebGPU, spun by shader math — turns slowly behind the boot sequence while the console starts.",
    steps: ["Settings › Restart Console", "Watch the boot screen: the galaxy rotates behind the wordmark"],
    go: "restart-demo", goLabel: "RESTART & WATCH",
  },
  statspop: {
    what: "PSN-style stat toasts: the first time each session you land on Career or Projects, the console pops the headline numbers like trophies.",
    steps: ["Slide to the Career category", "Watch the corner — years shipped and project counts pop in"],
  },
  battmeter: {
    what: "The status-bar battery: PS-style cells for your device's charge, a charging shimmer, and a red pulse under 15%.",
    steps: ["Look at the top-right status bar (browsers that report battery)", "Unplug — the cells drain; below 15% they pulse"],
  },
  tabsync: {
    what: "Open the console in two tabs and change the theme in one — the other follows within a second. Labs flags, backgrounds, fonts and icons all mirror over a BroadcastChannel.",
    steps: ["Open AbhishekStation in a second tab", "Switch the theme or toggle a Labs flag", "Watch the first tab catch up (it waits politely if a game is running)"],
  },
  wakelock: {
    what: "A screen Wake Lock while anything is actually playing — emulator sessions, DOOM, video, karaoke — released the moment you stop.",
    steps: ["Start any game or the Video Player", "Your OS screen-dimming holds off until you quit"],
  },
  translate: {
    what: "Universal Menu: pick a language in Console Settings and the crossbar translates itself on-device (small opus-mt model per language, cached forever after the first pass).",
    steps: ["Extras › Console Settings › Language", "Pick Español, Français, Deutsch, हिन्दी or Italiano", "Watch the crossbar titles re-render as translations land"],
    go: "app:settingshub", goLabel: "OPEN SETTINGS",
  },
  phonepad: {
    what: "Your phone becomes the controller — scan a QR, get a touch gamepad driving this screen.",
    steps: ["Open the Control Center (` or PS button)", "Scan the QR with your phone camera", "Navigate the crossbar from the couch"],
    go: "cc", goLabel: "GET THE QR",
  },
  dualsense: {
    what: "Deep DualSense support over WebHID: theme-colored lightbar, rumble, battery readout.",
    steps: ["Pair a DualSense via Bluetooth or USB", "Click the controller icon in the header and connect", "Watch the lightbar match the console theme"],
  },
  livingbg: {
    what: "The backdrop is alive: pick from PS3 waves, fireflies, a starfield, a retro horizon grid — most react to whatever the console is playing.",
    steps: ["Settings › Theme Settings › BACKGROUND", "Pick a backdrop — “Flat 2D” is the original still gradient", "Play the radio: Reactive, Aurora, Fireflies & Horizon pulse to the music", "On WebGPU consoles, “Fluid” is real simulated water — stir it with the pointer"],
    go: "themes", goLabel: "PICK A BACKDROP",
  },
  juice: {
    what: "Launch feedback: a quick impact shake plus a haptic kick on the pad whenever an app opens.",
    steps: ["Launch anything from the crossbar", "Feel the thump (rumble needs a connected pad)"],
    go: "juice-demo", goLabel: "SHOW ME",
  },
  gpujuice: {
    what: "A million-particle GPU pool (WebGPU compute). Launching an app detonates a spark storm from the item you picked; trophies rain gold.",
    steps: ["Launch any app and watch the item explode into sparks", "Earn a trophy for the gold shower"],
    needs: "webgpu",
    go: "burst-demo", goLabel: "FIRE A TEST BURST",
  },
  livephoto: {
    what: "On-device AI depth turns your photos into parallax 3D — the picture tilts as you move the mouse.",
    steps: ["Photo › Add Photos… and pick a real photo of yours", "Open the Slideshow — the badge shows the 3D model warming up (first time downloads ~50 MB)", "When it reads ◈ 3D, move the mouse — depth!", "Museum & NASA photos stay 2D: their servers block pixel access"],
    go: "photo-cat", goLabel: "GO TO PHOTOS",
  },
  vibe: {
    what: "Semantic search for the planet: describe a feeling and the globe flies to a place that matches, matched by on-device embeddings.",
    steps: ["Web › Planet Earth", "Tap ✨ vibe next to the search box", "Type “somewhere cold and lonely” and press ENTER"],
    go: "app:map", goLabel: "FLY THE GLOBE",
  },
  crt: {
    what: "The entire console rendered onto a curved phosphor tube — scanlines, RGB triads, barrel glass. Chrome's experimental HTML-in-Canvas API; everything stays clickable.",
    steps: ["Flip the switch — the console restarts inside the tube", "Look closely: scanlines and phosphor stripes over every pixel", "Flip it off to restart back to flat glass"],
  },
};

// every app: where it lives on the crossbar + a launch deep-link
const APP_GUIDES: Record<string, LabGuide> = Object.fromEntries(
  APPS.map((a) => [a.id, {
    what: `${a.title} — one of the console's apps.`,
    steps: [`Find it on the crossbar under ${a.cat}`, "Press ✕ (or click) to launch"],
    go: "app:" + a.id, goLabel: "LAUNCH IT",
  } satisfies LabGuide]),
);
// richer words for the headliners
APP_GUIDES.videoplayer = {
  what: "A PS-style local video player: drop in any video file you own — it plays full-bleed with console controls, and its audio rides the master bus so the reactive backdrops dance to your movie.",
  steps: ["Video › Video Player", "Pick a video file", "✕ play/pause · ←→ seek · △ fullscreen"],
  go: "app:videoplayer", goLabel: "OPEN THE PLAYER",
};
APP_GUIDES.settingshub = {
  what: "Console Settings — the PS5-style hub: customize the console font and text size, re-icon any category or app from the PS glyph set, tune audio, pick a language, and manage every Labs flag in one place.",
  steps: ["Extras › Console Settings", "←→ moves between sections, ↑↓ within one", "Changes apply live — no reload, no save button"],
  go: "app:settingshub", goLabel: "OPEN SETTINGS",
};
APP_GUIDES.ps1 = {
  what: "The original PlayStation, emulated on-device (pcsx_rearmed). Bring your own disc images — the built-in HLE BIOS boots most titles with no BIOS file at all.",
  steps: ["Game › PlayStation", "Insert or link a .chd or .pbp disc you own (single-file formats work best)", "Box art appears automatically; press ✕ to boot"],
  go: "app:ps1", goLabel: "OPEN THE SHELF",
};
APP_GUIDES.scummvm = {
  what: "ScummVM compiled to WebAssembly — the classic point-&-click engine. Freeware and demo adventures are playable immediately; add games you own too.",
  steps: ["Game › Point & Click", "Give the wasm ~20 seconds to warm up", "Pick “Beneath a Steel Sky” — it's legally freeware — and Start"],
  go: "app:scummvm", goLabel: "OPEN THE LAUNCHER",
};
APP_GUIDES.karaoke = {
  what: "Sing it yourself: studio vocals sit dead-center in a stereo mix, so the console cancels them live (L−R) while a low-pass keeps the bass. No models, no uploads — instant.",
  steps: ["Music › Karaoke", "Pick a song file you own", "Slide between FULL SONG and VOCALS CUT (↑↓ on a pad) and sing"],
  go: "app:karaoke", goLabel: "PICK A SONG",
};
APP_GUIDES.strudel = {
  what: "Strudel — TidalCycles live coding in the browser. The console opens it with a lo-fi starter pattern; change a number mid-play and hear it shift.",
  steps: ["Music › Live Code", "Press ▶ play", "Edit anything — ctrl+enter re-evaluates while the beat keeps running"],
  go: "app:strudel", goLabel: "START THE JAM",
};
APP_GUIDES.doomrtx = {
  what: "The 1993 E1M1 rebuilt as triangles and lit by real-time path tracing — physically correct light bouncing in WebGPU compute.",
  steps: ["Game › DOOM RTX", "Click the canvas, press ▶, then WASD + mouse to wander", "The corner panel shows FPS and rays/second — that's live ray tracing"],
  needs: "webgpu",
  go: "app:doomrtx", goLabel: "ENTER E1M1",
};

export const LAB_GUIDES: Record<string, LabGuide> = { ...APP_GUIDES, ...FEATURE_GUIDES };

// —— device suitability: recommended specs per demanding feature ——————————
// Light features carry no entry and never warn. Anything listed here gets a
// ✓/⚠/✕ fitness badge in Labs, a spec readout on its guide card, and — for
// ⚠/✕ — a "press again to enable anyway" guard. Nothing is ever locked.
interface SpecReq {
  webgpu?: "required" | "boost"; // hard need vs "CPU fallback will be slow"
  isolation?: boolean;           // needs crossOriginIsolated (SharedArrayBuffer)
  desktop?: "required" | "recommended";
  minMemGB?: number;             // recommended device memory
  minCores?: number;
  downloadMB?: number;           // one-time download, cached after
  gpuHeavy?: boolean;            // sustained GPU load
  cpuHeavy?: boolean;            // heavy wasm / CPU inference
}

const FEATURE_SPECS: Record<string, SpecReq> = {
  // system features
  gpujuice: { webgpu: "required", gpuHeavy: true, minMemGB: 4 },
  galaxyboot: { webgpu: "required", gpuHeavy: true, minMemGB: 4 },
  cutout: { webgpu: "boost", downloadMB: 45, minMemGB: 4, cpuHeavy: true },
  clickmask: { webgpu: "boost", downloadMB: 40, minMemGB: 4, cpuHeavy: true },
  translate: { webgpu: "boost", downloadMB: 50, cpuHeavy: true },
  livephoto: { webgpu: "boost", minMemGB: 4, downloadMB: 50, cpuHeavy: true },
  enhance: { webgpu: "boost", minMemGB: 4, downloadMB: 45, cpuHeavy: true },
  voice: { webgpu: "boost", downloadMB: 80, cpuHeavy: true },
  vibe: { downloadMB: 25 },
  crt: { gpuHeavy: true, minMemGB: 4 },
  // apps
  ai: { webgpu: "boost", minMemGB: 8, downloadMB: 1200, gpuHeavy: true, cpuHeavy: true },
  doomrtx: { webgpu: "required", gpuHeavy: true, minMemGB: 8 },
  ps2: { isolation: true, desktop: "required", minMemGB: 8, cpuHeavy: true },
  psp: { isolation: true, desktop: "recommended", minMemGB: 4, cpuHeavy: true },
  ps1: { minMemGB: 4, cpuHeavy: true },
  scummvm: { downloadMB: 40, minMemGB: 4, cpuHeavy: true },
  pc: { minMemGB: 4, cpuHeavy: true },
};

export type FitLevel = "ready" | "caution" | "no";
export interface Suitability { level: FitLevel; notes: string[]; rec: string }

/** Rate a feature against THIS device. null = light feature, always fine. */
export function rateFeature(id: string): Suitability | null {
  const s = FEATURE_SPECS[id];
  if (!s) return null;
  const notes: string[] = [];
  let level: FitLevel = "ready";
  const caution = (t: string) => { notes.push(t); if (level !== "no") level = "caution"; };
  const no = (t: string) => { notes.push(t); level = "no"; };

  if (s.webgpu === "required" && !hasWebGPU()) no("needs WebGPU — this browser doesn't offer it");
  if (s.isolation && !DEVICE.isolated) no("needs cross-origin isolation — not available here");
  if (s.desktop === "required" && DEVICE.mobile) no("built for a desktop with a real GPU and keyboard");
  if (s.desktop === "recommended" && DEVICE.mobile) caution("really wants a desktop — expect a struggle on touch devices");
  if (s.webgpu === "boost" && !hasWebGPU()) caution("no WebGPU here — falls back to CPU and gets slow");
  if (s.minMemGB && DEVICE.memGB && DEVICE.memGB < s.minMemGB) caution(`likes ${s.minMemGB} GB RAM — this device reports ${DEVICE.memGB} GB`);
  if (s.minCores && DEVICE.cores < s.minCores) caution(`likes ${s.minCores}+ cores — this device has ${DEVICE.cores}`);
  if (s.gpuHeavy && DEVICE.mobile && level === "ready") caution("sustained GPU load — phones may heat up and throttle");
  if (s.cpuHeavy && DEVICE.mobile && level === "ready") caution("heavy WebAssembly — midrange phones will struggle");
  if (s.downloadMB) notes.push(`${s.downloadMB >= 1000 ? `${(s.downloadMB / 1000).toFixed(1)} GB` : `${s.downloadMB} MB`} one-time download, cached after`);

  const rec = [
    s.webgpu === "required" ? "WebGPU" : s.webgpu === "boost" ? "WebGPU (for speed)" : "",
    s.minMemGB ? `${s.minMemGB} GB RAM` : "",
    s.minCores ? `${s.minCores}+ cores` : "",
    s.desktop ? "desktop" : "",
    s.isolation ? "isolated context" : "",
  ].filter(Boolean).join(" · ");
  return { level, notes, rec: rec ? `recommended: ${rec}` : "runs anywhere" };
}

/** Ordered groups shown in Labs: system features first, then apps by category. */
export const LAB_GROUPS: FlagGroup[] = [...FEATURE_GROUPS, ...APP_GROUPS];
/** Flat, ordered list of every flag — used for controller navigation. */
export const LAB_FLAT: Flag[] = LAB_GROUPS.flatMap((g) => g.items);
/** ids that are system features (not crossbar apps). */
const FEATURE_IDS = new Set(FEATURE_GROUPS.flatMap((g) => g.items.map((i) => i.id)));

const KEY = "asp.labs.off";
const load = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set(); }
};
// one toggled-set: holds "off" overrides for default-on flags AND "on"
// overrides for default-off (experimental) flags
const [toggled, setToggled] = createSignal<Set<string>>(load());

/** Is this flag on? Default-on unless toggled; DEFAULT_OFF flags invert.
 *  Console Settings is where Labs lives — it can never be switched off, or
 *  there'd be no way back in (also heals anyone who toggled it off before). */
export const labEnabled = (id: string) => id === "settingshub" ? true : DEFAULT_OFF.has(id) ? toggled().has(id) : !toggled().has(id);
export const labsOffCount = () => [...toggled()].filter((id) => !DEFAULT_OFF.has(id)).length;
export const isFeature = (id: string) => FEATURE_IDS.has(id);
export function toggleLab(id: string) {
  const s = new Set(toggled());
  s.has(id) ? s.delete(id) : s.add(id);
  setToggled(s);
  localStorage.setItem(KEY, JSON.stringify([...s]));
  // the tube wraps the app at boot — entering/leaving it needs a restart
  if (id === "crt") setTimeout(() => location.reload(), 450);
}
