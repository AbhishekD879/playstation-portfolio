// Console theme — a single accent tint driving the wave gradient and every
// themed surface (--xmb-tint). Presets plus a fully custom HSL colour,
// persisted system-wide like console wallpaper.
import { createSignal } from "solid-js";
import { MONTH_COLORS } from "./content";
import { UPSCALE_MODES, type UpscaleMode } from "./upscale";

// Ordered by hue family (blue → teal → green → warm → red → pink → purple →
// neutral) so the swatch grid reads as a smooth spectrum. Selection is stored
// by colour value, not index, so this list can grow/reorder freely.
// the console's default accent when nothing has been picked — a deep, PlayStation
// sea-blue, so the Deep Space background glows blue out of the box (not teal)
export const DEFAULT_TINT = "#0e5aa8";

export const THEMES: { name: string; color: string | null }[] = [
  { name: "Classic — monthly", color: null }, // the PS3 monthly rotation
  { name: "Deep Sea", color: DEFAULT_TINT },  // the default — PlayStation sea-blue
  // electric — high-chroma accents that pop against the gradient backgrounds
  { name: "Azure", color: "#4d9fff" },
  { name: "Cyan", color: "#22d3ee" },
  { name: "Iris", color: "#7c6bff" },
  { name: "Magenta", color: "#ff4d97" },
  { name: "Spring", color: "#14d98a" },
  // a lean set of rich solids across the spectrum
  { name: "Aqua", color: "#2e86ab" },
  { name: "Emerald", color: "#2e9e6b" },
  { name: "Violet", color: "#8a5fd4" },
  { name: "Gold", color: "#d99b34" },
  { name: "Rose", color: "#cf6285" },
  { name: "Crimson", color: "#c8324f" },
];

const monthly = () => MONTH_COLORS[new Date().getMonth()];

// stored value is a colour string, the "monthly" sentinel (Classic rotation),
// or absent (→ DEFAULT_TINT). trust nothing: a corrupt/legacy value falls back
// to the default rather than poisoning every tinted surface.
const storedRaw = localStorage.getItem("asp.theme");
const resolveStored = (v: string | null): string | null =>
  !v ? null : v === "monthly" ? monthly() : (globalThis.CSS?.supports?.("color", v) ?? true) ? v : null;
const [tint, setTintSig] = createSignal(resolveStored(storedRaw) ?? DEFAULT_TINT);

export { tint };

// the tint drives every themed surface via :root, not just the wave
const applyVar = (c: string) => document.documentElement.style.setProperty("--xmb-tint", c);
applyVar(tint());

export function applyTheme(color: string | null) {
  // color === null is the "Classic — monthly" preset — persist a sentinel so it
  // survives reloads (an absent key now means "use the default accent")
  if (color === null) {
    localStorage.setItem("asp.theme", "monthly");
    const m = monthly(); setTintSig(m); applyVar(m);
    return;
  }
  localStorage.setItem("asp.theme", color);
  setTintSig(color); applyVar(color);
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
export type BgMode = "space" | "nebula" | "ember" | "abyss" | "dawn" | "flat" | "calm" | "waves" | "reactive" | "aurora" | "fireflies" | "stars" | "grid" | "fluid";
// Animated gradient backdrops (CSS, near-black ground + slowly drifting colour
// clouds) come first — the modern, minimal look. The rest are the canvas-based
// living waves (audio-reactive) kept intact below.
export const BG_MODES: { id: BgMode; label: string; sub: string }[] = [
  { id: "space", label: "Deep Space", sub: "near-black · deep-blue drift" },
  { id: "nebula", label: "Nebula", sub: "violet & magenta clouds" },
  { id: "ember", label: "Ember", sub: "warm embers on black" },
  { id: "abyss", label: "Abyss", sub: "deep teal currents" },
  { id: "dawn", label: "Dawn", sub: "rose & violet gradient" },
  { id: "flat", label: "Flat 2D", sub: "the original still backdrop" },
  { id: "calm", label: "Calm", sub: "gentle PS3 waves" },
  { id: "waves", label: "Waves", sub: "fuller motion" },
  { id: "reactive", label: "Reactive", sub: "pulses to sound" },
  { id: "aurora", label: "Aurora", sub: "lively + glowing" },
  { id: "fireflies", label: "Fireflies", sub: "drifting embers — glow to sound" },
  { id: "stars", label: "Starfield", sub: "deep space — warps with the music" },
  { id: "grid", label: "Horizon", sub: "retro sunset grid — rides the beat" },
  { id: "fluid", label: "Fluid", sub: "WebGPU water — flows to sound" }, // offered only with WebGPU
];
const BG_KEY = "asp.bg";
const storedBg = localStorage.getItem(BG_KEY) as BgMode | null;
const [bgMode, setBgSig] = createSignal<BgMode>(storedBg && BG_MODES.some((m) => m.id === storedBg) ? storedBg : "space");
export { bgMode };
export function setBgMode(m: BgMode) { localStorage.setItem(BG_KEY, m); setBgSig(m); }

// —— screen upscaling ————————————————————————————————————————————————————
// Applies to every emulator, the video player and a spectated stream. Kept
// beside the background mode because it's the same kind of setting: a global
// look the console applies, not a per-app preference. Default off — it costs
// real GPU, and a 240p game with its original pixels is a legitimate taste.
const UPSCALE_KEY = "asp.upscale";
const storedUp = localStorage.getItem(UPSCALE_KEY) as UpscaleMode | null;
const [upscale, setUpSig] = createSignal<UpscaleMode>(
  storedUp && UPSCALE_MODES.some((m) => m.id === storedUp) ? storedUp : "off",
);
export { upscale };
export function setUpscale(m: UpscaleMode) { localStorage.setItem(UPSCALE_KEY, m); setUpSig(m); }

/** Index into THEMES; THEMES.length means "custom colour". */
export function currentThemeIndex(): number {
  const c = localStorage.getItem("asp.theme");
  if (c === "monthly") return 0;                        // Classic — monthly
  if (!c) { const d = THEMES.findIndex((t) => t.color === DEFAULT_TINT); return d === -1 ? 0 : d; }
  const i = THEMES.findIndex((t) => t.color === c);
  return i === -1 ? THEMES.length : i;
}
