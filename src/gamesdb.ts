// Per-profile game library persisted in IndexedDB. Two kinds of entry:
//  · "copy" — the ROM blob itself is stored (works in every browser)
//  · "link" — only a FileSystemFileHandle is stored (Chromium's File System
//    Access API); the game streams straight from the user's disk, zero-copy.
//    IndexedDB structured-clones handles natively, so links survive reloads;
//    Chrome 122+ can persist the read permission across visits too.
// Nothing ever leaves the browser either way.

export interface GameRecord {
  id: string;
  profileId: string;
  name: string;
  core: string;          // EmulatorJS core, or "ps2" via sys
  size: number;
  addedAt: number;
  plays: number;
  blob?: Blob;                      // "copy" entries only
  kind?: "copy" | "link";           // undefined (older records) = copy
  handle?: FileSystemFileHandle;    // "link" entries only
  sys?: "ps2";                      // PlayStation 2 discs boot Play!, not EmulatorJS
  cover?: string;                   // cached box-art URL once one resolves
}

export const isLinked = (g: GameRecord) => g.kind === "link";

/** Chromium-only: real on-disk file pickers + storable handles. */
export const fsAccessSupported = () => "showOpenFilePicker" in window;

// PS2 disc extensions (bin deliberately stays Mega Drive — ambiguous ext)
export const PS2_EXTS = ["iso", "cso", "chd", "isz"];

/** Resolve a record to a playable File/Blob. Throws Error with .cause set to
 *  "permission" (user must grant disk access — needs a user gesture) or
 *  "missing" (file moved/deleted — re-link it). */
export async function resolveGameFile(g: GameRecord, opts?: { request?: boolean }): Promise<Blob> {
  if (!isLinked(g)) {
    if (g.blob) return g.blob;
    throw Object.assign(new Error("no data"), { cause: "missing" });
  }
  const h = g.handle!;
  try {
    let perm = (await (h as any).queryPermission?.({ mode: "read" })) ?? "granted";
    if (perm !== "granted" && opts?.request !== false) {
      perm = (await (h as any).requestPermission?.({ mode: "read" })) ?? "granted";
    }
    if (perm !== "granted") throw Object.assign(new Error("permission"), { cause: "permission" });
    return await h.getFile();
  } catch (e: any) {
    if (e?.cause === "permission") throw e;
    if (e?.name === "NotAllowedError" || e?.name === "SecurityError")
      throw Object.assign(new Error("permission"), { cause: "permission" });
    throw Object.assign(new Error("missing"), { cause: "missing" });
  }
}

// —— box art: libretro-thumbnails (keyless, CORS *) ——————————————————————
const THUMB_REPO: Record<string, string> = {
  ps2: "Sony_-_PlayStation_2",
  gba: "Nintendo_-_Game_Boy_Advance",
  gb: "Nintendo_-_Game_Boy",
  nes: "Nintendo_-_Nintendo_Entertainment_System",
  snes: "Nintendo_-_Super_Nintendo_Entertainment_System",
  segaMD: "Sega_-_Mega_Drive_-_Genesis",
  n64: "Nintendo_-_Nintendo_64",
  nds: "Nintendo_-_Nintendo_DS",
};

/** Best-effort box-art URLs, most-specific first. Try each until one loads. */
export function coverCandidates(g: GameRecord): string[] {
  const repo = THUMB_REPO[g.sys ?? g.core];
  if (!repo) return [];
  const base = `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/`;
  const stem = g.name.replace(/\.[^.]+$/, "").trim();
  const clean = stem.replace(/\s*[([].*$/, "").trim(); // drop "(USA) (Rev 1)…" tails
  const names = [...new Set([stem, `${clean} (USA)`, `${clean} (Europe)`, `${clean} (Japan)`, clean])];
  // thumbnails replace &*/:`<>?\|" with _
  return names.map((n) => base + encodeURIComponent(n.replace(/[&*/:`<>?\\|"]/g, "_")) + ".png");
}

const DB = "asp-games";
const STORE = "roms";
const PHOTOS = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("profileId", "profileId");
      }
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: "id" }).createIndex("profileId", "profileId");
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

// —— photo gallery (blobs live in IndexedDB, never uploaded) ——
export interface PhotoRecord {
  id: string;
  profileId: string;
  name: string;
  addedAt: number;
  blob: Blob;
}

export async function addPhoto(rec: PhotoRecord): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(PHOTOS, "readwrite");
    tx.objectStore(PHOTOS).put(rec);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listPhotos(profileId: string): Promise<PhotoRecord[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(PHOTOS).objectStore(PHOTOS).index("profileId").getAll(profileId);
    req.onsuccess = () => res((req.result as PhotoRecord[]).sort((a, b) => a.addedAt - b.addedAt));
    req.onerror = () => rej(req.error);
  });
}

export async function addGame(rec: GameRecord): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listGames(profileId: string): Promise<GameRecord[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).index("profileId").getAll(profileId);
    req.onsuccess = () => res((req.result as GameRecord[]).sort((a, b) => b.addedAt - a.addedAt));
    req.onerror = () => rej(req.error);
  });
}

export async function getGame(id: string): Promise<GameRecord | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function bumpPlays(id: string): Promise<void> {
  const g = await getGame(id);
  if (g) { g.plays = (g.plays ?? 0) + 1; await addGame(g); }
}

/** Remember the first box-art URL that actually loaded. */
export async function saveCover(id: string, url: string): Promise<void> {
  const g = await getGame(id);
  if (g && g.cover !== url) { g.cover = url; await addGame(g); }
}

/** Swap a linked record's handle (re-link after the file moved). */
export async function relinkGame(id: string, handle: FileSystemFileHandle, size: number): Promise<void> {
  const g = await getGame(id);
  if (g) { g.handle = handle; g.kind = "link"; g.size = size; await addGame(g); }
}

export async function removeGame(id: string): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export const CORES: Record<string, string> = {
  gba: "gba", gb: "gb", gbc: "gb",
  nes: "nes", fds: "nes",
  sfc: "snes", smc: "snes",
  md: "segaMD", gen: "segaMD", bin: "segaMD",
  n64: "n64", z64: "n64", v64: "n64",
  nds: "nds",
};

export const CORE_NAMES: Record<string, string> = {
  gba: "Game Boy Advance", gb: "Game Boy / Color", nes: "NES",
  snes: "Super Nintendo", segaMD: "Mega Drive", n64: "Nintendo 64", nds: "Nintendo DS",
};
