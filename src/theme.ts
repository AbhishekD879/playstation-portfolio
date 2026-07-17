// Console theme — a single accent tint driving the wave gradient and every
// themed surface (--xmb-tint). Presets plus a fully custom HSL colour,
// persisted system-wide like console wallpaper.
import { createSignal } from "solid-js";
import { MONTH_COLORS } from "./content";

export const THEMES: { name: string; color: string | null }[] = [
  { name: "Classic — monthly", color: null }, // the PS3 monthly rotation
  { name: "Midnight", color: "#2c3e67" },
  { name: "Aqua", color: "#2e86ab" },
  { name: "Horizon", color: "#c86a4a" },
  { name: "Sunset", color: "#d4634f" },
  { name: "Forest", color: "#3e7a55" },
  { name: "Emerald", color: "#2e9e6b" },
  { name: "Orchid", color: "#7a55a8" },
  { name: "Violet", color: "#8a5fd4" },
  { name: "Sakura", color: "#d487a6" },
  { name: "Crimson", color: "#a83e4c" },
  { name: "Neon", color: "#3ec9a7" },
  { name: "Gold", color: "#b08a3e" },
  { name: "Sand", color: "#b39a6b" },
  { name: "Slate", color: "#5c6672" },
  { name: "Graphite", color: "#4a4f58" },
];

const monthly = () => MONTH_COLORS[new Date().getMonth()];

const stored = localStorage.getItem("asp.theme");
const [tint, setTintSig] = createSignal(stored || monthly());

export { tint };

// the tint drives every themed surface via :root, not just the wave
const applyVar = (c: string) => document.documentElement.style.setProperty("--xmb-tint", c);
applyVar(tint());

export function applyTheme(color: string | null) {
  if (color) localStorage.setItem("asp.theme", color);
  else localStorage.removeItem("asp.theme");
  setTintSig(color || monthly());
  applyVar(color || monthly());
}

// —— custom colour: HSL sliders in Theme Settings ——
// remembered separately so the sliders reopen where you left them
const CUSTOM_KEY = "asp.theme.custom";
export function loadCustomHsl(): { h: number; s: number; l: number } {
  try { return { h: 210, s: 55, l: 55, ...JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "{}") }; }
  catch { return { h: 210, s: 55, l: 55 }; }
}
export function applyCustomHsl(h: number, s: number, l: number) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify({ h, s, l }));
  applyTheme(`hsl(${h} ${s}% ${l}%)`);
}

// —— living background: how alive the XMB wave is, and whether it reacts to
// sound. Persisted like the tint; the Wave component reads the signal live. ——
export type BgMode = "calm" | "waves" | "reactive" | "aurora" | "fluid";
export const BG_MODES: { id: BgMode; label: string; sub: string }[] = [
  { id: "calm", label: "Calm", sub: "gentle PS3 waves" },
  { id: "waves", label: "Waves", sub: "fuller motion" },
  { id: "reactive", label: "Reactive", sub: "pulses to sound" },
  { id: "aurora", label: "Aurora", sub: "lively + glowing" },
  { id: "fluid", label: "Fluid", sub: "WebGPU water — flows to sound" }, // offered only with WebGPU
];
const BG_KEY = "asp.bg";
const storedBg = localStorage.getItem(BG_KEY) as BgMode | null;
const [bgMode, setBgSig] = createSignal<BgMode>(storedBg && BG_MODES.some((m) => m.id === storedBg) ? storedBg : "reactive");
export { bgMode };
export function setBgMode(m: BgMode) { localStorage.setItem(BG_KEY, m); setBgSig(m); }

/** Index into THEMES; THEMES.length means "custom colour". */
export function currentThemeIndex(): number {
  const c = localStorage.getItem("asp.theme");
  if (!c) return 0;
  const i = THEMES.findIndex((t) => t.color === c);
  return i === -1 ? THEMES.length : i;
}
