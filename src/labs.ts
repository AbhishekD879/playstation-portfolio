// Labs — the console's feature-flag switchboard. Two kinds of flags live here,
// organised into groups: SYSTEM FEATURES (Control Center, controllers, voice,
// visuals…) and APPS (everything on the crossbar). Everything ships ENABLED;
// Labs only ever turns things off. Core portfolio content (career, projects,
// skills, contact, about) is never optional — this is still a résumé.
import { createSignal } from "solid-js";

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
    ],
  },
];

// —— apps (each id matches the XmbItem id it hides on the crossbar) ——
const APPS: { id: string; title: string; cat: string }[] = [
  { id: "ai", title: "AI Abhishek — on-device LLM", cat: "Personal" },
  { id: "guestbook", title: "Guestbook", cat: "Personal" },
  { id: "whatsnew", title: "What's New", cat: "Personal" },
  { id: "radio-guide", title: "Radio Stations", cat: "Music" },
  { id: "podcasts", title: "Podcasts", cat: "Music" },
  { id: "winamp", title: "Winamp", cat: "Music" },
  { id: "radio", title: "Console Radio (lo-fi synth)", cat: "Music" },
  { id: "visualizer", title: "Visualizer", cat: "Music" },
  { id: "studio", title: "Studio — synth & drum machine", cat: "Music" },
  { id: "sp-default", title: "Spotify — lofi beats playlist", cat: "Music" },
  { id: "yt", title: "YouTube", cat: "Video" },
  { id: "ia-video", title: "Archive Cinema", cat: "Video" },
  { id: "doom", title: "DOOM", cat: "Games" },
  { id: "chess", title: "Chess vs Stockfish", cat: "Games" },
  { id: "trivia", title: "Trivia Arcade", cat: "Games" },
  { id: "flash", title: "Flash Arcade", cat: "Games" },
  { id: "ps2", title: "PlayStation 2 emulator", cat: "Games" },
  { id: "insert", title: "Retro Console (cartridge loader)", cat: "Games" },
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
const [disabled, setDisabled] = createSignal<Set<string>>(load());

/** Is this flag on? Everything defaults on. */
export const labEnabled = (id: string) => !disabled().has(id);
export const labsOffCount = () => disabled().size;
export const isFeature = (id: string) => FEATURE_IDS.has(id);
export function toggleLab(id: string) {
  const s = new Set(disabled());
  s.has(id) ? s.delete(id) : s.add(id);
  setDisabled(s);
  localStorage.setItem(KEY, JSON.stringify([...s]));
}
