// When to retry a dropped multiplayer session, and how long to wait.
//
// Split out and pure because reconnection is the part nobody tests by hand: you
// would have to physically drop wifi mid-match to see it, so the rules go here
// where they can be asserted instead.

/** Terminal states a session can report. */
export type Health = "connected" | "connecting" | "dropped" | "gone" | "closed";

/**
 * Classify a raw status string from the peer/signaling layer.
 *
 * "closed" means WE stopped — never retry that, or a user who quits gets
 * dragged back into the room they just left.
 */
export function classify(status: string): Health {
  const s = status.toLowerCase();
  if (s === "closed" || s.includes("cancel")) return "closed";
  if (s.includes("host left")) return "gone";
  if (s.includes("fail") || s.includes("disconnect") || s.includes("signaling closed")) return "dropped";
  if (s === "connected" || s.includes("complete")) return "connected";
  return "connecting";
}

export const shouldRetry = (h: Health) => h === "dropped" || h === "gone";

/**
 * Backoff in ms for attempt n (1-based): 0.5s, 1s, 2s, 4s, then 8s forever.
 *
 * Capped rather than unbounded, and never gives up: a host reloading their tab
 * or a phone changing network should heal on its own. Someone who genuinely
 * wants out presses Leave, which reports "closed" and stops this dead.
 */
export function backoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(8000, 500 * 2 ** (n - 1));
}

/** Human status for the reconnect banner. */
export function retryLabel(h: Health, attempt: number): string {
  if (h === "gone") return attempt === 1 ? "Host disconnected — waiting for them to come back…" : `Waiting for the host… (try ${attempt})`;
  return attempt === 1 ? "Connection lost — reconnecting…" : `Reconnecting… (try ${attempt})`;
}
