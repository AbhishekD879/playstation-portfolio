// Game sources — the downloadable catalog behind PS2 & retro. A "source" is a
// manifest URL (JSON) listing games with a name, system, cover and a direct
// download URL. The console ships one legal-homebrew source and lets you add
// your own (a GitHub repo you control is ideal: raw.githubusercontent serves
// files with CORS *, so they fetch from any laptop). Downloading streams the
// file into OPFS and stores a link record — it plays like a linked disk and
// persists, no multi-GB memory blob. Nothing is sourced by us: legal homebrew
// by default, your own storage for everything else.
import { createSignal } from "solid-js";
import { CORES, PS2_EXTS, addGame, getGame, type GameRecord } from "./gamesdb";

export type GameSystem = "ps2" | "psp" | "gba" | "gb" | "nes" | "snes" | "segaMD" | "n64" | "nds";

export interface CatalogGame {
  id: string;         // stable per (source,url)
  name: string;
  system: GameSystem;
  cover?: string;
  url: string;        // direct, CORS-fetchable download URL
  size?: number;
  sourceName: string;
}

export interface GameSource { name: string; url: string; enabled: boolean; builtin?: boolean }

const KEY = "asp.gamesources";
const DEFAULT_SOURCES: GameSource[] = [
  // same-origin manifest that ships with the console (always loads); its games
  // point at CORS-open hosts. Users add their own sources alongside it.
  { name: "Homebrew (built-in)", url: "/catalog/homebrew.json", enabled: true, builtin: true },
];

export function loadSources(): GameSource[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(saved)) {
      // always keep the builtin present (users can disable, not delete it)
      return saved.some((s) => s.builtin) ? saved : [...DEFAULT_SOURCES, ...saved];
    }
  } catch { /* fall through */ }
  return DEFAULT_SOURCES;
}
const [sources, setSourcesSig] = createSignal<GameSource[]>(loadSources());
export { sources };
function persist(next: GameSource[]) { setSourcesSig(next); localStorage.setItem(KEY, JSON.stringify(next)); }

export function addSource(name: string, url: string) {
  const next = sources().filter((s) => s.url !== url);
  persist([...next, { name: name || url, url, enabled: true }]);
}
export function removeSource(url: string) { persist(sources().filter((s) => s.url !== url || s.builtin)); }
export function toggleSource(url: string) { persist(sources().map((s) => (s.url === url ? { ...s, enabled: !s.enabled } : s))); }

const systemOf = (raw: string, name: string): GameSystem | null => {
  const s = String(raw || "").toLowerCase();
  if (["ps2", "playstation2", "playstation 2"].includes(s)) return "ps2";
  if (["psp", "playstationportable", "playstation portable"].includes(s)) return "psp";
  if (s in CORES) return CORES[s] as GameSystem; // "gba","snes",…
  if (["gb", "gbc", "nes", "snes", "segamd", "genesis", "n64", "nds"].includes(s)) {
    return (s === "gbc" ? "gb" : s === "genesis" || s === "segamd" ? "segaMD" : s) as GameSystem;
  }
  // fall back to the download URL's extension. .iso/.cso are shared with PS2,
  // so an untyped one defaults to PS2 — set "system":"psp" in the manifest for PSP.
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pbp", "prx"].includes(ext)) return "psp";
  if (PS2_EXTS.includes(ext)) return "ps2";
  return (CORES[ext] as GameSystem) ?? null;
};

// hash a string → short stable id (no crypto needed, just stability)
const sid = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return "c" + (h >>> 0).toString(36); };

/** Fetch every enabled source, merge, dedupe by URL. Bad sources are skipped. */
export async function fetchCatalog(): Promise<{ games: CatalogGame[]; errors: string[] }> {
  const errors: string[] = [];
  const out: CatalogGame[] = [];
  const seen = new Set<string>();
  await Promise.all(sources().filter((s) => s.enabled).map(async (src) => {
    try {
      const r = await fetch(src.url, { cache: "no-cache" });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.games) ? data.games : [];
      for (const g of list) {
        if (!g?.url || seen.has(g.url)) continue;
        const system = systemOf(g.system, g.name ?? g.url);
        if (!system) continue;
        seen.add(g.url);
        out.push({ id: sid(src.url + g.url), name: g.name ?? g.url.split("/").pop(), system, cover: g.cover, url: g.url, size: g.size, sourceName: src.name });
      }
    } catch (e: any) {
      errors.push(`${src.name}: ${e?.message ?? "unreachable"}`);
    }
  }));
  return { games: out, errors };
}

// —— OPFS: where downloaded games live (persists, no CORS, survives reloads) ——
async function opfsGames(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("games", { create: true });
}

const extOf = (name: string, system: GameSystem) =>
  name.includes(".") ? name.split(".").pop()! : system === "ps2" || system === "psp" ? "iso" : system;

/** Stream a catalog game into OPFS and add it to the library as a persisted
 *  link record. onProgress(fraction|-1) — -1 when total size is unknown. */
export async function downloadGame(g: CatalogGame, profileId: string, onProgress?: (f: number) => void): Promise<GameRecord> {
  const r = await fetch(g.url);
  if (!r.ok || !r.body) throw new Error(`download failed (${r.status})`);
  const total = Number(r.headers.get("content-length")) || g.size || 0;
  const dir = await opfsGames();
  const fname = `${g.id}.${extOf(g.name, g.system)}`;
  const fh = await dir.getFileHandle(fname, { create: true });
  const w = await fh.createWritable();
  const reader = r.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await w.write(value);
      got += value.length;
      onProgress?.(total ? got / total : -1);
    }
    await w.close();
  } catch (e) { try { await w.abort(); } catch { /* ignore */ } try { await dir.removeEntry(fname); } catch { /* ignore */ } throw e; }

  const rec: GameRecord = {
    id: g.id, profileId, name: g.name,
    core: g.system === "ps2" ? "ps2" : g.system, sys: g.system === "ps2" ? "ps2" : undefined,
    size: got, addedAt: Date.now(), plays: 0,
    kind: "link", handle: fh, cover: g.cover, origin: "download",
  };
  await addGame(rec);
  return rec;
}

/** Is this catalog game already in the library (downloaded)? */
export async function isDownloaded(id: string): Promise<boolean> {
  return !!(await getGame(id));
}
