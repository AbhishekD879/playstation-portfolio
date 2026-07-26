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
  // The room is torn down the moment its host disconnects, so a retry lands on
  // "no such room". That used to fall through to "connecting", which retries
  // nothing and reports nothing — the joiner sat on a frozen last frame and the
  // game looked like it was still running.
  if (s.includes("host left") || s.includes("no such room") || s.includes("room full")) return "gone";
  if (s.includes("fail") || s.includes("disconnect") || s.includes("signaling closed")) return "dropped";
  if (s === "connected" || s.includes("complete")) return "connected";
  return "connecting";
}

/** A host who is only reloading comes back within a couple of seconds; one who
 *  quit never does. Keep trying briefly, then stop — waiting forever is what
 *  makes a dead session look live. */
export const GONE_ATTEMPTS = 6;
export function shouldRetry(h: Health, attempt = 0): boolean {
  if (h === "gone") return attempt < GONE_ATTEMPTS;
  return h === "dropped";
}

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
  if (h === "gone") {
    if (attempt >= GONE_ATTEMPTS) return "The host closed the room.";
    return attempt === 1 ? "Host disconnected — waiting for them to come back…" : `Waiting for the host… (try ${attempt})`;
  }
  return attempt === 1 ? "Connection lost — reconnecting…" : `Reconnecting… (try ${attempt})`;
}
