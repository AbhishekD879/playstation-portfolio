// RPG Maker library — bring-your-own-game, JoiPlay-style, in the browser.
// A user drops a .zip of a game they own; we detect which RPG Maker engine
// built it, normalise the tree, and extract it into the Origin-Private File
// System (OPFS) under /rpgm/<id>/. A metadata record lands in IndexedDB so
// the library survives reloads. Nothing is uploaded — the game lives only in
// this browser, exactly like the emulator ROMs and the photo gallery.
//
// Engines (each is a separate player surface):
//   · mv / mz          → native HTML5 (PixiJS). No emulation: a scoped
//                        service worker serves the files into an iframe.
//   · rm2k / rm2k3     → EasyRPG (WASM) — RPG Maker 2000 / 2003.
//   · xp / vx / vxace  → mkxp (WASM, RGSS) — RPG Maker XP / VX / VX Ace.
import { Unzip, UnzipInflate } from "fflate";

export type RpgEngine = "mz" | "mv" | "rm2k3" | "rm2k" | "vxace" | "vx" | "xp" | "unknown";

export interface RpgGame {
  id: string;
  profileId: string;
  title: string;
  engine: RpgEngine;
  entry: string;      // MV/MZ: path to index.html, relative to the game root
  root: string;       // prefix inside OPFS where the game tree lives (SW prepends it)
  addedAt: number;
  fileCount: number;
  bytes: number;      // total on-disk size, for the storage + runtime readouts
  cover?: string;     // data URL, best-effort (title/system image)
}

// —— memory model ————————————————————————————————————————————————————————————
// Only ONE game is ever resident (see RpgMaker.tsx — a single player mounts,
// and switching tears the previous one down completely). RAM budgets here are
// ADVISORY: they tell the visitor what a game will cost, never block it.
export const DEVICE_MEM_GB: number | undefined = (navigator as any).deviceMemory;
/** Rough peak-RAM estimate while a game runs. MV/MZ stream assets on demand,
 *  so it's a baseline engine cost plus a fraction of the game size — clearly
 *  approximate, shown to inform, not to gate. */
export function estimateRuntimeMB(g: RpgGame): number {
  const sizeMB = g.bytes / 1048576;
  const base = engineKind(g.engine) === "html5" ? 130 : 90; // PixiJS+WebGL vs WASM engine
  return Math.round(base + Math.min(sizeMB * 0.5, 400));
}
/** True when the estimate is a large share of a (Chromium-reported) device
 *  memory — surfaces a gentle "may be heavy" note; still always launches. */
export function looksHeavy(g: RpgGame): boolean {
  if (!DEVICE_MEM_GB) return false;
  return estimateRuntimeMB(g) > DEVICE_MEM_GB * 1024 * 0.5;
}

export const ENGINE_LABEL: Record<RpgEngine, string> = {
  mz: "RPG Maker MZ", mv: "RPG Maker MV",
  rm2k3: "RPG Maker 2003", rm2k: "RPG Maker 2000",
  vxace: "RPG Maker VX Ace", vx: "RPG Maker VX", xp: "RPG Maker XP",
  unknown: "Unknown / unsupported",
};
/** Which player surface an engine routes to. */
export const engineKind = (e: RpgEngine): "html5" | "easyrpg" | "mkxp" | "none" =>
  e === "mz" || e === "mv" ? "html5"
  : e === "rm2k" || e === "rm2k3" ? "easyrpg"
  : e === "xp" || e === "vx" || e === "vxace" ? "mkxp"
  : "none";

