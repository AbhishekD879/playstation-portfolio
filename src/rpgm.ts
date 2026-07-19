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
import { Inflate } from "fflate";
import { checkEntry, entryDataStart, isAudioPath, runtimeSkipper, zipEntries, zipReadError } from "./zipcd";

export type RpgEngine =
  | "mz" | "mv" | "rm2k3" | "rm2k" | "vxace" | "vx" | "xp"
  | "renpy" | "renpydesktop"
  // web-exported engine games — these RUN in a browser natively (no emulation),
  // we just serve the exported build. A user brings the game's own web export.
  | "godot" | "unity" | "html5"
  | "unknown";

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
  const k = engineKind(g.engine);
  // PixiJS+WebGL · CPython+SDL wasm · EasyRPG wasm · engine wasm (Godot/Unity/…)
  const base = k === "html5" ? 130 : k === "renpy" ? 160 : k === "web" ? 150 : 90;
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
  renpy: "Ren'Py", renpydesktop: "Ren'Py (desktop build)",
  godot: "Godot (Web export)", unity: "Unity (WebGL)", html5: "HTML5 / WebGL",
  unknown: "Unknown / unsupported",
};
/** Which cabinet a game belongs to — RPG Maker, Ren'Py and Web games are
 *  separate apps (a web-exported Godot/Unity/HTML5 game is its own family). */
export const engineFamily = (e: RpgEngine): "renpy" | "rpgmaker" | "web" =>
  e === "renpy" || e === "renpydesktop" ? "renpy"
  : e === "godot" || e === "unity" || e === "html5" ? "web"
  : "rpgmaker";

/** Which player surface an engine routes to. ("web" = serve the exported build
 *  in an iframe, like Ren'Py; the browser runs it natively — no emulation.) */
export const engineKind = (e: RpgEngine): "html5" | "easyrpg" | "mkxp" | "renpy" | "web" | "none" =>
  e === "mz" || e === "mv" ? "html5"
  : e === "rm2k" || e === "rm2k3" ? "easyrpg"
  : e === "xp" || e === "vx" || e === "vxace" ? "mkxp"
  : e === "renpy" ? "renpy"
  : e === "godot" || e === "unity" || e === "html5" ? "web"
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

// —— packed-install reader (main thread) ——————————————————————————————————————
// New installs are ONE compact zip (.rpgmpack) in the game dir; files inflate
// on demand. This mirrors what the service worker does, for main-thread needs
// (covers, Game.ini engine refinement).
const packCache = new Map<string, Promise<{ file: File; map: Map<string, import("./zipcd").ZipEntry> } | null>>();
function packOf(id: string) {
  let p = packCache.get(id);
  if (!p) {
    p = (async () => {
      try {
        const fh = await (await gameDir(id)).getFileHandle(".rpgmpack");
        const file = await fh.getFile();
        const map = new Map<string, import("./zipcd").ZipEntry>();
        for (const e of await zipEntries(file)) map.set(e.name.normalize("NFKC").toLowerCase(), e);
        return { file, map };
      } catch { return null; }
    })();
    packCache.set(id, p);
  }
  return p;
}

/** Read one file out of a game — loose (extracted installs, markers,
 *  index.json) first, then the pack. Used for covers + engine refinement. */
