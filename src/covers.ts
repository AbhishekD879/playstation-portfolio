// Generated box art — the last resort when a game has no real cover.
//
// The library pulls proper boxarts from libretro-thumbnails, but homebrew, odd
// dumps and renamed files often match nothing, leaving a wall of blank tiles.
// Rather than ship a 2.5 GB diffusion model to decorate a shelf, each cover is
// DRAWN from the title: the name is hashed into a seed, and the seed picks a
// palette and a motif. Same game, same art, every time and on every device —
// no download, no GPU, no network.
//
// Deliberately abstract (bands, arcs, horizons, starfields) rather than trying
// to fake a real cover: it reads as "the console made a placeholder", which is
// honest, instead of an uncanny AI mush pretending to be official art.

/** FNV-1a — small, fast, and stable across browsers (unlike hashing via Math.random seeds). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** mulberry32: tiny deterministic PRNG so a title always yields the same art. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palettes chosen to look like game packaging: a deep ground, a vivid key and a
// warm/cool accent that survives being shrunk to a thumbnail.
const PALETTES: [string, string, string][] = [
  ["#0b1b3a", "#4aa3ff", "#ff5c8a"],
  ["#1a0b2e", "#c07bff", "#ffc94a"],
  ["#07231d", "#43d9a3", "#e0d437"],
  ["#2a0d12", "#ff5c6c", "#ffb066"],
  ["#101418", "#e6e9ef", "#ff8f43"],
  ["#0a1f2b", "#37d0e0", "#a6ff8f"],
  ["#241205", "#ff8f43", "#ffd98f"],
  ["#160b24", "#8f7bff", "#54e8d0"],
];

type Motif = "bands" | "arcs" | "horizon" | "stars" | "grid" | "burst";
const MOTIFS: Motif[] = ["bands", "arcs", "horizon", "stars", "grid", "burst"];

const W = 360, H = 480; // 3:4, the usual boxart ratio

/** A deterministic cover for `name`, as a JPEG data URL. `label` rides along the
 *  bottom (the system name), so a shelf of generated covers still reads. */
