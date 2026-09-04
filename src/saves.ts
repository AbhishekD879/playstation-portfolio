// Progress for library games: save states (a snapshot of the running core) and
// in-game saves (the cartridge's own SRAM), kept per game in the console's
// IndexedDB. EmulatorJS 4.2.3 only ever *downloads* these — its "Keep in
// Browser" mode is one unnamed slot and it never persists SRAM at all — so the
// session hooks its events and stores the bytes here instead. Two slots per
// game: "manual" (the player asked — nothing is snapshotted behind their back)
// and "sram" (the game's own save file, so in-game saves survive EJECT).
// Pure helpers here (node-tested); putSave/getSave/savesFor live in gamesdb.ts.
//
// Saves stay in this browser. "Export saves" packs a game's slots into one
// .aspsave zip the player can carry to another device and "Import saves"
// unpacks — manual, like a memory card, no account needed.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type SaveSlot = "manual" | "sram";

export interface SaveRecord {
  key: string;        // `${gameId}:${slot}`
  gameId: string;
  profileId: string;
  slot: SaveSlot;
  data: Blob;         // the state or the save file, verbatim
  shot?: Blob;        // PNG the core rendered at that moment (states only)
  at: number;
}

export const saveKey = (gameId: string, slot: SaveSlot) => `${gameId}:${slot}`;

/** The snapshot "Continue" should load — only what the player saved on purpose. */
export const pickResume = (saves: readonly SaveRecord[]): SaveRecord | undefined =>
  saves.filter((s) => s.slot === "manual").sort((a, b) => b.at - a.at)[0];

/** "just now" · "4 min ago" · "3 h ago" · "yesterday" · "12 days ago" */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const SLOTS: readonly SaveSlot[] = ["manual", "sram"];
const EXT = ".aspsave";

export interface PackedSave { slot: SaveSlot; at: number; data: Uint8Array; shot?: Uint8Array }

/** One zip per game: <slot>.bin (+ <slot>.png) and a manifest with the timestamps. */
export function packSaves(gameName: string, saves: readonly PackedSave[]): { name: string; bytes: Uint8Array } {
  const files: Record<string, Uint8Array> = {};
  const manifest: Record<string, { at: number }> = {};
  for (const s of saves) {
    files[`${s.slot}.bin`] = s.data;
    if (s.shot) files[`${s.slot}.png`] = s.shot;
    manifest[s.slot] = { at: s.at };
  }
  files["manifest.json"] = strToU8(JSON.stringify({ game: gameName, version: 1, slots: manifest }));
  return { name: gameName.replace(/\.[^.]+$/, "") + EXT, bytes: zipSync(files, { level: 0 }) };
}

/** The inverse; unknown entries are ignored, a missing manifest dates the slots "now". */
export function unpackSaves(bytes: Uint8Array, now = Date.now()): PackedSave[] {
  const files = unzipSync(bytes);
  let slots: Record<string, { at?: number }> = {};
  try { slots = JSON.parse(strFromU8(files["manifest.json"] ?? strToU8("{}"))).slots ?? {}; } catch { slots = {}; }
  return SLOTS.filter((slot) => files[`${slot}.bin`]).map((slot) => ({
    slot, data: files[`${slot}.bin`], shot: files[`${slot}.png`], at: slots[slot]?.at ?? now,
  }));
}

export const isSaveFile = (name: string) => name.toLowerCase().endsWith(EXT);
