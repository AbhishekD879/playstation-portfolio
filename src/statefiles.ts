// Portable console state — three flavors, narrowest first:
//  · Setup link  — the console's SETTINGS (theme, Labs flags, icons, fonts,
//                  language…) gzipped via Compression Streams into a #setup=
//                  hash you can paste anywhere. No personal data: prefs only.
//  · Save folder — EmulatorJS's own save databases written to a picked
//                  directory via the File System Access API. Chromium only.
//  · Backup      — EVERYTHING, as one .aspbackup file, in any browser: the
//                  library and its saves, PS2 memory cards, BIOS dumps the
//                  player supplied, photos, profiles, trophies, every setting.
//                  See the backup section at the foot of this file.
//
// The first two are deliberately partial, and that was the whole problem: the
// data lives only in this browser, so a player with no way to take all of it
// out doesn't really own it. The backup answers that — it is the export the
// other two aren't, and it is the one that works on a phone.

import {
  MAX_IN_MEMORY, binPath, describeBackup, humanSize, isBinRef,
  packBackup, unpackBackup,
  type BackupDb, type BackupManifest, type BackupScope, type BackupStore, type FileMap,
} from "./backup";

// the same allow-list tab-sync mirrors — settings state, nothing else
const SETUP_KEYS = [
  "asp.theme", "asp.bg", "asp.labs.off", "asp.icons", "asp.font", "asp.track",
  "asp.uisize", "asp.lang", "asp.vol", "asp.muted", "asp.snd", "asp.saver", "asp.clock24",
];

const b64 = {
  enc: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)),
};

async function gzip(text: string): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  return new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip");
  return new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds)).text();
}

