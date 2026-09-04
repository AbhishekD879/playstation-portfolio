// BIOS / firmware files the player supplies, kept in IndexedDB beside the game
// library. Shared across profiles — firmware belongs to the console, not to a
// user — and never uploaded anywhere.
//
// EmulatorJS takes one EJS_biosUrl. A system may need several files (Sega CD
// wants three regions), and a bare File fetched through a blob: URL loses its
// name, so every boot gets ONE zip of that system's files: EmulatorJS extracts
// archives into the emulator's root with each entry's real name.
import { zipSync } from "fflate";
import { openDb } from "./gamesdb";
import { SYSTEMS, biosStatus } from "./systems";

export const BIOS_STORE = "bios";

export interface BiosRecord {
  key: string;        // `${system}/${lowercased file name}`
  system: string;
  name: string;       // original file name
  size: number;
  addedAt: number;
  blob: Blob;
}

const key = (system: string, name: string) => `${system}/${name.toLowerCase()}`;

export async function addBios(system: string, file: File): Promise<BiosRecord> {
  const rec: BiosRecord = { key: key(system, file.name), system, name: file.name, size: file.size, addedAt: Date.now(), blob: file };
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(BIOS_STORE, "readwrite");
    tx.objectStore(BIOS_STORE).put(rec);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return rec;
}

export async function removeBios(k: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(BIOS_STORE, "readwrite");
    tx.objectStore(BIOS_STORE).delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listBios(system?: string): Promise<BiosRecord[]> {
  const db = await openDb();
  const all = await new Promise<BiosRecord[]>((res, rej) => {
    const req = db.transaction(BIOS_STORE).objectStore(BIOS_STORE).getAll();
    req.onsuccess = () => res(req.result as BiosRecord[]);
    req.onerror = () => rej(req.error);
  });
  return (system ? all.filter((r) => r.system === system) : all).sort((a, b) => a.name.localeCompare(b.name));
}

/** The files a system has on hand, and whether that is enough to boot. */
export async function biosState(system: string) {
  const sys = SYSTEMS[system];
  const files = await listBios(system);
  return { files, ...biosStatus(sys ?? { id: system, name: system, family: "consoles", engine: "ejs", thumbs: [], exts: [] }, files.map((f) => f.name)) };
}

/** One zip of everything the player has supplied for this system, or null when
 *  there is nothing to hand over. Stored (level 0) — BIOS files are small and the
 *  emulator unpacks them once. */
export async function biosZipFor(system: string): Promise<File | null> {
  const files = await listBios(system);
  if (!files.length) return null;
  // some cores look for firmware in a sub-folder of the system directory (flycast: dc/)
  const dir = SYSTEMS[system]?.bios?.dir;
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[dir ? `${dir}/${f.name}` : f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  const zipped = zipSync(entries);
  return new File([zipped], `${system}-bios.zip`, { type: "application/zip" });
}
