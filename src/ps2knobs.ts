// Per-game emulator settings, so one global switch stops breaking games.
//
// Why this exists. The PS2 shelf has three global levers — engine, EE clock and
// internal resolution — and their safe values are per-game, not per-console.
// Urban Reign proved it the hard way: it plays perfectly at full clock and
// shows a black screen at half or third, with no error anywhere. One setting
// chosen for a heavy game silently broke a game that had been working.
//
// Play! solves the same problem upstream with GameConfig.xml: a hand-found
// address or flag per executable, applied automatically at boot. Their file has
// 47 entries, and that data — not code — is the largest category of their
// compatibility work. This is the same idea at our layer, plus a passthrough
// for their knobs so that the day we have an address for a game, it is a data
// change rather than a build.
//
// Overrides are keyed by title id (SLUS-21198), which we read off the disc.
// Pure: no relative imports, so node can load it for the tests.

export type Ps2Engine = "advanced" | "native";
export type Ps2Clock = "full" | "half" | "third";
export type Ps2Res = 1 | 2 | 3;

/** Play!'s own GameConfig knobs. Every one needs a specific address or block
 *  key found by watching the emulated CPU — none can be swept blindly, which
 *  is why this is a passthrough rather than something we generate. */
export interface Ps2GameKnobs {
  /** Skip a spin loop the game never leaves. Address is EE-relative hex. */
  idleLoop?: { address: string; checkBlockKey?: string }[];
  /** Force a rounding mode for one block of code. */
  fpRounding?: { address: string; mode: "NEAREST" | "PLUSINFINITY" | "MINUSINFINITY" | "TRUNCATE" }[];
  /** Use the slower, exact add/subtract for one block. */
  fpAccurateAddSub?: string[];
  /** Stop clamping vector results in one VU1 block. */
  vu1NoClamping?: string[];
  /** Write a word straight into EE RAM before the game runs. */
  patch?: { address: string; value: string }[];
}

export interface Ps2Override {
  /** Human note explaining WHY, so a future reader can undo it safely. */
  why?: string;
  engine?: Ps2Engine;
  clock?: Ps2Clock;
  res?: Ps2Res;
  players?: number;
  knobs?: Ps2GameKnobs;
}

/** Overrides we have verified ourselves, shipped so the first boot is right
 *  even before the remote table loads. Keep this list short and evidenced —
 *  every entry should name what was observed. */
export const PS2_OVERRIDES: Readonly<Record<string, Ps2Override>> = {
  "SLUS-21209": {
    why: "Verified 2026-09-09: plays at full clock, black screen at half or third with no error logged.",
    clock: "full",
  },
};

const CLEAN_ID = /^[A-Z]{4}-\d{5}$/;
const HEX = /^[0-9a-fA-F]{1,8}$/;
const BLOCK_KEY = /^[0-9a-fA-F]{8}[0-9a-fA-F]{8}[0-9a-fA-F]{8}[0-9a-fA-F]{8};\d+$/;

/** Merge a remote table over the shipped one. Remote wins per title, so a fix
 *  can ship without a deploy, but a malformed row can never poison the table. */
export function mergeOverrides(
  base: Readonly<Record<string, Ps2Override>>,
  remote: unknown,
): Record<string, Ps2Override> {
  const out: Record<string, Ps2Override> = { ...base };
  if (!remote || typeof remote !== "object") return out;
  for (const [id, val] of Object.entries(remote as Record<string, unknown>)) {
    if (!CLEAN_ID.test(id)) continue;
    const ok = sanitiseOverride(val);
    if (ok) out[id] = ok;
  }
  return out;
}

/** Everything here arrives from a KV blob an admin edited, so validate rather
 *  than trust: a bad clock value would silently disable the emulator. */