function setupJson(): string {
  const out: Record<string, string> = {};
  for (const k of SETUP_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  return JSON.stringify(out);
}

/** The current settings as a shareable URL (…#setup=…), copied by the caller. */
export async function makeSetupLink(): Promise<string> {
  const packed = b64.enc(await gzip(setupJson()));
  return `${location.origin}${location.pathname}#setup=${packed}`;
}

/** Parse a #setup= hash → the settings it carries (null if absent/corrupt). */
export async function readSetupHash(): Promise<Record<string, string> | null> {
  const m = location.hash.match(/#setup=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try { return JSON.parse(await gunzip(b64.dec(m[1]))); } catch { return null; }
}

/** Apply an imported setup and restart the console so everything re-reads it. */
export function applySetup(setup: Record<string, string>) {
  for (const [k, v] of Object.entries(setup)) {
    if (SETUP_KEYS.includes(k)) localStorage.setItem(k, v); // allow-list only
  }
  history.replaceState(null, "", location.pathname);
  sessionStorage.setItem("asp.resume", localStorage.getItem("asp.lastProfile") ?? "");
  location.reload();
}

// —— save-data folder export/import ————————————————————————————————————————

export const canUseFolders = () => "showDirectoryPicker" in window;

/** Emulator save databases — everything EmulatorJS persists except its core
 *  caches (those re-download for free and can be hundreds of MB). */
async function saveDbNames(): Promise<string[]> {
  const dbs = await (indexedDB.databases?.() ?? Promise.resolve([]));
  return dbs
    .map((d) => d.name ?? "")
    .filter((n) => /emulatorjs/i.test(n) && !/core|bios/i.test(n));
}

type DumpedStore = BackupStore;
type DumpedDb = BackupDb;

const toPortable = async (v: unknown): Promise<unknown> => {
  if (v instanceof Blob) return { $blob: b64.enc(await v.arrayBuffer()), type: v.type };
  if (v instanceof ArrayBuffer) return { $buf: b64.enc(v) };
  if (ArrayBuffer.isView(v)) return { $buf: b64.enc((v as Uint8Array).slice().buffer), view: v.constructor.name };
  return v;
};
const fromPortable = (v: any): unknown => {
  if (v && typeof v === "object") {
    if (typeof v.$blob === "string") return new Blob([b64.dec(v.$blob) as BlobPart], { type: v.type ?? "" });
    if (typeof v.$buf === "string") {
      const bytes = b64.dec(v.$buf);
      return v.view === "Uint8Array" ? bytes : bytes.buffer;
    }
  }
  return v;
};

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/** Walk one database's rows. `xf` decides what happens to each value: the
 *  folder export inlines binaries as base64, a backup lifts them into their own
 *  zip entries. `skip` drops stores the caller doesn't want to carry. */
async function dumpDb(
  name: string,
  xf: (v: unknown) => Promise<unknown> = toPortable,
  skip: readonly string[] = [],
): Promise<DumpedDb> {
  const db = await openDb(name);
  try {
    const stores: DumpedStore[] = [];
    for (const storeName of [...db.objectStoreNames]) {
      if (skip.includes(storeName)) continue;
      const tx = db.transaction(storeName);
      const os = tx.objectStore(storeName);
      const rows = await new Promise<{ k: unknown; v: unknown }[]>((res, rej) => {
        const out: { k: unknown; v: unknown }[] = [];
        const cur = os.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { res(out); return; }
          out.push({ k: c.key, v: c.value });
          c.continue();
        };
        cur.onerror = () => rej(cur.error);
      });
      stores.push({
        name: storeName,
        keyPath: os.keyPath as any,
        autoIncrement: os.autoIncrement,
        indexes: [...os.indexNames].map((iName) => {
          const ix = os.index(iName);
          return { name: iName, keyPath: ix.keyPath as string | string[], unique: ix.unique, multiEntry: ix.multiEntry };
        }),
        rows: await Promise.all(rows.map(async (r) => ({ k: r.k, v: await xf(r.v) }))),
      });
    }
    return { name, version: db.version, stores };
  } finally { db.close(); }
}

async function restoreDb(dump: DumpedDb, xf: (v: unknown) => unknown = fromPortable): Promise<void> {
  await new Promise<void>((res) => { const d = indexedDB.deleteDatabase(dump.name); d.onsuccess = d.onerror = d.onblocked = () => res(); });
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(dump.name, dump.version);
    req.onupgradeneeded = () => {
      for (const s of dump.stores) {
        const os = req.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
        // indexes must be rebuilt here or every index() query throws later
        for (const ix of s.indexes ?? []) os.createIndex(ix.name, ix.keyPath, { unique: ix.unique, multiEntry: ix.multiEntry });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  try {
    for (const s of dump.stores) {
      const tx = db.transaction(s.name, "readwrite");
      const os = tx.objectStore(s.name);
      for (const r of s.rows) {
        const v = xf(r.v);
        if (os.keyPath != null || s.autoIncrement) os.put(v as any);
        else os.put(v as any, r.k as IDBValidKey);
      }
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    }
  } finally { db.close(); }
}

/** Write emulator saves + a setup snapshot into a picked folder.
 *  Returns a human summary line. */
export async function exportSavesToFolder(): Promise<string> {
  const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ mode: "readwrite", id: "asp-saves" });
  const write = async (name: string, text: string) => {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  };
  const names = await saveDbNames();
  for (const n of names) write(`${n}.asdb.json`, JSON.stringify(await dumpDb(n)));
  await write("console-setup.json", setupJson());
  return `${names.length} save database${names.length === 1 ? "" : "s"} + settings written`;
}

/** Read *.asdb.json (+ console-setup.json) back from a picked folder. */
export async function importSavesFromFolder(): Promise<string> {
  const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: "asp-saves" });
  let dbs = 0, gotSetup = false;
  for await (const entry of (dir as any).values()) {
    if (entry.kind !== "file") continue;
    if (entry.name.endsWith(".asdb.json")) {
      const text = await (await entry.getFile()).text();
      await restoreDb(JSON.parse(text));
      dbs++;
    } else if (entry.name === "console-setup.json") {
      const setup = JSON.parse(await (await entry.getFile()).text());
      for (const [k, v] of Object.entries(setup)) if (SETUP_KEYS.includes(k)) localStorage.setItem(k, v as string);
      gotSetup = true;
    }
  }
  return `${dbs} save database${dbs === 1 ? "" : "s"}${gotSetup ? " + settings" : ""} restored`;
}

// —— whole-console backup ——————————————————————————————————————————————————
// One file, every browser. The folder export above needs showDirectoryPicker
// (Chromium only) and only ever reached EmulatorJS's own stores, so Safari and
// Firefox had no way to move their data and the console's own library, saves,
// PS2 cards, profiles and photos were never covered at all.

/** Our own databases. Enumeration finds these too where it works, but Firefox
 *  only shipped indexedDB.databases() recently and it can be absent, so this is
 *  the floor rather than the source of truth. */
const OWN_DBS = ["asp-games", "asp-ps2", "asp-rpgm", "asp-j2me", "asp-chat"];