export async function readGameFile(id: string, path: string): Promise<File | null> {
  try {
    const { dir, name } = await ensurePath(await gameDir(id), path);
    return await (await dir.getFileHandle(name)).getFile();
  } catch { /* not loose — try the pack */ }
  try {
    const pack = await packOf(id);
    if (!pack) return null;
    const ent = pack.map.get(path.normalize("NFKC").toLowerCase());
    if (!ent) return null;
    const ds = await entryDataStart(pack.file, ent);
    const slice = pack.file.slice(ds, ds + ent.compSize);
    const blob = ent.method === 0
      ? slice
      : await new Response(slice.stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).blob();
    return new File([blob], path.split("/").pop() || "file");
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

  // Ren'Py WEB build (exported via the launcher's "Web" build) — a wasm engine
  // (renpy.wasm / index.wasm on 7.x) + the renpy.js loader beside an index.html.
  // The whole game/ tree is packed inside game.zip, so there are no loose .rpyc.
  // Web builds use only relative paths, so they run from our /rpgm/renpy/<id>/
  // subpath with no rewriting and need no cross-origin isolation.
  const renpyWasm = find((p) => /(^|\/)(renpy|index)\.wasm(\.gz)?$/.test(p));
  const renpyLoader = find((p) => /(^|\/)renpy\.js$/.test(p)) || find((p) => /(^|\/)game\.zip$/.test(p));
  if (renpyWasm && renpyLoader) {
    const root = dirOf(renpyWasm);
    const idx = find((p) => p.toLowerCase() === `${root}index.html`.toLowerCase()) ?? `${root}index.html`;
    return { engine: "renpy", root, entry: idx.slice(root.length) };
  }

  // Ren'Py DESKTOP / project build — detected so we can save it and show an
  // honest notice. It CAN'T run in a browser: the engine ships as platform
  // native modules (.so/.pyd) and the .rpyc bytecode is locked to the exact
  // Ren'Py version, so no single bundled runtime plays arbitrary games. The
  // author must re-export it "for web" from the Ren'Py launcher.
  const isRenpy = find((p) => /\.rpa$/.test(p))
    || find((p) => /(^|\/)game\/.*\.rpyc$/.test(p))
    || find((p) => /(^|\/)renpy\/__init__\.py$/.test(p))
    || find((p) => /(^|\/)lib\/py[0-9]/.test(p))
    || find((p) => /(^|\/)game\/.*\.rpy$/.test(p))
    || find((p) => /(^|\/)game\/script_version\.txt$/.test(p));
  if (isRenpy) return { engine: "renpydesktop", root: "", entry: "" };

  // —— Web-exported ENGINE games ——————————————————————————————————————————————
  // These RUN natively in the browser — no emulation, we just serve the build a
  // user already exported "for web". Covers Godot (HTML5), Unity (WebGL), Wolf
  // RPG (Browser-Woditor build), and any plain HTML5/WebGL game. The tell is an
  // index.html that ISN'T an RPG Maker / Ren'Py one (those returned above).
  const indexes = paths.filter((p) => /(^|\/)index\.html?$/i.test(p));
  if (indexes.length) {
    // shallowest index.html is the entry (build folders may nest helper pages)
    const idx = indexes.slice().sort((a, b) => a.split("/").length - b.split("/").length)[0];
    const root = dirOf(idx);
    const rootLc = root.toLowerCase();
    const inRoot = (re: RegExp) => lower.some((p) => p.startsWith(rootLc) && re.test(p));
    // Godot: a .pck data pack (unique to Godot) beside the engine .wasm.
    // Unity: a Build/ dir with the loader/framework glue (+ .data/.wasm, maybe
    //        .br/.gz/.unityweb compressed). Else a generic HTML5/WebGL game.
    const engine: RpgEngine =
      inRoot(/\.pck$/) ? "godot"
      : inRoot(/(^|\/)build\/[^/]*\.(loader|framework)\.js$/) || inRoot(/(^|\/)build\/[^/]*\.(data|wasm)(\.(br|gz|unityweb))?$/) ? "unity"
      : "html5";
    return { engine, root, entry: idx.slice(root.length) };
  }

  return { engine: "unknown", root: "", entry: "" };
}

// —— import ————————————————————————————————————————————————————————————————————
export interface ImportProgress { phase: "reading" | "detecting" | "extracting"; pct: number }

// zip parsing + runtime-skip live in src/zipcd.ts (shared with the import
// worker); extraction itself runs in src/rpgmImport.worker.ts when possible.

/** Parse a zip and extract into OPFS — fully STREAMING. Never loads the whole
 *  archive (or any large slice) into memory, so multi-GB games don't OOM the
 *  tab: the file is read chunk-by-chunk from disk, each entry decompressed and
 *  written straight to OPFS, and the huge NW.js runtime is skipped entirely.
 *  The game root is NOT stripped — its prefix is recorded and the service
 *  worker prepends it, so detection can happen after the (single) stream. */
// "lite install" — music/sounds skipped, images lossy-recompressed to WebP
export interface ImportOpts { skipAudio?: boolean; compressImages?: boolean }

export async function importRpgZip(
  file: File, profileId: string, onProgress?: (p: ImportProgress) => void, opts?: ImportOpts,
): Promise<RpgGame> {
  return doImport(file, profileId, crypto.randomUUID(), null, onProgress, opts);
}

/** RE-IMPORT an existing game IN PLACE — same id, so its saves survive.
 *  Saves are namespaced by game id (SAVE_IDB_PREFIX / SAVE_LS_PREFIX /
 *  EasyRPG's /easyrpg/<id>/Save), so replacing the FILES under the same id
 *  updates the game without touching progress. Used to repair games imported
 *  before a fix (e.g. the .dat/.bin skip) without losing save data. */
export async function reimportRpgZip(
  file: File, game: RpgGame, onProgress?: (p: ImportProgress) => void, opts?: ImportOpts,
): Promise<RpgGame> {
  await (await rpgmDir()).removeEntry(game.id, { recursive: true }).catch(() => {});
  packCache.delete(game.id);
  bustSwRootCache(game.id); // the SW caches .rpgmroot/.rpgmlite/.rpgmpack per id
  return doImport(file, game.profileId, game.id, game, onProgress, opts);
}

/** The running SW memoises each game's root prefix; after a re-import the root
 *  can differ, so tell it to forget (harmless if no SW / not yet active). */
function bustSwRootCache(id: string): void {
  try { navigator.serviceWorker.getRegistration("/rpgm/").then((reg) => reg?.active?.postMessage({ type: "rpgm-root-bust", id })); } catch { /* no sw */ }
}

/** Run the extraction in the dedicated worker. Resolves null when the worker
 *  path isn't available (old browser, worker failed to boot) — caller falls
 *  back to in-page extraction. Rejects with the worker's error (carrying .ctx,
 *  the file-position context) when extraction itself failed. */
function extractInWorker(file: File, id: string, opts: ImportOpts, onProgress?: (p: ImportProgress) => void): Promise<{ bytes: number } | null> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./rpgmImport.worker.ts", import.meta.url), { type: "module" });
    } catch { resolve(null); return; }
    w.onerror = () => { w.terminate(); resolve(null); }; // couldn't even boot → fallback
    w.onmessage = (ev) => {
      const d = ev.data as { type: string; pct?: number; bytes?: number; message?: string; name?: string; ctx?: string; fallback?: boolean };
      if (d.type === "progress") onProgress?.({ phase: "extracting", pct: d.pct ?? 0 });
      else if (d.type === "done") { w.terminate(); resolve({ bytes: d.bytes ?? 0 }); }
      else if (d.type === "error") {
        w.terminate();
        if (d.fallback) { resolve(null); return; }
        const err = new Error(d.message || "install failed") as Error & { ctx?: string };
        err.name = d.name || "Error";
        err.ctx = d.ctx;
        reject(err);
      }
    };
    w.postMessage({ file, id, skipAudio: !!opts.skipAudio, compressImages: !!opts.compressImages });
  });
}

