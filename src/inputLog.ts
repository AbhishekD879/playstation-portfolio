// A tiny ring of recent INPUT events, for the diagnostics panel.
//
// The emulator's own log lives inside the iframe; this is the parent side —
// what the gamepad bridge sees and what it dispatches. Without it, "my
// controller does nothing" is unfalsifiable from the outside: you cannot tell a
// pad the browser never reported from a pad whose keys are being dropped.
//
// Logging only. Nothing here may change behaviour, so every entry point
// swallows its own errors: a broken log must never break input.

export interface InputEvent { t: number; msg: string; n: number }

const CAP = 60;
const ring: InputEvent[] = [];
const subs = new Set<(e: InputEvent[]) => void>();
let t0 = 0;

/** Record an input event. Consecutive duplicates increment a counter instead
 *  of filling the ring — a pad polled at 60Hz would otherwise erase history. */
export function logInput(msg: string) {
  try {
    if (!t0) t0 = Date.now();
    const last = ring[0];
    if (last && last.msg === msg) last.n++;
    else {
      ring.unshift({ t: Date.now() - t0, msg, n: 1 });
      if (ring.length > CAP) ring.pop();
    }
    subs.forEach((f) => f([...ring]));
  } catch { /* logging must never break input */ }
}

export function subscribeInput(fn: (e: InputEvent[]) => void): () => void {
  subs.add(fn);
  fn([...ring]);
  return () => subs.delete(fn);
}

export function clearInput() { ring.length = 0; t0 = 0; subs.forEach((f) => f([])); }

/** Snapshot, newest first. */
export const inputEvents = () => [...ring];
