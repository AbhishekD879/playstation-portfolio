// Which PS2 engine to boot.
//
// We ship two Play! wasm builds side by side:
//
//   /play/     STOCK   — upstream, untouched. Two controllers. Everything that
//                        works today works here, byte for byte.
//   /play-mt/  FORK    — our multitap build. Up to six players.
//
// Routing happens ONCE, before the disc spins: the wasm module and its VM are
// constructed at page load, and a game latches its controller-slot count during
// init. There is no swapping engines mid-session.
//
// The stock path is the fallback for everything. If the fork is missing, fails
// to load, or the user asks for the classic experience, we boot stock — so a bad
// fork build degrades to "6-player unavailable", never "PS2 broken".
//
// See docs/ps2-multitap/SPEC.md §2.

export type Ps2Engine = "stock" | "multitap";

export const ENGINE_URL: Record<Ps2Engine, string> = {
  stock: "/play/index.html",
  multitap: "/play-mt/index.html",
};

/** Hard ceiling. Two ports × four multitap slots is 8 on real hardware; we ship 6. */
export const MAX_MULTITAP_PLAYERS = 6;
/** What the stock engine can do. Also the ceiling for a real PS2 with no tap. */
export const STOCK_PLAYERS = 2;

export interface EngineChoice {
  engine: Ps2Engine;
  players: number;
  /** Why, in words the UI can show. */
  reason: string;
}

/**
 * Pick an engine for `players`. `prefer` lets the user force the classic path
 * even for a big session (useful if the fork misbehaves on a specific game).
 */
export function chooseEngine(players: number, prefer?: Ps2Engine): EngineChoice {
  const n = Math.max(1, Math.min(MAX_MULTITAP_PLAYERS, Math.round(players) || 1));

  if (prefer === "stock") {
    return {
      engine: "stock",
      players: Math.min(n, STOCK_PLAYERS),
      reason: "classic engine selected — two controllers",
    };
  }
  if (prefer === "multitap") {
    return { engine: "multitap", players: n, reason: "multitap engine selected" };
  }
  // Implicit: only reach for the fork when the extra pads are actually needed.
  // A 1-2 player session has nothing to gain from it and everything to lose.
  return n <= STOCK_PLAYERS
    ? { engine: "stock", players: n, reason: `${n} player${n === 1 ? "" : "s"} — classic engine` }
    : { engine: "multitap", players: n, reason: `${n} players — multitap engine` };
}

/**
 * Is the fork actually deployed? A HEAD on its wasm is enough and costs nothing
 * on a warm cache. Cached for the page's lifetime.
 */
let availability: Promise<boolean> | null = null;
export function multitapAvailable(): Promise<boolean> {
  availability ??= fetch("/play-mt/Play.wasm", { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  return availability;
}

/**
 * The choice actually used, after checking the fork is present. Falls back to
 * stock — capped at two players — when it isn't.
 */
export async function resolveEngine(players: number, prefer?: Ps2Engine): Promise<EngineChoice> {
  const want = chooseEngine(players, prefer);
  if (want.engine === "stock") return want;
  if (await multitapAvailable()) return want;
  return {
    engine: "stock",
    players: STOCK_PLAYERS,
    reason: "multitap engine unavailable — falling back to two players",
  };
}

/** Multitaps needed for a player count: >2 needs one, >4 needs both. */
export function tapsFor(players: number): { port0: boolean; port1: boolean } {
  return { port0: players > 2, port1: players > 4 };
}
