// Portable console state — two flavors, both deliberately narrow:
//  · Setup link  — the console's SETTINGS (theme, Labs flags, icons, fonts,
//                  language…) gzipped via Compression Streams into a #setup=
//                  hash you can paste anywhere. No personal data: prefs only.
//  · Save folder — EMULATOR SAVE DATA (EmulatorJS's IndexedDB, minus its
//                  re-downloadable core caches) plus a setup snapshot written
//                  to a user-picked directory via the File System Access API,
//                  and read back on another machine.
// Photos, videos and the game library itself are NEVER touched: media stays
// on this device, full stop.

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

interface DumpedStore { name: string; keyPath: string | string[] | null; autoIncrement: boolean; rows: { k: unknown; v: unknown }[] }
interface DumpedDb { name: string; version: number; stores: DumpedStore[] }

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

async function dumpDb(name: string): Promise<DumpedDb> {
  const db = await openDb(name);
  try {
    const stores: DumpedStore[] = [];
    for (const storeName of [...db.objectStoreNames]) {
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
        rows: await Promise.all(rows.map(async (r) => ({ k: r.k, v: await toPortable(r.v) }))),
      });
    }
    return { name, version: db.version, stores };
  } finally { db.close(); }
}

async function restoreDb(dump: DumpedDb): Promise<void> {
  await new Promise<void>((res) => { const d = indexedDB.deleteDatabase(dump.name); d.onsuccess = d.onerror = d.onblocked = () => res(); });
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(dump.name, dump.version);
    req.onupgradeneeded = () => {
      for (const s of dump.stores) {
        req.result.createObjectStore(s.name, { keyPath: s.keyPath ?? undefined, autoIncrement: s.autoIncrement });
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
        const v = fromPortable(r.v);
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