export function sanitiseOverride(val: unknown): Ps2Override | null {
  if (!val || typeof val !== "object") return null;
  const v = val as Record<string, unknown>;
  const out: Ps2Override = {};
  if (typeof v.why === "string") out.why = v.why.slice(0, 300);
  if (v.engine === "advanced" || v.engine === "native") out.engine = v.engine;
  if (v.clock === "full" || v.clock === "half" || v.clock === "third") out.clock = v.clock;
  if (v.res === 1 || v.res === 2 || v.res === 3) out.res = v.res;
  if (typeof v.players === "number" && v.players >= 1 && v.players <= 6) out.players = Math.floor(v.players);

  const k = v.knobs as Record<string, unknown> | undefined;
  if (k && typeof k === "object") {
    const knobs: Ps2GameKnobs = {};
    const hexList = (x: unknown) =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && HEX.test(s)) : [];

    if (Array.isArray(k.idleLoop)) {
      const rows = k.idleLoop
        .filter((r): r is { address: string; checkBlockKey?: string } =>
          !!r && typeof r === "object" && HEX.test(String((r as any).address)))
        .map((r) => {
          const key = (r as any).checkBlockKey;
          return typeof key === "string" && BLOCK_KEY.test(key)
            ? { address: String(r.address), checkBlockKey: key }
            : { address: String(r.address) };
        });
      if (rows.length) knobs.idleLoop = rows;
    }
    if (Array.isArray(k.fpRounding)) {
      const modes = ["NEAREST", "PLUSINFINITY", "MINUSINFINITY", "TRUNCATE"];
      const rows = k.fpRounding.filter((r: any) =>
        r && HEX.test(String(r.address)) && modes.includes(r.mode));
      if (rows.length) knobs.fpRounding = rows;
    }
    const acc = hexList(k.fpAccurateAddSub);
    if (acc.length) knobs.fpAccurateAddSub = acc;
    if (Array.isArray(k.vu1NoClamping)) {
      const rows = k.vu1NoClamping.filter((s: unknown): s is string => typeof s === "string" && BLOCK_KEY.test(s));
      if (rows.length) knobs.vu1NoClamping = rows;
    }
    if (Array.isArray(k.patch)) {
      const rows = k.patch.filter((r: any) => r && HEX.test(String(r.address)) && HEX.test(String(r.value)));
      if (rows.length) knobs.patch = rows;
    }
    if (Object.keys(knobs).length) out.knobs = knobs;
  }
  return Object.keys(out).length ? out : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Build the GameConfig.xml Play! reads at boot.
 *
 *  Observed, not assumed: the emscripten build's resource path resolves to
 *  /usr/local/share, and Play! opens /usr/local/share/GameConfig.xml on every
 *  boot whether or not it exists. The `Executable` attribute is matched against
 *  the boot ELF name — the disc's own spelling, SLUS_211.98, not the tracker's
 *  SLUS-21198 — so it is passed in separately rather than derived. */
export function buildGameConfigXml(executable: string, knobs: Ps2GameKnobs | undefined): string | null {
  if (!knobs || !Object.keys(knobs).length) return null;
  const rows: string[] = [];
  for (const p of knobs.patch ?? []) rows.push(`      <Patch Address="${esc(p.address)}" Value="${esc(p.value)}" />`);
  for (const r of knobs.fpRounding ?? []) rows.push(`      <BlockFpRoundingMode Address="${esc(r.address)}" Mode="${r.mode}" />`);
  for (const a of knobs.fpAccurateAddSub ?? []) rows.push(`      <BlockFpUseAccurateAddSub Address="${esc(a)}" />`);
  for (const l of knobs.idleLoop ?? []) {
    rows.push(l.checkBlockKey
      ? `      <IdleLoopBlock Address="${esc(l.address)}" CheckBlockKey="${esc(l.checkBlockKey)}" />`
      : `      <IdleLoopBlock Address="${esc(l.address)}" />`);
  }
  for (const b of knobs.vu1NoClamping ?? []) rows.push(`      <Vu1BlockNoClamping BlockKey="${esc(b)}" />`);
  if (!rows.length) return null;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<GameConfigs>",
    `  <GameConfig Executable="${esc(executable)}">`,
    ...rows,
    "  </GameConfig>",
    "</GameConfigs>",
    "",
  ].join("\n");
}

/** Title id (SLUS-21198) → boot ELF name (SLUS_211.98), which is what
 *  GameConfig matches on. */
export function elfNameFor(titleId: string): string | null {
  const m = /^([A-Z]{4})-(\d{3})(\d{2})$/.exec(titleId);
  return m ? `${m[1]}_${m[2]}.${m[3]}` : null;
}

export const clockDen = (c: Ps2Clock) => (c === "half" ? 2 : c === "third" ? 3 : 1);

// —— the live table ————————————————————————————————————————————————————————
//
// Shipped defaults answer immediately and work offline; the KV table on top
// means the next game we work out is an edit, not a deploy. Fetched once per
// session, best-effort: if it fails we simply run on what we shipped.

let table: Record<string, Ps2Override> = { ...PS2_OVERRIDES };
let loading: Promise<void> | null = null;

/** Kick the remote fetch. Safe to call repeatedly; only the first does work. */
export function loadOverrides(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch("/api/ps2cfg", { cache: "no-cache" });
      if (!r.ok) return;
      table = mergeOverrides(PS2_OVERRIDES, await r.json());
    } catch {
      /* offline, or the endpoint is not deployed yet — shipped defaults stand */
    }
  })();
  return loading;
}

/** What we know about this title, or null. Synchronous by design: it is called
 *  on the boot path, where waiting on a network round trip would delay a game
 *  for a setting we probably already have. */
export function overridesFor(titleId: string): Ps2Override | null {
  return table[titleId] ?? null;
}
