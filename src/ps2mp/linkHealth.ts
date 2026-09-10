// Telling a wobble apart from a drop.
//
// RTCPeerConnection.connectionState goes to "disconnected" whenever ICE misses
// a few consistency checks: a wifi hiccup, a NAT rebinding, a laptop changing
// access point, a phone moving between cells. The spec is explicit that this is
// transient — the state very often returns to "connected" on its own within a
// second or two, with nothing lost but a couple of frames.
//
// Treating it as terminal is what turns a blip into an outage. The host used to
// delete the peer the instant it saw "disconnected", and the joiner classified
// the same word as "dropped" and started a fresh reconnect — so a link that was
// about to heal was torn down by both ends at once. That is the whole reason
// sessions dropped "sometimes": it tracked the network's bad seconds, not load.
//
// So: wait out "disconnected" for a grace period. "failed" and "closed" are the
// terminal ones and are acted on at once.

export type LinkState = "connected" | "wobbling" | "lost";

/** How long a link may sit in "disconnected" before we give up on it.
 *
 *  Long enough to outlast the reconnect ICE does by itself (typically under two
 *  seconds), short enough that a genuinely dead session does not leave someone
 *  staring at a frozen frame. */
export const GRACE_MS = 8000;

export interface LinkWatchOpts {
  /** Back on the air — only fires after a wobble, never on the first connect. */
  onRestored?: () => void;
  /** Wobbling: transient, no action wanted beyond telling the player. */
  onWobble?: () => void;
  /** Really gone: terminal state, or a wobble that never came back. */
  onLost: () => void;
  graceMs?: number;
  /** Injectable for the tests, which must not wait eight real seconds. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** The minimum of RTCPeerConnection this needs, so a test can pass a fake. */
export interface ConnectionLike {
  connectionState: string;
}

/**
 * Feed it connection states; it decides what they mean.
 *
 * Returned as a plain function rather than wired to the event, because both
 * the host and the joiner already own their onconnectionstatechange handler
 * and both need to keep reporting raw states for the status line.
 */
export function watchLink(pc: ConnectionLike, opts: LinkWatchOpts) {
  const graceMs = opts.graceMs ?? GRACE_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let wobbling = false;
  let done = false;

  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

  const lose = () => {
    if (done) return;
    done = true;
    stopTimer();
    opts.onLost();
  };

  /** Call on every connectionstatechange. Returns what it made of the state. */
  function update(): LinkState {
    if (done) return "lost";
    const s = pc.connectionState;

    if (s === "failed" || s === "closed") { lose(); return "lost"; }

    if (s === "disconnected") {
      if (!wobbling) {
        wobbling = true;
        opts.onWobble?.();
        // Re-read at expiry rather than trusting this closure: by then the
        // link may have recovered without another event we saw.
        timer = setTimer(() => {
          timer = null;
          if (pc.connectionState === "connected") { wobbling = false; opts.onRestored?.(); return; }
          lose();
        }, graceMs);
      }
      return "wobbling";
    }

    if (s === "connected") {
      stopTimer();
      if (wobbling) { wobbling = false; opts.onRestored?.(); }
      return "connected";
    }

    return wobbling ? "wobbling" : "connected"; // "new"/"connecting" — nothing to judge yet
  }

  /** Stop watching; the caller is tearing the connection down deliberately. */
  function cancel() { done = true; stopTimer(); }

  return { update, cancel, isWobbling: () => wobbling };
}
