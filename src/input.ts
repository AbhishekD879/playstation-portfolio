// Unified console input: keyboard + any gamepad slot, with XMB-style
// initial-delay + repeat on held directions. Consumers subscribe to actions.

export type NavAction = "left" | "right" | "up" | "down" | "confirm" | "back" | "options";
/** src tells the consumer where the action came from — real keyboard events
 *  also reach apps directly, so only pad/gesture sources may be re-synthesized
 *  as keys (else keyboard users would get every action twice). */
export type NavSource = "key" | "pad" | "gesture";
type Handler = (a: NavAction, src?: NavSource) => void;

let handler: Handler | null = null;
let enabled = true;
// the on-screen keyboard claims the pad while open — nav must not see it
let oskBlock = false;
// games (gamepadBridge) and the PS2 joiner read the pad themselves — while any
// of them holds a claim, the app-mode key synthesis below stays quiet
let padClaims = 0;

export function onNav(h: Handler) { handler = h; }
export function setNavEnabled(on: boolean) { enabled = on; }
export function setOskBlock(on: boolean) { oskBlock = on; }
export function claimPad(on: boolean) { padClaims = Math.max(0, padClaims + (on ? 1 : -1)); }

// —— the "PS button" (Guide, index 16): SYSTEM-level, works even while a game
// claims the pad or nav is disabled — it opens the Control Center. ——
let sysBtnCb: (() => void) | null = null;
let sysBtnPrev = false;
export function onSystemButton(cb: () => void) { sysBtnCb = cb; }
function pollSystemButton() {
  const p = primaryPad();
  const on = !!p?.buttons[16]?.pressed;
  if (on && !sysBtnPrev) sysBtnCb?.();
  sysBtnPrev = on;
}

// —— Control Center owns the pad EXCLUSIVELY while open (works from anywhere,
// even mid-game): its nav callback gets every direction/confirm/back and the
// normal nav/synth/game-synth paths below are bypassed. ——
let ccActive = false;
let ccCb: ((a: NavAction) => void) | null = null;
export function setCcActive(on: boolean) { ccActive = on; }
export function onCcNav(cb: (a: NavAction) => void) { ccCb = cb; }

// —— Options/Menu button (9, or Back/View 8): a single tap is the "options"
// action; a DOUBLE tap opens the Control Center from anywhere. This is the
// reliable shortcut for pads whose Guide button (16) the browser never reports
// (most Xbox pads on macOS/Chrome). ——
let optPrev = false;
let optLastTap = -Infinity;
let optTimer: ReturnType<typeof setTimeout> | 0 = 0;
const DOUBLE_TAP_MS = 320;
function pollOptions(now: number) {
  const p = primaryPad();
  const on = !!(p?.buttons[9]?.pressed || p?.buttons[8]?.pressed);
  if (on && !optPrev) {
    if (now - optLastTap < DOUBLE_TAP_MS) {
      if (optTimer) { clearTimeout(optTimer); optTimer = 0; } // cancel the pending single
      optLastTap = -Infinity;
      sysBtnCb?.(); // ← open Control Center
    } else {
      optLastTap = now;
      if (optTimer) clearTimeout(optTimer);
      optTimer = setTimeout(() => {
        optTimer = 0;
        if (enabled && handler && !oskBlock) handler("options", "pad"); // single tap only
      }, DOUBLE_TAP_MS);
    }
  }
  optPrev = on;
}

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
  if (!e.isTrusted) return; // synthesized keys must never loop back into nav
  if (!enabled || oskBlock || !handler) return;
  const t = (e.target as HTMLElement)?.tagName;
  if (t === "INPUT" || t === "TEXTAREA") return;
  const a = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!a) return;
  e.preventDefault();
  if (e.repeat) return; // we do our own repeat
  if (isDir(a)) held[a] = { t0: performance.now(), last: performance.now() }; // ONLY directions repeat
  handler(a, "key");
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
export function primaryPad(): Gamepad | null {
  const pads = connectedPads();
  if (!pads.length) return null;
  const std = pads.filter((p) => p.mapping === "standard");
  if (std.length) return std[std.length - 1];
  return pads.reduce((best, p) => (p.buttons.length > best.buttons.length ? p : best), pads[0]);
}
const firstPad = primaryPad; // connection tracker uses the same source of truth

