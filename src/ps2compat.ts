// "Will my disc work?" — answered before anyone spends an hour ripping one.
//
// Play! publishes a per-title compatibility record (see scripts/ps2compat.mjs);
// this is the lookup side of it. Two entry points matter:
//
//   · the catalog — browse/search 2.6k titles with nothing inserted at all
//   · the disc    — read the title id off an inserted ISO and say what to expect
//
// The disc read is deliberately cheap. ISO9660 puts its primary volume descriptor
// at a fixed offset, which points at the root directory, which names SYSTEM.CNF,
// which carries the boot line. Three 2 KB reads identify any disc, whether it is
// 700 MB or 4 GB — no scanning, and it rides the same Blob.slice path the
// emulator already uses to stream the disc.
//
// Pure helpers only below the disc reader, and no relative imports beyond the
// generated table, so node can load this for the tests.
import { PS2_COMPAT, type Ps2CompatState } from "./data/ps2compat.ts";

export type { Ps2CompatState };

export interface Ps2Compat { id: string; name: string; state: Ps2CompatState }

/** How each state should read to a player, and which existing `hz-fit` pill it
 *  borrows. Deliberately reuses the shelf's own four levels rather than adding
 *  a fifth vocabulary — "runs here / may struggle / not on this device" is the
 *  language the Systems sheet already speaks. */
export const COMPAT_UI: Record<Ps2CompatState, { label: string; fit: "ready" | "caution" | "no"; blurb: string }> = {
  playable: { label: "plays", fit: "ready", blurb: "Reported fully playable start to finish" },
  ingame: { label: "plays, with bugs", fit: "caution", blurb: "Gameplay works, but with significant glitches" },
  loadable: { label: "boots only", fit: "no", blurb: "Loads and runs, but never reaches the game" },
  intro: { label: "intro only", fit: "no", blurb: "Shows an intro or menu; gameplay is unreachable" },
};

/** Title ids appear as "SLUS_211.98" on a disc and "SLUS-21198" in the tracker.
 *  Strip the punctuation and settle on the tracker's shape. */
export function normaliseTitleId(raw: string): string | null {
  const m = /([A-Za-z]{4})[-_ ]?(\d{3})[.\-_ ]?(\d{2})/.exec(raw);
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null;
}

const INDEX = new Map<string, Ps2Compat>(
  PS2_COMPAT.map(([id, name, state]) => [id, { id, name, state }]),
);

export const compatCount = () => INDEX.size;

/** Tally per state, for the sheet's header line. */
export function compatTally(): Record<Ps2CompatState, number> {
  const out = { playable: 0, ingame: 0, loadable: 0, intro: 0 };
  for (const g of INDEX.values()) out[g.state]++;
  return out;
}

/** Exact lookup by title id, in whichever spelling the caller has. */
export function lookupCompat(rawId: string): Ps2Compat | null {
  const id = normaliseTitleId(rawId);
  return id ? INDEX.get(id) ?? null : null;
}

/** Name or id search. 2.6k rows is far too many to paint at once, so the sheet
 *  asks for a slice and tells the player to keep typing — hence the cap here
 *  rather than in the component. */
export function searchCompat(query: string, limit = 60): { rows: Ps2Compat[]; total: number } {
  const q = query.trim().toLowerCase();
  const all = [...INDEX.values()];
  if (!q) return { rows: all.slice(0, limit), total: all.length };
  const hit = all.filter((g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q));
  // Prefix matches first — typing "batman" should not bury Batman Begins under
  // "Lego Batman" just because the table is alphabetical.
  hit.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return { rows: hit.slice(0, limit), total: hit.length };
}

// —— reading the title id off a disc ————————————————————————————————————————

const SECTOR = 2048;
const PVD_AT = 16 * SECTOR;        // ISO9660 fixes the primary volume descriptor here
const ROOT_REC = 156;              // the root directory record's offset inside it

const u32 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);

async function slice(file: Blob, at: number, len: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(at, at + len).arrayBuffer());
}

/** The PS2 title id from an inserted disc, or null if this isn't a PS2 ISO.
 *  Reads ~6 KB. Never throws: a disc we can't parse just means no advice. */
export async function readTitleId(file: Blob): Promise<string | null> {
  try {
    const pvd = await slice(file, PVD_AT, SECTOR);
    // "CD001" at +1 of the descriptor marks a valid ISO9660 volume
    if (String.fromCharCode(...pvd.slice(1, 6)) !== "CD001") return null;

    const rootLba = u32(pvd, ROOT_REC + 2);
    const rootLen = u32(pvd, ROOT_REC + 10);
    if (!rootLba || !rootLen || rootLen > 1 << 20) return null;

    const root = await slice(file, rootLba * SECTOR, rootLen);
    for (let off = 0; off < root.length; ) {
      const recLen = root[off];
      if (!recLen) break;
      const nameLen = root[off + 32];
      const name = String.fromCharCode(...root.slice(off + 33, off + 33 + nameLen)).toUpperCase();
      if (name.startsWith("SYSTEM.CNF")) {
        const cnf = await slice(file, u32(root, off + 2) * SECTOR, Math.min(u32(root, off + 10), 4096));
        const text = String.fromCharCode(...cnf);
        // BOOT2 = cdrom0:\SLUS_211.98;1
        const boot = /BOOT2\s*=\s*cdrom0:\\?([A-Za-z]{4}[-_]?\d{3}[.\-_]?\d{2})/i.exec(text);
        return boot ? normaliseTitleId(boot[1]) : null;
      }
      off += recLen;
    }
    return null;
  } catch {
    return null; // unreadable disc — the player still gets to boot it
  }
}

/** What we know about an inserted disc: its id, and the report if we have one. */
export async function inspectDisc(file: Blob): Promise<{ id: string | null; compat: Ps2Compat | null }> {
  const id = await readTitleId(file);
  return { id, compat: id ? INDEX.get(id) ?? null : null };
}