// —— IndexedDB metadata store ————————————————————————————————————————————————
const DB = "asp-rpgm", STORE = "games", VER = 1;
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) {
        r.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("profileId", "profileId");
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function listRpgGames(profileId: string): Promise<RpgGame[]> {
  const d = await db();
  return new Promise((res, rej) => {
    const req = d.transaction(STORE).objectStore(STORE).index("profileId").getAll(profileId);
    req.onsuccess = () => res((req.result as RpgGame[]).sort((a, b) => b.addedAt - a.addedAt));
    req.onerror = () => rej(req.error);
  });
}
async function putGame(g: RpgGame): Promise<void> {
  const d = await db();
  await new Promise<void>((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(g); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// —— OPFS helpers ————————————————————————————————————————————————————————————
async function rpgmDir(create = false): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("rpgm", { create });
}
async function gameDir(id: string, create = false): Promise<FileSystemDirectoryHandle> {
  return (await rpgmDir(create)).getDirectoryHandle(id, { create });
}
/** Walk a slash path to its parent dir, creating dirs as needed. */
async function ensurePath(rootDir: FileSystemDirectoryHandle, path: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop()!;
  let dir = rootDir;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  return { dir, name };
}
/** Read the whole extracted game as a flat list of path → bytes (for the
 *  Emscripten engines, which populate their in-memory FS before boot). */
export async function readAllGameFiles(id: string): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (dir as any).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") await walk(handle, path);
      else { const f = await handle.getFile(); out.push({ path, bytes: new Uint8Array(await f.arrayBuffer()) }); }
    }
  };
  await walk(await gameDir(id), "");
  return out;
}

/** Read one file out of an extracted game (used by the SW-less fallback + covers). */
export async function readGameFile(id: string, path: string): Promise<File | null> {
  try {
    const { dir, name } = await ensurePath(await gameDir(id), path);
    return await (await dir.getFileHandle(name)).getFile();
  } catch { return null; }
}

// —— detection ————————————————————————————————————————————————————————————————
// Given the flat list of zip paths, find the engine + the game's root prefix
// (the folder that should become the OPFS root, stripping any wrapper folder).
interface Detected { engine: RpgEngine; root: string; entry: string }
function detect(paths: string[]): Detected {
  const lower = paths.map((p) => p.toLowerCase());
  const find = (pred: (p: string) => boolean) => { const i = lower.findIndex(pred); return i < 0 ? null : paths[i]; };
  const dirOf = (p: string) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i + 1); };

  // MV / MZ — an index.html beside a js/ core. MZ ships rmmz_*.js, MV rpg_*.js.
  const mzCore = find((p) => /(^|\/)js\/rmmz_core\.js$/.test(p));
  const mvCore = find((p) => /(^|\/)js\/rpg_core\.js$/.test(p));
  if (mzCore || mvCore) {
    const core = (mzCore || mvCore)!;
    const root = core.slice(0, core.toLowerCase().indexOf("js/")); // dir containing js/
    const idx = find((p) => p.toLowerCase() === `${root}index.html`.toLowerCase()) ?? `${root}index.html`;
    return { engine: mzCore ? "mz" : "mv", root, entry: idx.slice(root.length) };
  }

  // 2000 / 2003 — RPG_RT.ldb is the database; RPG_RT.lmt the map tree.
  const ldb = find((p) => /(^|\/)rpg_rt\.ldb$/.test(p));
  if (ldb) {
    const root = dirOf(ldb);
    // 2k3 databases declare a higher version; without parsing, treat presence
    // of an ExFont or the 2k3-only "easyrpg" markers as a hint, else default 2k3
    // (EasyRPG runs both from the same binary — the .ldb version auto-selects).
    return { engine: "rm2k3", root, entry: "" };
  }

  // XP / VX / VX Ace — encrypted archive extension is the cleanest tell.
  const rgss3 = find((p) => /\.rgss3a$/.test(p) || /\.rvdata2$/.test(p));
  const rgss2 = find((p) => /\.rgss2a$/.test(p) || /\.rvdata$/.test(p));
  const rgss1 = find((p) => /\.rgssad$/.test(p) || /\.rxdata$/.test(p));
  if (rgss3 || rgss2 || rgss1) {
    const anchor = (rgss3 || rgss2 || rgss1)!;
    return { engine: rgss3 ? "vxace" : rgss2 ? "vx" : "xp", root: dirOf(anchor), entry: "" };
  }
  // Game.ini RGSS library line, as a fallback for decrypted projects
  const ini = find((p) => /(^|\/)game\.ini$/.test(p));
  if (ini) return { engine: "xp", root: dirOf(ini), entry: "" }; // refined after read below

  return { engine: "unknown", root: "", entry: "" };
}

