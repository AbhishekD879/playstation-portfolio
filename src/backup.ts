// Whole-console backup — one .aspbackup file the player owns.
//
// statefiles.ts already carried two narrow exports: a #setup= link (settings
// only) and a save folder that reached just EmulatorJS's own databases through
// the File System Access API. Neither covered the console's OWN stores — the
// library, its saves, PS2 memory cards, photos, profiles — and the folder path
// only exists in Chromium, so Safari and Firefox had no way out at all. This
// module is the answer to both: everything, in one file, in every browser.
//
// ★ Why binary lives in zip ENTRIES and not base64 inside the manifest.
// The folder export encodes every Blob as base64 JSON. That inflates by a
// third AND builds one enormous JavaScript string, so a library with a couple
// of PS2 discs in it dies on a string-length or out-of-memory error before it
// ever reaches disk. Here the manifest keeps only a {$bin} pointer and the
// bytes are stored verbatim as their own file, so size scales the way the data
// does. Level 0: this payload is overwhelmingly already-compressed data
// (states, discs, PNGs) and deflating it again costs seconds to save nothing.
//
// Pure helpers only — no relative imports, so node can load this directly for
// the tests. Walking IndexedDB and reading Blobs is async and lives in
// statefiles.ts, which hands the results here already resolved to bytes.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const BACKUP_EXT = ".aspbackup";
export const BACKUP_VERSION = 1;
const MANIFEST = "manifest.json";
const BIN_DIR = "bin/";

/** What a backup covers. "saves" skips game files and photos — the difference
 *  between tens of megabytes and tens of gigabytes. */
export type BackupScope = "saves" | "all";

/** Left in the manifest where a Blob, ArrayBuffer or TypedArray was lifted out. */
export interface BinRef {
  $bin: string;      // path of the entry holding the bytes
  type?: string;     // Blob.type, so it round-trips as the same kind of Blob
  view?: string;     // constructor name when the value was a TypedArray
  kind: "blob" | "buffer" | "view";
}

export const isBinRef = (v: unknown): v is BinRef =>
  !!v && typeof v === "object" && typeof (v as BinRef).$bin === "string";

/** Name for the nth binary lifted out of a dump. Zero-padded so a zip
 *  listing sorts the way the manifest reads. */
export const binPath = (n: number) => `${BIN_DIR}${String(n).padStart(6, "0")}.bin`;

/** An index has to be carried explicitly. Recreating a store without its
 *  indexes looks like a successful restore and then throws NotFoundError the
 *  first time anything queries one — `listGames` reads asp-games by
 *  "profileId", so dropping these would silently empty the library. */
export interface BackupIndex {
  name: string;
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}

export interface BackupStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: BackupIndex[];
  /** k is absent for in-line keys (keyPath set or autoIncrement). */
  rows: { k?: unknown; v: unknown }[];
}

export interface BackupDb { name: string; version: number; stores: BackupStore[] }

export interface BackupManifest {
  version: number;
  at: number;
  scope: BackupScope;
  /** origin the backup came from, so an import can say where it's from */
  from?: string;
  /** every localStorage key/value we carry */
  local: Record<string, string>;
  dbs: BackupDb[];
}

export type FileMap = Record<string, Uint8Array>;

/** "412 KB" · "1.8 GB" — for telling the player what a backup will weigh
 *  BEFORE they commit to writing it. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** asbhishekstation-2026-09-06.aspbackup */
export function backupName(at = Date.now()): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `abhishekstation-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${BACKUP_EXT}`;
}

export const isBackupFile = (name: string) => name.toLowerCase().endsWith(BACKUP_EXT);

/** A browser ArrayBuffer caps out around 2 GB, and zipSync returns exactly one
 *  of them, so a backup bigger than this cannot be built in memory whatever we
 *  do. The caller offers the folder export instead of failing at the last step. */
export const MAX_IN_MEMORY = 1.5 * 1024 * 1024 * 1024;

export function packBackup(manifest: BackupManifest, files: FileMap): { name: string; bytes: Uint8Array } {
  const entries: FileMap = { ...files };
  entries[MANIFEST] = strToU8(JSON.stringify(manifest));
  return { name: backupName(manifest.at), bytes: zipSync(entries, { level: 0 }) };
}

/** The inverse. Throws on a file that isn't one of ours, so the caller can say
 *  so plainly rather than half-restoring a stranger's zip. */
export function unpackBackup(bytes: Uint8Array): { manifest: BackupManifest; files: FileMap } {
  let files: FileMap;
  try { files = unzipSync(bytes); } catch { throw new Error("not a readable backup file"); }
  const raw = files[MANIFEST];
  if (!raw) throw new Error("no manifest — not an AbhishekStation backup");
  let manifest: BackupManifest;
  try { manifest = JSON.parse(strFromU8(raw)); } catch { throw new Error("the manifest is corrupt"); }
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.dbs)) throw new Error("the manifest is corrupt");
  if (manifest.version > BACKUP_VERSION) throw new Error(`this backup is version ${manifest.version}; this console reads ${BACKUP_VERSION}`);
  manifest.local ??= {};
  return { manifest, files };
}

/** What an import is about to touch, for the confirm step: import REPLACES a
 *  database wholesale, so the player should see the count before agreeing. */
export function describeBackup(manifest: BackupManifest): { dbs: number; rows: number; keys: number; at: number; scope: BackupScope } {
  let rows = 0;
  for (const db of manifest.dbs) for (const s of db.stores) rows += s.rows.length;
  return { dbs: manifest.dbs.length, rows, keys: Object.keys(manifest.local).length, at: manifest.at, scope: manifest.scope };
}