// —— haptics: DualShock-style rumble on the primary pad (Chrome/Edge; a no-op
// where vibrationActuator is absent, so callers never need to guard) ——
let rumbleOn = localStorage.getItem("asp.rumble") !== "0";
export const rumbleEnabled = () => rumbleOn;
export function setRumble(on: boolean) { rumbleOn = on; localStorage.setItem("asp.rumble", on ? "1" : "0"); }
export function rumble(strong = 0.6, weak = 0.4, duration = 120) {
  if (!rumbleOn) return;
  const act = (primaryPad() as any)?.vibrationActuator;
  act?.playEffect?.("dual-rumble", { duration, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {});
  dsHook?.(strong, weak, duration); // DualSense-over-WebHID, when connected
}
// registered by dualsense.ts consumers — avoids a hard import cycle
let dsHook: ((s: number, w: number, d: number) => void) | null = null;
export function setRumbleHook(h: ((s: number, w: number, d: number) => void) | null) { dsHook = h; }

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
  if (!p) return;
  // Two consumers, by mode:
  //  · nav enabled (XMB): pad presses become NavActions, as ever.
  //  · nav disabled (inside an app) and no game holds a pad claim: pad presses
  //    become synthetic keyboard events (arrows/Enter/Escape) — apps are
  //    keyboard-driven, so the controller can walk their lists too.
  // A focused text field owns the pad either way: ✕/d-pad summon the on-screen
  // keyboard (Osk.tsx); only "back" (◯) passes through, to cancel/blur.
  // While blocked (OSK open, game claim) we still TRACK edges below — otherwise
  // a button held across the hand-off replays as a fresh press and one ◯ ends
  // up closing the keyboard AND the app behind it.
  const navMode = enabled && !!handler && !oskBlock;
  const synthMode = !enabled && padClaims === 0 && !oskBlock;
  const live = ccActive || navMode || synthMode;
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA";
  const SYNTH_KEY: Partial<Record<NavAction, string>> = {
    left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
    confirm: "Enter", back: "Escape",
  };
  const fire = (k: NavAction) => {
    if (ccActive) { ccCb?.(k); return; } // Control Center owns the pad while open
    if (typing) { // a focused text field: ◯ steps OUT of the field, nothing else leaks
      if (k === "back") (document.activeElement as HTMLElement)?.blur?.();
      return;
    }
    if (navMode) {
      handler!(k, "pad");
      return;
    }
    const key = SYNTH_KEY[k];
    if (!key) return;
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }),
    );
  };
  const b = (i: number) => !!p.buttons[i]?.pressed;
  const axis = (i: number) => p.axes[i] ?? 0;
  const ax = axis(0), ay = axis(1);
  // some pads report the d-pad as a "hat" on axis 9 rather than buttons 12-15
  const hat = p.axes[9] !== undefined && p.axes[9] >= -1.01 && p.axes[9] <= 1.01 ? p.axes[9] : 2;
  const hatDir = (lo: number, hi: number) => hat >= lo && hat <= hi;
  // options (button 9/8) is handled in pollOptions — single tap vs double tap
  const dir: Partial<Record<NavAction, boolean>> = {
    // d-pad button OR left stick OR hat-axis (up≈-1, right≈-0.43, down≈0.14, left≈0.71)
    left: b(14) || ax < -0.5 || hatDir(0.55, 0.95),
    right: b(15) || ax > 0.5 || hatDir(-0.65, -0.25),
    up: b(12) || ay < -0.5 || hatDir(-1.05, -0.85),
    down: b(13) || ay > 0.5 || hatDir(-0.05, 0.35),
    confirm: b(0), // "A"/cross is index 0 across virtually all layouts
    back: b(1),    // "B"/circle
  };
  for (const k of Object.keys(dir) as NavAction[]) {
    const on = !!dir[k];
    const isDir = k === "left" || k === "right" || k === "up" || k === "down";
    if (on && !padPrev[k]) {
      if (live) fire(k);
      if (isDir) padHeld[k] = { t0: now, last: now };
    } else if (on && isDir && padHeld[k]) {
      const h = padHeld[k]!;
      if (now - h.t0 > REPEAT_DELAY && now - h.last > REPEAT_RATE) {
        h.last = now;
        if (live && !typing) fire(k);
      }
    }
    if (!on) delete padHeld[k];
    padPrev[k] = on; // edge state stays fresh even while blocked
  }
}

function tickRepeats(now: number) {
  if (!enabled || oskBlock || !handler) return;
  for (const k of Object.keys(held) as NavAction[]) {
    const h = held[k]!;
    if (now - h.t0 > REPEAT_DELAY && now - h.last > REPEAT_RATE) {
      h.last = now;
      handler(k);
    }
  }
}

function loop(now: number) {
  trackPad();        // connection detection runs always (even when nav is disabled)
  pollSystemButton(); // PS/Guide button is system-level — always watched
  pollOptions(now);  // double-tap Options opens the Control Center from anywhere
  tickRepeats(now);
  pollPad(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
