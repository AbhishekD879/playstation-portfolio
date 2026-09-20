// Putting an imported save onto the PS2 memory card.
//
// The card is not a file. The emulator page keeps Play!'s whole data directory
// in IndexedDB as a flat map of absolute path to bytes, and restores it into
// the emulator's filesystem before a disc boots (see snapshot/restore in
// public/play-mt/index.html). One record per profile, because a profile is a
// memory card.
//
// So importing a save is a merge into that map, not a write to the emulator:
// the game is not running when somebody does this from the library, and the
// next boot picks it up. That also keeps the existing rule intact — saving
// during play stays manual, and nothing here changes when a snapshot happens.

import type { ParsedSave } from "./saveImport";

const DB = "asp-ps2";
const STORE = "cards";
/** Where Play! keeps its data inside the emulator. Must match the host page. */
const DATA = "/home/web_user/.local/share/Play Data Files";

export const cardKey = (profileId: string) => `ps2:${profileId}`;

/** Absolute path of one file of a save, as the snapshot map keys it. */
export const cardPath = (dirName: string, fileName: string) =>
  `${DATA}/vfs/mc0/${dirName}/${fileName}`;

type CardRecord = Record<string, Uint8Array>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    // Same shape the emulator page creates. Whoever gets there first wins and
    // the other simply opens it.
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function get(db: IDBDatabase, key: string): Promise<CardRecord | null> {
  return new Promise((resolve) => {
    const q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    q.onsuccess = () => resolve((q.result as CardRecord) ?? null);
    q.onerror = () => resolve(null);
  });
}

function put(db: IDBDatabase, key: string, value: CardRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface ImportResult {
  dirName: string;
  written: number;
  /** True when a save for this folder was already on the card and got replaced.
   *  Worth saying out loud: the game only ever reads one save per folder, so an
   *  import silently ends whatever progress was there. */
  replaced: boolean;
}

/**
 * Merge a parsed save into the profile's card.
 *
 * Existing files under the same folder are removed first rather than merged
 * over. A save is a set of files that agree with each other; leaving a stale
 * one behind from a previous save of a different size is how a card ends up
 * holding something the game reads as corrupt.
 */
export async function importSaveToCard(profileId: string, save: ParsedSave): Promise<ImportResult> {
  const db = await open();
  try {
    const key = cardKey(profileId);
    const existing = (await get(db, key)) ?? {};
    const prefix = `${DATA}/vfs/mc0/${save.dirName}/`;
    const replaced = Object.keys(existing).some((p) => p.startsWith(prefix));

    const next: CardRecord = {};
    for (const [path, data] of Object.entries(existing)) {
      if (!path.startsWith(prefix)) next[path] = data;
    }
    for (const f of save.files) next[cardPath(save.dirName, f.name)] = f.data;

    await put(db, key, next);
    return { dirName: save.dirName, written: save.files.length, replaced };
  } finally {
    db.close();
  }
}

/** Which save folders are already on this profile's card, for the UI to show. */
export async function cardFolders(profileId: string): Promise<string[]> {
  let db: IDBDatabase;
  try { db = await open(); } catch { return []; }
  try {
    const rec = await get(db, cardKey(profileId));
    if (!rec) return [];
    const mc = `${DATA}/vfs/mc0/`;
    const names = new Set<string>();
    for (const path of Object.keys(rec)) {
      if (!path.startsWith(mc)) continue;
      const rest = path.slice(mc.length);
      const slash = rest.indexOf("/");
      if (slash > 0) names.add(rest.slice(0, slash));
    }
    return [...names].sort();
  } finally {
    db.close();
  }
}
