// Unified console input: keyboard + any gamepad slot, with XMB-style
// initial-delay + repeat on held directions. Consumers subscribe to actions.

export type NavAction = "left" | "right" | "up" | "down" | "confirm" | "back" | "options";
type Handler = (a: NavAction) => void;

let handler: Handler | null = null;
let enabled = true;

export function onNav(h: Handler) { handler = h; }
export function setNavEnabled(on: boolean) { enabled = on; }

const KEYMAP: Record<string, NavAction> = {
  ArrowLeft: "left", a: "left",
  ArrowRight: "right", d: "right",
  ArrowUp: "up", w: "up",
  ArrowDown: "down", s: "down",
  Enter: "confirm", " ": "confirm", x: "confirm",
  Escape: "back", Backspace: "back", o: "back",
};

const REPEAT_DELAY = 380; // ms before a held direction repeats
const REPEAT_RATE = 95;

const held: Partial<Record<NavAction, { t0: number; last: number }>> = {};
const isDir = (a: NavAction) => a === "left" || a === "right" || a === "up" || a === "down";

addEventListener("keydown", (e) => {
  if (!enabled || !handler) return;
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  const a = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!a) return;
  e.preventDefault();
  if (e.repeat) return; // we do our own repeat
  if (isDir(a)) held[a] = { t0: performance.now(), last: performance.now() }; // ONLY directions repeat
  handler(a);
});
addEventListener("keyup", (e) => {
  const a = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (a) delete held[a];
});
// a native file dialog (or tab switch) steals focus and eats the keyup —
// without this, a key looks held forever and repeat fires endlessly
const releaseAll = () => {
  for (const k of Object.keys(held) as NavAction[]) delete held[k];
  for (const k of Object.keys(padHeld) as NavAction[]) delete padHeld[k];
};
addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", releaseAll);

// —— gamepad ——
function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected !== false);
}
// the ONE pad to read: prefer a standard-mapped one (the real Xbox pad; phantom
// HID duplicates report mapping ""), else the pad with the most buttons.
function primaryPad(): Gamepad | null {
  const pads = connectedPads();
  if (!pads.length) return null;
  const std = pads.filter((p) => p.mapping === "standard");
  if (std.length) return std[std.length - 1];
  return pads.reduce((best, p) => (p.buttons.length > best.buttons.length ? p : best), pads[0]);
}
const firstPad = primaryPad; // connection tracker uses the same source of truth

// Connection state is POLL-based, not event-based: browsers (esp. Xbox pads on
// macOS) fire spurious `gamepaddisconnected` for phantom/duplicate slots the
// instant a pad connects. We ignore those events and instead trust the poll,
// debounced so a one-frame dropout can't flip the UI to "disconnected".
let padWatch: ((name: string | null) => void) | null = null;
let padSeenName: string | null = null;
let padMissing = 0;
const MISSING_LIMIT = 45; // ~0.75s of truly no pad before we call it gone

export function onPadChange(cb: (name: string | null) => void) {
  padWatch = cb;
  cb(padSeenName); // hand the newly-mounted consumer the current state
}

function trackPad() {
  const p = firstPad();
  if (p) {
    padMissing = 0;
    if (padSeenName === null) {
      padSeenName = p.id || "Controller";
      padWatch?.(padSeenName);
    }
  } else if (padSeenName !== null && ++padMissing > MISSING_LIMIT) {
    padSeenName = null;
    padWatch?.(null);
  }
}

const padPrev: Record<string, boolean> = {};
const padHeld: Partial<Record<NavAction, { t0: number; last: number }>> = {};

function pollPad(now: number) {
  // An Xbox pad often registers TWICE (real + phantom duplicate). Read from the
  // ONE real pad — the standard-mapped one — rather than merging, because the
  // phantom's stuck axes mask the stick and its stuck buttons jam edge-detection.
  const p = primaryPad();
  if (!p || !enabled || !handler) return;
  const b = (i: number) => !!p.buttons[i]?.pressed;
  const axis = (i: number) => p.axes[i] ?? 0;
  const ax = axis(0), ay = axis(1);
  // some pads report the d-pad as a "hat" on axis 9 rather than buttons 12-15
  const hat = p.axes[9] !== undefined && p.axes[9] >= -1.01 && p.axes[9] <= 1.01 ? p.axes[9] : 2;
  const hatDir = (lo: number, hi: number) => hat >= lo && hat <= hi;
  const dir: Record<NavAction, boolean> = {
    // d-pad button OR left stick OR hat-axis (up≈-1, right≈-0.43, down≈0.14, left≈0.71)
    left: b(14) || ax < -0.5 || hatDir(0.55, 0.95),
    right: b(15) || ax > 0.5 || hatDir(-0.65, -0.25),
    up: b(12) || ay < -0.5 || hatDir(-1.05, -0.85),
    down: b(13) || ay > 0.5 || hatDir(-0.05, 0.35),
    confirm: b(0), // "A"/cross is index 0 across virtually all layouts
    back: b(1),    // "B"/circle
    options: b(9) || b(8),
  };
  for (const k of Object.keys(dir) as NavAction[]) {
    const on = dir[k];
    const isDir = k === "left" || k === "right" || k === "up" || k === "down";
    if (on && !padPrev[k]) {
      handler(k);
      if (isDir) padHeld[k] = { t0: now, last: now };
    } else if (on && isDir && padHeld[k]) {
      const h = padHeld[k]!;
      if (now - h.t0 > REPEAT_DELAY && now - h.last > REPEAT_RATE) {
        h.last = now;
        handler(k);
      }
    }
    if (!on) delete padHeld[k];
    padPrev[k] = on;
  }
}

function tickRepeats(now: number) {
  if (!enabled || !handler) return;
  for (const k of Object.keys(held) as NavAction[]) {
    const h = held[k]!;
    if (now - h.t0 > REPEAT_DELAY && now - h.last > REPEAT_RATE) {
      h.last = now;
      handler(k);
    }
  }
}

function loop(now: number) {
  trackPad();       // connection detection runs always (even when nav is disabled)
  tickRepeats(now);
  pollPad(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
