// Console theme — a single accent tint driving the wave gradient.
// Persisted system-wide, like console wallpaper.
import { createSignal } from "solid-js";
import { MONTH_COLORS } from "./content";

export const THEMES: { name: string; color: string | null }[] = [
  { name: "Classic — monthly", color: null }, // the PS3 monthly rotation
  { name: "Midnight", color: "#2c3e67" },
  { name: "Horizon", color: "#c86a4a" },
  { name: "Forest", color: "#3e7a55" },
  { name: "Orchid", color: "#7a55a8" },
  { name: "Crimson", color: "#a83e4c" },
  { name: "Slate", color: "#5c6672" },
  { name: "Gold", color: "#b08a3e" },
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

export function currentThemeIndex(): number {
  const c = localStorage.getItem("asp.theme");
  const i = THEMES.findIndex((t) => t.color === c);
  return i === -1 ? 0 : i;
}