// —— import ————————————————————————————————————————————————————————————————————
export interface ImportProgress { phase: "reading" | "detecting" | "extracting"; pct: number }

// runtime/OS files useless in the browser — never extracted (a desktop NW.js
// build ships a huge Chromium runtime — Game.exe, *.pak, *.dll, icudtl.dat,
// locales/ — around the www/ game; inflating that would waste space/time)
const isRuntimeJunk = (p: string) =>
  /\.(exe|pak|dll|dat|bin|so|dylib|nro|elf|msi|lib|node)$/i.test(p) ||
  /(^|\/)(locales|swiftshader)\//i.test(p) ||
  /(^|\/)(credits\.html|d3dcompiler|libegl|libglesv2|ffmpeg|vk_swiftshader|vulkan-1|chrome_.*\.bin)/i.test(p);

/** Parse a zip and extract into OPFS — fully STREAMING. Never loads the whole
 *  archive (or any large slice) into memory, so multi-GB games don't OOM the
 *  tab: the file is read chunk-by-chunk from disk, each entry decompressed and
 *  written straight to OPFS, and the huge NW.js runtime is skipped entirely.
 *  The game root is NOT stripped — its prefix is recorded and the service
 *  worker prepends it, so detection can happen after the (single) stream. */
export async function importRpgZip(
  file: File, profileId: string, onProgress?: (p: ImportProgress) => void,
): Promise<RpgGame> {
  onProgress?.({ phase: "reading", pct: 0 });

  // fail EARLY (with a clear message, not a crash) if it can't possibly fit —
  // the compressed size is already a floor for what OPFS must hold
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota != null && est.usage != null) {
      const free = est.quota - est.usage;
      if (file.size > free) {
        const gb = (n: number) => (n / 1073741824).toFixed(1);
        throw new Error(`Not enough room: this game is ${gb(file.size)} GB but only ${gb(free)} GB is free on this device.`);
      }
    }
  } catch (e) { if (e instanceof Error && e.message.startsWith("Not enough")) throw e; }

  const id = crypto.randomUUID();
  const dir = await gameDir(id, true);
  const names: string[] = [];
  const pending: { path: string; chunks: Uint8Array[] }[] = [];
  let bytes = 0;

  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (f) => {
    names.push(f.name);
    if (f.name.endsWith("/") || isRuntimeJunk(f.name)) return; // dirs + runtime → skipped (never inflated)
    const chunks: Uint8Array[] = [];
    f.ondata = (err, chunk, final) => {
      if (err) throw err;
      if (chunk && chunk.length) chunks.push(chunk.slice()); // copy: fflate reuses buffers
      if (final) pending.push({ path: f.name, chunks });
    };
    f.start();
  };

  const flush = async () => {
    while (pending.length) {
      const { path, chunks } = pending.shift()!;
      const { dir: parent, name } = await ensurePath(dir, path);
      const fh = await parent.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      for (const c of chunks) { await w.write(c as unknown as BufferSource); bytes += c.length; }
      await w.close();
    }
  };

  try {
    const reader = (file.stream() as ReadableStream<Uint8Array>).getReader();
    let read = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { uz.push(value, false); read += value.length; }
      if (done) uz.push(new Uint8Array(0), true);
      await flush(); // write finished entries to OPFS between reads (backpressure + frees memory)
      if (file.size) onProgress?.({ phase: "extracting", pct: Math.min(99, Math.round((read / file.size) * 100)) });
      if (done) break;
    }
  } catch (e) {
    await (await rpgmDir()).removeEntry(id, { recursive: true }).catch(() => {});
    if (e instanceof Error && /quota|space|QuotaExceeded/i.test(e.name + e.message)) {
      throw new Error("Ran out of storage while installing — this game is too big for this device.");
    }
    throw e;
  }

  const paths = names.filter((p) => !p.endsWith("/"));
  let det = detect(paths);
  if (det.engine === "unknown") {
    await (await rpgmDir()).removeEntry(id, { recursive: true }).catch(() => {});
    throw new Error("Not a recognised RPG Maker game (no index.html / RPG_RT / RGSS data found).");
  }

  // refine XP/VX/VXAce from Game.ini's Library= line (read the one small file)
  if (det.engine === "xp") {
    const f = await readGameFile(id, `${det.root}Game.ini`).catch(() => null)
      ?? await readGameFile(id, paths.find((p) => p.toLowerCase() === `${det.root}game.ini`.toLowerCase()) ?? "").catch(() => null);
    if (f) {
      const ini = (await f.text()).toLowerCase();
      if (/rgss3|rvdata2/.test(ini)) det = { ...det, engine: "vxace" };
      else if (/rgss2|rvdata\b/.test(ini)) det = { ...det, engine: "vx" };
    }
  }

  // record the game root so the SW can prepend it (we didn't strip the tree)
  await writeMarker(dir, ".rpgmroot", det.root);

  const title = file.name.replace(/\.zip$/i, "").replace(/[._]+/g, " ").trim() || "RPG Maker Game";
  const cover = await bestCover(id, det.engine, det.root).catch(() => undefined);

  // EasyRPG needs a case-insensitive directory manifest (index.json) it fetches
  // first — generated here (EasyRPG's gencache v2 rules), rooted at det.root.
  if (engineKind(det.engine) === "easyrpg") await buildEasyRpgIndex(id, det.root);

  const game: RpgGame = { id, profileId, title, engine: det.engine, entry: det.entry, root: det.root, addedAt: Date.now(), fileCount: paths.length, bytes, cover };
  await putGame(game);
  return game;
}

