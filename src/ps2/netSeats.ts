// Which PS2 pad each remote player drives.
//
// The host is always pad 0 (player one). Joiners get pads 1..N-1 in arrival
// order, reusing the lowest free slot when someone leaves — so a drop-out
// doesn't shuffle everyone else onto different wrestlers mid-match.
//
// Pure, because getting this wrong is invisible until several people are
// connected: two joiners sharing a pad looks like "player 3's controller is
// possessed", which is exactly the kind of bug that costs an evening.

/** joiner id -> pad index (1-based pads; 0 is the local host). */
export type SeatMap = ReadonlyMap<string, number>;

/**
 * Reconcile seats against the current joiner list.
 *
 * Existing joiners KEEP their pad. New ones take the lowest free pad. Anyone
 * no longer connected is dropped. Joiners beyond capacity get no pad — they
 * are connected but idle rather than silently doubled up on someone else's.
 */
export function reconcileSeats(prev: SeatMap, ids: readonly string[], maxPads: number): SeatMap {
  const next = new Map<string, number>();
  const taken = new Set<number>();

  // keep current holders first, so arrival order can't steal an active seat
  for (const id of ids) {
    const pad = prev.get(id);
    if (pad !== undefined && pad >= 1 && pad < maxPads && !taken.has(pad)) {
      next.set(id, pad);
      taken.add(pad);
    }
  }
  for (const id of ids) {
    if (next.has(id)) continue;
    let pad = 1;
    while (pad < maxPads && taken.has(pad)) pad++;
    if (pad >= maxPads) continue; // over capacity: connected, no pad
    next.set(id, pad);
    taken.add(pad);
  }
  return next;
}

/** Pads that were in use before and are not any more — release their injectors. */
export function freedPads(prev: SeatMap, next: SeatMap): number[] {
  const still = new Set(next.values());
  return [...new Set(prev.values())].filter((p) => !still.has(p)).sort((a, b) => a - b);
}

/** How many remote players a given total player count allows (host takes pad 0). */
export const remoteSlots = (players: number) => Math.max(0, Math.min(6, players) - 1);