/** Worth carrying: ours, per-game RPG Maker stores, and EmulatorJS saves —
 *  never its core or BIOS caches, which are hundreds of megabytes and
 *  re-download for free. */
const keepDb = (n: string) =>
  /^asp-/.test(n) || /^rpgm-/.test(n) || (/emulatorjs/i.test(n) && !/core|bios/i.test(n));

/** Stores holding content the player imported rather than progress they made.
 *  Skipped by the "saves" scope — this is the difference between a file you can
 *  email yourself and one the size of your disc collection. */
const BULK: Record<string, string[]> = {
  "asp-games": ["roms", "photos"],
  "asp-rpgm": ["games"],
};

async function backupDbNames(): Promise<string[]> {
  let found: string[] = [];
  try {
    found = (await (indexedDB.databases?.() ?? Promise.resolve([]))).map((d) => d.name ?? "").filter(Boolean);
  } catch { /* enumeration unsupported — fall back to OWN_DBS */ }
  return [...new Set([...OWN_DBS, ...found.filter(keepDb)])];
}

/** Every key this origin holds, not the 13-key settings allow-list. A backup
 *  that dropped asp.profiles.v1 would restore a console with no profiles. */
function localAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const v = localStorage.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

const isBlob = (v: unknown): v is Blob => typeof Blob !== "undefined" && v instanceof Blob;

/** Replace every binary in a row with a {$bin} pointer, collecting the bytes
 *  into `files` so they become their own zip entries. Recurses through arrays
 *  and plain objects; anything else is left as-is for JSON to handle. */
async function lift(v: unknown, files: FileMap, next: () => string): Promise<unknown> {
  if (isBlob(v)) {
    const path = next();
    files[path] = new Uint8Array(await v.arrayBuffer());
    return { $bin: path, kind: "blob", type: v.type };
  }
  if (v instanceof ArrayBuffer) {
    const path = next();
    files[path] = new Uint8Array(v.slice(0));
    return { $bin: path, kind: "buffer" };
  }
  if (ArrayBuffer.isView(v)) {
    const path = next();
    files[path] = new Uint8Array((v as Uint8Array).slice().buffer);
    return { $bin: path, kind: "view", view: v.constructor.name };
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => lift(x, files, next)));
  if (v && typeof v === "object" && (v as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = await lift(x, files, next);
    return out;
  }
  return v;
}

/** The inverse of lift. A pointer whose bytes are missing becomes null rather
 *  than throwing, so one truncated entry can't abort a whole restore. */
function drop(v: unknown, files: FileMap): unknown {
  if (isBinRef(v)) {
    const bytes = files[v.$bin];
    if (!bytes) return null;
    if (v.kind === "blob") return new Blob([bytes as BlobPart], { type: v.type ?? "" });
    if (v.kind === "view" && v.view && v.view !== "Uint8Array") {
      const Ctor = (globalThis as any)[v.view];
      if (typeof Ctor === "function") return new Ctor(bytes.buffer, bytes.byteOffset, bytes.byteLength / (Ctor.BYTES_PER_ELEMENT ?? 1));
    }
    if (v.kind === "buffer") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return bytes;
  }
  if (Array.isArray(v)) return v.map((x) => drop(x, files));
  if (v && typeof v === "object" && (v as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = drop(x, files);
    return out;
  }
  return v;
}

/** Opening a database that doesn't exist CREATES it, so a name from OWN_DBS
 *  that the player never used would leave an empty database behind and appear
 *  in the backup as a real store. Anything that comes back with no stores was
 *  conjured by our own open call — delete it and skip. */
async function dumpIfReal(name: string, xf: (v: unknown) => Promise<unknown>, skip: readonly string[]): Promise<BackupDb | null> {
  const dump = await dumpDb(name, xf, skip);
  if (!dump.stores.length) {
    const all = await dumpDb(name, xf, []);
    if (!all.stores.length) {
      await new Promise<void>((res) => { const d = indexedDB.deleteDatabase(name); d.onsuccess = d.onerror = d.onblocked = () => res(); });
      return null;
    }
  }
  return dump;
}

/** What each scope would weigh, without building either — Blob.size is free to
 *  read, so the player sees both numbers before committing to one. Deliberately
 *  ONE walk: measuring the two scopes separately would read every store twice. */
export async function backupSize(): Promise<{ saves: number; all: number; games: number; savesLabel: string; allLabel: string }> {
  let saves = 0;
  let bulk = 0;
  let games = 0;
  let into = (n: number) => { saves += n; };
  const measure = (v: unknown): void => {
    if (isBlob(v)) { into(v.size); return; }
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) { into(v.byteLength); return; }
    if (Array.isArray(v)) { v.forEach(measure); return; }
    if (v && typeof v === "object" && (v as object).constructor === Object) {
      for (const x of Object.values(v)) measure(x);
      into(64); // rough per-row JSON overhead, so a tiny store doesn't read as 0 B
    }
  };
  for (const name of await backupDbNames()) {
    const heavy = BULK[name] ?? [];
    // measure the light stores, then the heavy ones, tagging each into its bucket
    into = (n) => { saves += n; };
    const light = await dumpIfReal(name, async (v) => { measure(v); return null; }, heavy);
    if (!light) continue;
    if (heavy.length) {
      into = (n) => { bulk += n; };
      const all = await dumpDb(name, async (v) => { measure(v); return null; }, [...light.stores.map((s) => s.name)]);
      for (const s of all.stores) if (s.name === "roms") games += s.rows.length;
    }
  }
  for (const [k, v] of Object.entries(localAll())) saves += k.length + v.length;
  return { saves, all: saves + bulk, games, savesLabel: humanSize(saves), allLabel: humanSize(saves + bulk) };
}

