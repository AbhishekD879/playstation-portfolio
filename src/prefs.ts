// Console preferences — the Settings app's brain. Fonts (family / tracking /
// display size), per-category and per-app icon overrides, and the console
// language. Everything persists to localStorage and applies live through CSS
// variables and small helpers; nothing needs a reload.
import { createSignal } from "solid-js";

// —— fonts ————————————————————————————————————————————————————————————————
export interface FontPreset { id: string; name: string; stack: string; g?: string /* Google Fonts family= param, lazy-loaded */ }
export const FONT_PRESETS: FontPreset[] = [
  { id: "jost", name: "Jost — console default", stack: `"Jost", system-ui, sans-serif` },
  { id: "system", name: "System — native", stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` },
  { id: "exo", name: "Exo 2 — futuristic", stack: `"Exo 2", "Jost", sans-serif`, g: "Exo+2:wght@300;400;500;600" },
  { id: "rajdhani", name: "Rajdhani — technical", stack: `"Rajdhani", "Jost", sans-serif`, g: "Rajdhani:wght@300;400;500;600" },
  { id: "vt323", name: "VT323 — retro terminal", stack: `"VT323", "Courier New", monospace`, g: "VT323" },
  { id: "serif", name: "Georgia — editorial", stack: `Georgia, "Times New Roman", serif` },
  { id: "mono", name: "Monospace — developer", stack: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` },
];

export const TRACKINGS = [
  { id: "normal", name: "Normal", value: "0" },
  { id: "wide", name: "Wide", value: "0.02em" },
  { id: "wider", name: "Wider", value: "0.05em" },
];

export const SIZES = [
  { id: "compact", name: "Compact", value: 0.92 },
  { id: "standard", name: "Standard", value: 1 },
  { id: "large", name: "Large", value: 1.06 },
  { id: "xl", name: "Extra Large", value: 1.12 },
];

const FONT_KEY = "asp.font", TRACK_KEY = "asp.track", SIZE_KEY = "asp.uisize";

const [fontId, setFontSig] = createSignal(localStorage.getItem(FONT_KEY) ?? "jost");
const [trackId, setTrackSig] = createSignal(localStorage.getItem(TRACK_KEY) ?? "normal");
const [sizeId, setSizeSig] = createSignal(localStorage.getItem(SIZE_KEY) ?? "standard");
export { fontId, trackId, sizeId };

const loadedFonts = new Set<string>(["jost"]);
function ensureFontLoaded(p: FontPreset) {
  if (!p.g || loadedFonts.has(p.id)) return;
  loadedFonts.add(p.id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${p.g}&display=swap`;
  document.head.appendChild(link);
}

function applyFontVars() {
  const p = FONT_PRESETS.find((f) => f.id === fontId()) ?? FONT_PRESETS[0];
  const t = TRACKINGS.find((x) => x.id === trackId()) ?? TRACKINGS[0];
  const s = SIZES.find((x) => x.id === sizeId()) ?? SIZES[1];
  ensureFontLoaded(p);
  const root = document.documentElement;
  root.style.setProperty("--ui-font", p.stack);
  root.style.setProperty("--ui-tracking", t.value);
  (root.style as any).zoom = s.value === 1 ? "" : String(s.value); // PS "display size"
}

export function setFont(id: string) { localStorage.setItem(FONT_KEY, id); setFontSig(id); applyFontVars(); }
export function setTracking(id: string) { localStorage.setItem(TRACK_KEY, id); setTrackSig(id); applyFontVars(); }
export function setUiSize(id: string) { localStorage.setItem(SIZE_KEY, id); setSizeSig(id); applyFontVars(); }
applyFontVars(); // once at boot

// —— icon overrides (categories AND apps share one namespace of ids) ————————
const ICON_KEY = "asp.icons";
const loadIcons = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(ICON_KEY) ?? "{}"); } catch { return {}; }
};
const [iconOverrides, setIconOverrides] = createSignal<Record<string, string>>(loadIcons());
export { iconOverrides };

/** The icon to draw for a category/app id — user override wins over default. */
export const iconOf = (id: string, fallback: string) => iconOverrides()[id] ?? fallback;
export function setIconOverride(id: string, icon: string | null) {
  const next = { ...iconOverrides() };
  if (icon) next[id] = icon; else delete next[id];
  setIconOverrides(next);
  localStorage.setItem(ICON_KEY, JSON.stringify(next));
}

// —— language (consumed by translate.ts — "en" means untouched) ————————————
export const LANGS = [
  { id: "en", name: "English", native: "English" },
  { id: "es", name: "Spanish", native: "Español" },
  { id: "fr", name: "French", native: "Français" },
  { id: "de", name: "German", native: "Deutsch" },
  { id: "hi", name: "Hindi", native: "हिन्दी" },
  { id: "it", name: "Italian", native: "Italiano" },
];
const LANG_KEY = "asp.lang";
const [lang, setLangSig] = createSignal(localStorage.getItem(LANG_KEY) ?? "en");
export { lang };
export function setLang(id: string) { localStorage.setItem(LANG_KEY, id); setLangSig(id); }