export function generateCover(name: string, label = ""): string {
  const seed = hash(name.toLowerCase().trim());
  const r = rng(seed);
  // 8 palettes × 6 motifs is only 48 combinations, so a shelf of a dozen games
  // showed visible twins. A full-hue-wheel rotation fixes that — but it must come
  // from a SEPARATELY SALTED hash: taking more bits off the same seed left
  // "Zelda" and "Pokemon Emerald" on the same palette+motif only 8° apart, which
  // still read as the same cover.
  const spin = hash(name.toLowerCase().trim() + "|hue") % 360;
  const [bg, key, accent] = PALETTES[seed % PALETTES.length].map((c) => hueShift(c, spin)) as [string, string, string];
  const motif = MOTIFS[(seed >>> 8) % MOTIFS.length];

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;

  // ground: a soft vertical wash so the art has depth even before the motif
  const wash = g.createLinearGradient(0, 0, W * 0.4, H);
  wash.addColorStop(0, bg);
  wash.addColorStop(1, mix(bg, "#000000", 0.45));
  g.fillStyle = wash; g.fillRect(0, 0, W, H);

  g.save();
  g.globalCompositeOperation = "lighter";
  if (motif === "bands") {
    for (let i = 0; i < 7; i++) {
      const y = r() * H, h = 8 + r() * 48;
      g.fillStyle = alpha(i % 2 ? key : accent, 0.10 + r() * 0.16);
      g.save(); g.translate(0, y); g.rotate((r() - 0.5) * 0.5);
      g.fillRect(-W, 0, W * 3, h); g.restore();
    }
  } else if (motif === "arcs") {
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(W * (0.2 + r() * 0.7), H * (0.15 + r() * 0.7), 40 + r() * 190, 0, Math.PI * 2);
      g.strokeStyle = alpha(i % 2 ? key : accent, 0.14 + r() * 0.22);
      g.lineWidth = 2 + r() * 12; g.stroke();
    }
  } else if (motif === "horizon") {
    const hy = H * (0.5 + r() * 0.18);
    const sun = g.createRadialGradient(W / 2, hy, 6, W / 2, hy, 190);
    sun.addColorStop(0, alpha(accent, 0.85)); sun.addColorStop(1, alpha(accent, 0));
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    g.strokeStyle = alpha(key, 0.5); g.lineWidth = 2;
    for (let i = 1; i < 16; i++) {           // perspective floor
      const y = hy + Math.pow(i / 16, 2.1) * (H - hy);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
  } else if (motif === "stars") {
    for (let i = 0; i < 220; i++) {
      const s = r() * 2.1;
      g.fillStyle = alpha(r() > 0.82 ? accent : key, 0.25 + r() * 0.7);
      g.fillRect(r() * W, r() * H, s, s);
    }
  } else if (motif === "grid") {
    g.strokeStyle = alpha(key, 0.28); g.lineWidth = 1.5;
    const step = 26 + r() * 22;
    for (let x = 0; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = alpha(accent, 0.5);
    for (let i = 0; i < 12; i++) g.fillRect(Math.floor(r() * (W / step)) * step - 3, Math.floor(r() * (H / step)) * step - 3, 6, 6);
  } else {
    const cx = W * (0.25 + r() * 0.5), cy = H * (0.28 + r() * 0.3);
    for (let i = 0; i < 26; i++) {          // burst
      const a = r() * Math.PI * 2, len = 60 + r() * 260;
      g.strokeStyle = alpha(i % 3 ? key : accent, 0.10 + r() * 0.3);
      g.lineWidth = 1 + r() * 5;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
    }
  }
  g.restore();

  // vignette keeps the type legible whatever the motif did
  const vig = g.createRadialGradient(W / 2, H * 0.42, H * 0.2, W / 2, H * 0.6, H * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,0.72)");
  g.fillStyle = vig; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(0, H - 150, W, 150);

  // —— title, wrapped to at most 4 lines, biggest size that fits ——
  const words = name.replace(/\.[^.]+$/, "").replace(/\s*[([].*$/, "").trim().split(/\s+/);
  let size = 40;
  let lines: string[] = [];
  for (; size >= 20; size -= 2) {
    g.font = `600 ${size}px "Jost", system-ui, sans-serif`;
    lines = wrap(g, words, W - 56);
    if (lines.length <= 4) break;
  }
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(0,0,0,0.75)"; g.shadowBlur = 12;
  let ty = H - 54 - (lines.length - 1) * (size * 1.12);
  for (const ln of lines) { g.fillText(ln, 28, ty); ty += size * 1.12; }
  g.shadowBlur = 0;

  if (label) {
    g.font = '500 13px "Jost", system-ui, sans-serif';
    g.fillStyle = alpha(accent, 0.95);
    g.fillText(label.toUpperCase(), 28, H - 26);
  }
  // a key-coloured spine, like a real case
  g.fillStyle = key; g.fillRect(0, 0, 7, H);

  return c.toDataURL("image/jpeg", 0.82);
}


/** Rotate a hex colour's hue by `deg`, keeping saturation/lightness. */
function hueShift(hex: string, deg: number): string {
  let [r, g, b] = parse(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  h = (h + deg + 360) % 360;
  const c2 = (1 - Math.abs(2 * l - 1)) * sat, x = c2 * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c2 / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [[c2, x, 0], [x, c2, 0], [0, c2, x], [0, x, c2], [x, 0, c2], [c2, 0, x]][seg];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

// —— tiny colour helpers (no dependency needed for this much) ——
function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a), [br, bg2, bb] = parse(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(ar, br)},${f(ag, bg2)},${f(ab, bb)})`;
}
function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function wrap(g: CanvasRenderingContext2D, words: string[], max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
