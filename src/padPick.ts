// Which gamepad drives player one.
//
// Its own leaf module (no browser imports) so the rule can be tested directly —
// gamepadBridge.ts pulls in listener side effects at import time and can't be
// loaded outside a browser.

/**
 * ★ The co-op lock must never be able to SILENCE player one.
 *
 * Local co-op locks port 0 to one specific gamepad index so the second pad
 * can't bleed into player 1. But if that locked pad is gone — unplugged,
 * re-enumerated into a different index, or the lock simply leaked in from
 * another app — matching it must fall back to the normal auto-pick.
 *
 * This used to resolve to null instead, so one stale index killed player one's
 * input on every frame, permanently and silently, with nothing on screen to
 * explain it. A lock that matches nothing is treated as no lock at all.
 */
export function pickPad<T extends { index: number }>(pads: T[], lockedIndex: number | null): T | null {
  if (lockedIndex != null) {
    const locked = pads.find((p) => p.index === lockedIndex);
    if (locked) return locked;
    // fall through — a lock matching nothing is no lock
  }
  return pads[0] ?? null;
}