async function doImport(
  file: File, profileId: string, id: string, existing: RpgGame | null,
  onProgress?: (p: ImportProgress) => void, opts?: ImportOpts,
): Promise<RpgGame> {
  onProgress?.({ phase: "reading", pct: 0 });

  const dir = await gameDir(id, true);
  const names: string[] = [];
  let bytes = 0;

  // ONE lazy path for every size of zip, built for mobile: the archive stays on
  // DISK; its central directory gives every entry's exact location, and each
  // entry is sliced off the File and streamed through the decompressor straight
  // into OPFS in small chunks. Peak memory is a few chunk buffers (~16MB)
  // whether the game is 50MB or 6GB.
  let ctx = ""; // where a failure happened — shown so errors are diagnosable
  try {
    const entries = await zipEntries(file);
    if (!entries.length) throw new Error("Couldn't read this zip — it looks empty or isn't a standard .zip archive.");
    names.push(...entries.map((e) => e.name));
    const skipRt = runtimeSkipper(names.filter((p) => !p.endsWith("/")));
    const files = entries.filter((e) => !e.name.endsWith("/") && !skipRt(e.name) && !(opts?.skipAudio && isAudioPath(e.name)));

    // the UNPACKED total is what OPFS must hold — fail clearly before writing
    const totalOut = files.reduce((s, f) => s + f.uncompSize, 0);
    try {
      const est = await navigator.storage?.estimate?.();
      if (est && est.quota != null && est.usage != null && totalOut > (est.quota - est.usage)) {
        const gb = (n: number) => (n / 1073741824).toFixed(1);
        throw new Error(`Not enough room: this game unpacks to ${gb(totalOut)} GB but only ${gb(est.quota - est.usage)} GB is free on this device.`);
      }
    } catch (e) { if (e instanceof Error && e.message.startsWith("Not enough")) throw e; }

    onProgress?.({ phase: "extracting", pct: 0 });
    // WORKER FIRST: extraction on its own thread with OPFS sync access handles
    // (no per-write swap-file copies, no contention with the console UI) — the
    // path that holds up on phones. Falls back to in-page extraction when
    // workers/sync handles aren't available.
    const viaWorker = await extractInWorker(file, id, opts ?? {}, onProgress);
    if (viaWorker) {
      bytes = viaWorker.bytes;
    } else {
      const totalComp = files.reduce((s, f) => s + f.compSize, 0) || 1;
      let readComp = 0;
      let fileNo = 0;
      for (const ent of files) {
        ctx = ` (at file ${++fileNo}/${files.length}: ${ent.name.split("/").pop()}, ${(bytes / 1048576).toFixed(0)} MB written)`;
        checkEntry(ent);
        const dataStart = await entryDataStart(file, ent);
        const { dir: parent, name } = await ensurePath(dir, ent.name);
        const w = await (await parent.getFileHandle(name, { create: true })).createWritable();
        const reader = (file.slice(dataStart, dataStart + ent.compSize).stream() as ReadableStream<Uint8Array>).getReader();
        try {
          if (ent.method === 0) {
            for (;;) { // stored: pipe as-is
              const { done, value } = await reader.read();
              if (value?.length) { await w.write(value as unknown as BufferSource); bytes += value.length; readComp += value.length; }
              if (done) break;
              onProgress?.({ phase: "extracting", pct: Math.min(99, Math.round((readComp / totalComp) * 100)) });
            }
          } else {
            // deflated: stream through fflate's raw-inflate, write as chunks emerge
            const q: Uint8Array[] = [];
            const inf = new Inflate();
            inf.ondata = (chunk) => { if (chunk?.length) q.push(chunk.slice()); }; // copy: fflate reuses buffers
            for (;;) {
              const { done, value } = await reader.read();
              if (value?.length) { inf.push(value, false); readComp += value.length; }
              if (done) inf.push(new Uint8Array(0), true);
              while (q.length) { const c = q.shift()!; await w.write(c as unknown as BufferSource); bytes += c.length; }
              if (done) break;
              onProgress?.({ phase: "extracting", pct: Math.min(99, Math.round((readComp / totalComp) * 100)) });
            }
          }
          await w.close();
        } catch (e) { try { await w.close(); } catch { /* already broken */ } throw e; }
      }
    }
  } catch (e) {
    await (await rpgmDir()).removeEntry(id, { recursive: true }).catch(() => {});
    // keep the ORIGINAL error visible — a blanket "out of memory" label hid the
    // real cause (Safari reports storage trouble as UnknownError too)
    const wctx = (e as Error & { ctx?: string })?.ctx;
    if (wctx) ctx = wctx;
    const orig = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (e instanceof Error && /quota|space|QuotaExceeded/i.test(e.name + e.message)) {
      throw new Error(`Ran out of storage while installing${ctx}. Free up space on this device and try again — details: ${orig}`);
    }
    if (e instanceof Error && /transient|out of memory|UnknownError/i.test(e.name + " " + e.message)) {
      throw new Error(`The browser couldn't finish installing${ctx} — this is usually memory or storage pressure. Close other tabs/apps or free up space and try again; a desktop browser handles very large games best. Details: ${orig}`);
    }
    if (e instanceof Error && !/Couldn't read this zip|Not enough room|password-protected/.test(e.message)) {
      throw new Error(`${e.message}${ctx}`);
    }
    throw zipReadError(e);
  }

  const paths = names.filter((p) => !p.endsWith("/"));
  let det = detect(paths);
  if (det.engine === "unknown") {
    await (await rpgmDir()).removeEntry(id, { recursive: true }).catch(() => {});
    throw new Error("Couldn't recognise a game in this zip — no index.html (web build), RPG_RT (RPG Maker 2000/2003), RGSS data (XP/VX/Ace) or Ren'Py files found. Desktop binaries (.exe) can't run in a browser; export the game for web first.");
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
  // lite install → the SW injects an AudioManager stub so the game never asks
  // for the audio we skipped (a missing BGM would otherwise crash MV/MZ)
  if (opts?.skipAudio) await writeMarker(dir, ".rpgmlite", "noaudio");

  const title = file.name.replace(/\.zip$/i, "").replace(/[._]+/g, " ").trim() || "RPG Maker Game";
  const cover = await bestCover(id, det.engine, det.root).catch(() => undefined);

  // EasyRPG needs a case-insensitive directory manifest (index.json) it fetches
  // first — generated here (EasyRPG's gencache v2 rules), rooted at det.root.
  if (engineKind(det.engine) === "easyrpg") await buildEasyRpgIndex(id, det.root, paths);

  // re-import keeps identity (title/addedAt) and refreshes the file-derived
  // fields; a fresh import records everything new.
  const game: RpgGame = existing
    ? { ...existing, engine: det.engine, entry: det.entry, root: det.root, fileCount: paths.length, bytes, cover: cover ?? existing.cover }
    : { id, profileId, title, engine: det.engine, entry: det.entry, root: det.root, addedAt: Date.now(), fileCount: paths.length, bytes, cover };
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

/** Build the EasyRPG cache from a PATH LIST (works for packed and extracted
 *  installs alike — no directory walking needed). */
function cacheFromPaths(paths: string[], root: string): Cache {
  const out: Cache = {};
  for (const p of paths) {
    if (!p.startsWith(root)) continue;
    const rel = p.slice(root.length);
    if (!rel || rel.endsWith("/") || rel === "index.json") continue;
    const parts = rel.split("/");
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const dn = parts[i];
      let sub = node[lc(dn)];
      if (!sub || typeof sub === "string") { sub = { _dirname: dn }; node[lc(dn)] = sub; }
      node = sub as Cache;
    }
    const fname = parts[parts.length - 1];
    if (parts.length === 1) node[/^exfont(\.|$)/i.test(fname) ? "exfont" : lc(fname)] = fname; // root keeps ext
    else node[lc(stripExt(fname))] = fname;
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
async function buildEasyRpgIndex(id: string, root: string, paths: string[]): Promise<void> {
  const gameCache = cacheFromPaths(paths, root);
  // merge the bundled RTP manifest so RTP-dependent games find shared assets
  let cache = gameCache;
  try {
    const res = await fetch("/rpgm/easyrpg/rtp/rtp-cache.json");
    if (res.ok) cache = mergeCache((await res.json()) as Cache, gameCache);
  } catch { /* no RTP pack — self-contained games still work */ }
  const index = { cache, metadata: { version: 2, date: new Date().toISOString().slice(0, 10) } };
  // written LOOSE beside the pack (or into the extracted tree) — the SW serves
  // loose files first, so this works for both install modes
  const { dir: parent, name } = await ensurePath(await gameDir(id), root + "index.json");
  const fh = await parent.getFileHandle(name, { create: true });
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
  } catch { /* no such dir (packed install) — search the pack below */ }
  try {
    const pack = await packOf(id);
    if (pack) {
      const b = base.normalize("NFKC").toLowerCase();
      for (const [key, ent] of pack.map) {
        if (key.startsWith(b) && !key.slice(b.length).includes("/") && /\.(png|jpe?g|webp)$/i.test(key)) {
          return await readGameFile(id, ent.name);
        }
      }
    }
  } catch { /* no cover — fine */ }
  return null;
}
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(b); });

// —— delete ————————————————————————————————————————————————————————————————————
export async function removeRpgGame(id: string): Promise<void> {
  try { await (await rpgmDir()).removeEntry(id, { recursive: true }); } catch { /* already gone */ }
  packCache.delete(id);
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
