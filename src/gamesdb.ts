// Per-profile game library persisted in IndexedDB — the ROM blob itself is
// stored, so a visitor's discs survive reloads. Nothing ever leaves the browser.

export interface GameRecord {
  id: string;
  profileId: string;
  name: string;
  core: string;
  size: number;
  addedAt: number;
  plays: number;
  blob: Blob;
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