/** Build the backup. Returns the blob and its name; the caller downloads it. */
export async function buildBackup(scope: BackupScope = "saves"): Promise<{ name: string; blob: Blob; bytes: number }> {
  const files: FileMap = {};
  let n = 0;
  const next = () => binPath(n++);
  const dbs: BackupDb[] = [];
  for (const name of await backupDbNames()) {
    const skip = scope === "all" ? [] : (BULK[name] ?? []);
    const dump = await dumpIfReal(name, (v) => lift(v, files, next), skip);
    if (dump) dbs.push(dump);
  }
  const manifest: BackupManifest = {
    version: 1, at: Date.now(), scope, from: location.origin, local: localAll(), dbs,
  };
  const payload = Object.values(files).reduce((a, b) => a + b.length, 0);
  if (payload > MAX_IN_MEMORY) {
    throw new Error(`this backup would be ${humanSize(payload)} — past what a browser can hold in one file. Back up saves only, or use the folder export.`);
  }
  const { name, bytes } = packBackup(manifest, files);
  return { name, blob: new Blob([bytes.slice() as BlobPart], { type: "application/zip" }), bytes: bytes.length };
}

/** Download a backup of this console. Works in every browser — no picker, no
 *  permission prompt, just a file in Downloads. */
export async function exportBackup(scope: BackupScope = "saves"): Promise<string> {
  const { name, blob, bytes } = await buildBackup(scope);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000); // Safari reads the blob lazily
  }
  return `${name} — ${humanSize(bytes)} saved to your downloads`;
}

/** Read a backup back. REPLACES each database it carries, so the caller must
 *  confirm first — see inspectBackup. Reloads afterwards so every module
 *  re-reads its store. */
export async function importBackup(file: Blob, opts?: { reload?: boolean }): Promise<string> {
  const { manifest, files } = unpackBackup(new Uint8Array(await file.arrayBuffer()));
  for (const db of manifest.dbs) await restoreDb(db, (v) => drop(v, files));
  for (const [k, v] of Object.entries(manifest.local)) {
    try { localStorage.setItem(k, v); } catch { /* quota — keep going, the databases matter more */ }
  }
  const d = describeBackup(manifest);
  if (opts?.reload !== false) {
    sessionStorage.setItem("asp.resume", localStorage.getItem("asp.lastProfile") ?? "");
    setTimeout(() => location.reload(), 900); // let the message land first
  }
  return `restored ${d.rows} row${d.rows === 1 ? "" : "s"} across ${d.dbs} database${d.dbs === 1 ? "" : "s"} + ${d.keys} setting${d.keys === 1 ? "" : "s"}`;
}

/** What a file holds, WITHOUT applying it — for the confirm step. */
export async function inspectBackup(file: Blob): Promise<string> {
  const { manifest } = unpackBackup(new Uint8Array(await file.arrayBuffer()));
  const d = describeBackup(manifest);
  const when = new Date(d.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${d.scope === "all" ? "full console" : "saves & settings"} from ${when} — ${d.rows} rows, ${d.dbs} databases, ${d.keys} settings`;
}