async function writeMarker(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([text]));
  await w.close();
}

// —— EasyRPG index.json (v2) generator ————————————————————————————————————————
// Rules (from EasyRPG/Tools gencache): keys are NFKC-lowercased, values keep
// real case. Root files keep their extension in the key; files inside a
// subdirectory strip the extension (except .ini/.po); a subdir is an object
// carrying "_dirname" = real folder name; root ExFont.* → key "exfont".
type Cache = { [k: string]: string | Cache };
const lc = (s: string) => s.normalize("NFKC").toLowerCase();
const stripExt = (n: string) => (/\.(ini|po)$/i.test(n) ? n : n.replace(/\.[^.]+$/, ""));

async function buildCache(dir: FileSystemDirectoryHandle, depth: number): Promise<Cache> {
  const out: Cache = {};
  for await (const [name, handle] of (dir as any).entries()) {
    if (name === "_dirname" || name === "index.json") continue;
    if (handle.kind === "directory") {
      const sub = await buildCache(handle, depth + 1);
      sub._dirname = name;
      out[lc(name)] = sub;
    } else {
      if (depth === 0) {
        const key = /^exfont(\.|$)/i.test(name) ? "exfont" : lc(name); // root keeps ext (ExFont special-cased)
        out[key] = name;
      } else {
        out[lc(stripExt(name))] = name;
      }
    }
  }
  return out;
}
/** Deep-merge (game entries win) so the shared RTP fills only the gaps. */
function mergeCache(base: Cache, over: Cache): Cache {
  const out: Cache = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (b && typeof b === "object" && typeof v === "object") out[k] = mergeCache(b as Cache, v as Cache);
    else out[k] = v;
  }
  return out;
}
/** Navigate into a slash-prefix subdirectory (""=the dir itself). */
async function intoDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<FileSystemDirectoryHandle> {
  let d = dir;
  for (const p of prefix.split("/").filter(Boolean)) d = await d.getDirectoryHandle(p);
  return d;
}
async function buildEasyRpgIndex(id: string, root: string): Promise<void> {
  const gameRoot = await intoDir(await gameDir(id), root);
  const gameCache = await buildCache(gameRoot, 0);
  // merge the bundled RTP manifest so RTP-dependent games find shared assets
  let cache = gameCache;
  try {
    const res = await fetch("/rpgm/easyrpg/rtp/rtp-cache.json");
    if (res.ok) cache = mergeCache((await res.json()) as Cache, gameCache);
  } catch { /* no RTP pack — self-contained games still work */ }
  const index = { cache, metadata: { version: 2, date: new Date().toISOString().slice(0, 10) } };
  const fh = await gameRoot.getFileHandle("index.json", { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([JSON.stringify(index)]));
  await w.close();
}

/** Best-effort cover: MV/MZ title screen, or the 2k/2k3/RGSS Title graphic. */
async function bestCover(id: string, engine: RpgEngine, root: string): Promise<string | undefined> {
  const candidates = engineKind(engine) === "html5"
    ? ["img/titles1/", "img/titles/"]
    : ["Title/", "Graphics/Titles/", "Graphics/System/"];
  for (const base of candidates) {
    const f = await firstImageIn(id, root + base);
    if (f) return await blobToDataUrl(f);
  }
  return undefined;
}
async function firstImageIn(id: string, base: string): Promise<File | null> {
  try {
    const dir = await intoDir(await gameDir(id), base);
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === "file" && /\.(png|jpe?g|webp)$/i.test(name)) return await handle.getFile();
    }
  } catch { /* no such dir */ }
  return null;
}
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });

// —— delete ————————————————————————————————————————————————————————————————————
export async function removeRpgGame(id: string): Promise<void> {
  try { await (await rpgmDir()).removeEntry(id, { recursive: true }); } catch { /* already gone */ }
  await purgeGameStorage(id); // its isolated saves, too
  const d = await db();
  await new Promise<void>((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

// —— per-game save isolation ————————————————————————————————————————————————
// A game runs in a same-origin iframe, so its localStorage/IndexedDB would
// otherwise be OURS — every MZ game's localforage collides on the shared
// "localforage" DB (same file1/config keys). The SW injects a shim that
// namespaces both per game (prefix below). Deleting a game purges them.
export const SAVE_IDB_PREFIX = (id: string) => `rpgm-${id}-`;
export const SAVE_LS_PREFIX = (id: string) => `__rpgmls_${id}__:`;

async function purgeGameStorage(id: string): Promise<void> {
  const idbPrefix = SAVE_IDB_PREFIX(id);
  const easyrpgSave = `/easyrpg/${id}/Save`; // EasyRPG's IDBFS DB is named by its mount path
  try {
    const dbs = await (indexedDB.databases?.() ?? Promise.resolve([]));
    await Promise.all(dbs
      .filter((d) => d.name && (d.name.startsWith(idbPrefix) || d.name === easyrpgSave))
      .map((d) => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  } catch { /* databases() unsupported — leaves them, harmless & tiny */ }
  const lsPrefix = SAVE_LS_PREFIX(id);
  for (const k of Object.keys(localStorage)) if (k.startsWith(lsPrefix)) localStorage.removeItem(k);
}

// —— the scoped service worker that serves games into the iframe ————————————————
let swReady: Promise<void> | null = null;
/** Register the /rpgm-fs/ service worker (dev + prod; scope-isolated so it
 *  never touches HMR or the main app shell). Idempotent. */
export function ensureRpgSw(): Promise<void> {
  if (swReady) return swReady;
  swReady = (async () => {
    if (!("serviceWorker" in navigator)) throw new Error("no service worker");
    const reg = await navigator.serviceWorker.register("/rpgm-sw.js", { scope: "/rpgm/" });
    // Wait on THIS registration's own activation — not navigator.serviceWorker.ready,
    // which tracks the page's scope ("/") and never resolves for our /rpgm-fs/ worker.
    if (reg.active) return;
    const w = reg.installing || reg.waiting;
    if (!w) return;
    await new Promise<void>((res, rej) => {
      const done = () => { if (w.state === "activated") { res(); return true; } return false; };
      if (done()) return;
      w.addEventListener("statechange", () => { done(); });
      setTimeout(() => (reg.active ? res() : rej(new Error("sw activation timed out"))), 8000);
    });
  })();
  return swReady;
}
