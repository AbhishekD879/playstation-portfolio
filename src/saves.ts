// Progress for library games: save states (a snapshot of the running core) and
// in-game saves (the cartridge's own SRAM), kept per game in the console's
// IndexedDB. EmulatorJS 4.2.3 only ever *downloads* these — its "Keep in
// Browser" mode is one unnamed slot and it never persists SRAM at all — so the
// session hooks its events and stores the bytes here instead. Two slots per
// game: "manual" (the player asked — nothing is snapshotted behind their back)
// and "sram" (the game's own save file, so in-game saves survive EJECT).
// Pure helpers here (node-tested); putSave/getSave/savesFor live in gamesdb.ts.

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
