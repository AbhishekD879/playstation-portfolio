// Labs — the console's feature-flag switchboard. Two kinds of flags live here,
// organised into groups: SYSTEM FEATURES (Control Center, controllers, voice,
// visuals…) and APPS (everything on the crossbar). Everything ships ENABLED;
// Labs only ever turns things off. Core portfolio content (career, projects,
// skills, contact, about) is never optional — this is still a résumé.
import { createSignal } from "solid-js";
import { hasHtmlInCanvas } from "./gpu";

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
      { id: "vibe", title: "Vibe Search (Planet Earth)", desc: "Type a feeling — on-device embeddings fly the globe there" },
      // only browsers with the HTML-in-Canvas trial even see this switch
      ...(hasHtmlInCanvas() ? [{ id: "crt", title: "CRT Console (experimental)", desc: "The ENTIRE console on a curved phosphor tube — restarts the console" }] : []),
    ],
  },
];

/** Flags that ship OFF and are opted INTO via Labs (experimental tier). */
const DEFAULT_OFF = new Set(["crt"]);

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
const APP_CAT_ICON: Record<string, string> = { Personal: "user", Music: "note", Video: "film", Games: "disc", Extras: "chip", Web: "globe", Photo: "camera" };
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
// richer words for the headliner
APP_GUIDES.doomrtx = {
  what: "The 1993 E1M1 rebuilt as triangles and lit by real-time path tracing — physically correct light bouncing in WebGPU compute.",
  steps: ["Game › DOOM RTX", "Click the canvas, press ▶, then WASD + mouse to wander", "The corner panel shows FPS and rays/second — that's live ray tracing"],
  needs: "webgpu",
  go: "app:doomrtx", goLabel: "ENTER E1M1",
};

export const LAB_GUIDES: Record<string, LabGuide> = { ...APP_GUIDES, ...FEATURE_GUIDES };

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

/** Is this flag on? Default-on unless toggled; DEFAULT_OFF flags invert. */
export const labEnabled = (id: string) => DEFAULT_OFF.has(id) ? toggled().has(id) : !toggled().has(id);
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
