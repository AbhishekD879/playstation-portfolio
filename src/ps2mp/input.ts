// Shared controller vocabulary for PS2 multiplayer. The JOINER captures its
// local gamepad/keyboard into a small state object and ships it to the host;
// the HOST diffs that state and injects the matching controller-port codes as
// synthetic KeyboardEvents on the emulator canvas (the same path the local
// gamepad bridge uses for port 0, verified to drive port 2 in-game).
//
// State is a full snapshot (all currently-pressed actions + axis values), sent
// on every change plus a slow heartbeat — so a dropped packet self-corrects and
// nothing can get stuck "down".

export type Action =
  | "dpad_up" | "dpad_down" | "dpad_left" | "dpad_right"
  | "cross" | "circle" | "square" | "triangle"
  | "start" | "select" | "l1" | "r1" | "l2" | "r2" | "l3" | "r3";

export interface PadState {
  down: Action[];
  axes: { lx: number; ly: number; rx: number; ry: number };
}

// gamepad button index -> action (standard mapping; matches PS2_CONFIG)
const GP_BUTTON: Record<number, Action> = {
  12: "dpad_up", 13: "dpad_down", 14: "dpad_left", 15: "dpad_right",
  0: "cross", 1: "circle", 2: "square", 3: "triangle",
  9: "start", 8: "select",
  4: "l1", 5: "r1", 6: "l2", 7: "r2", 10: "l3", 11: "r3",
};

// keyboard code -> action, so a joiner without a pad can still play (mirrors the
// on-console PS2 key scheme where practical)
const KB_ACTION: Record<string, Action> = {
  ArrowUp: "dpad_up", ArrowDown: "dpad_down", ArrowLeft: "dpad_left", ArrowRight: "dpad_right",
  Enter: "start", Backspace: "select",
  KeyZ: "cross", KeyX: "circle", KeyA: "square", KeyS: "triangle",
  KeyQ: "l1", KeyW: "r1", KeyE: "l2", KeyR: "r2", KeyC: "l3", KeyV: "r3",
};

const sameState = (a: PadState, b: PadState) =>
  a.down.length === b.down.length &&
  a.down.every((d) => b.down.includes(d)) &&
  a.axes.lx === b.axes.lx && a.axes.ly === b.axes.ly &&
  a.axes.rx === b.axes.rx && a.axes.ry === b.axes.ry;

const q = (v: number) => Math.round(v * 100) / 100; // quantize axes to cut chatter

// —— joiner side: capture local input, emit state on change ——————————————
import { claimPad } from "../input";
export function captureLocalInput(onState: (s: PadState) => void): () => void {
  claimPad(true); // remote play owns the pad — no app-key synthesis
  const keys = new Set<string>();
  let prev: PadState = { down: [], axes: { lx: 0, ly: 0, rx: 0, ry: 0 } };
  let raf = 0;
  let lastSent = 0;

  const primaryPad = (): Gamepad | null => {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected !== false);
    if (!pads.length) return null;
    const std = pads.filter((p) => p.mapping === "standard");
    return std.length ? std[std.length - 1] : pads.reduce((b, p) => (p.buttons.length > b.buttons.length ? p : b), pads[0]);
  };

  const build = (): PadState => {
    const down = new Set<Action>();
    for (const code of keys) { const a = KB_ACTION[code]; if (a) down.add(a); }
    const axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
    const p = primaryPad();
    if (p) {
      for (const [idx, action] of Object.entries(GP_BUTTON)) if (p.buttons[+idx]?.pressed) down.add(action);
      axes.lx = q(p.axes[0] ?? 0); axes.ly = q(p.axes[1] ?? 0);
      axes.rx = q(p.axes[2] ?? 0); axes.ry = q(p.axes[3] ?? 0);
    }
    return { down: [...down], axes };
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const s = build();
    const now = performance.now();
    if (!sameState(s, prev) || now - lastSent > 500) { // change or heartbeat
      prev = s; lastSent = now; onState(s);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (!(e.code in KB_ACTION)) return;
    // modifier chords (Cmd+R, Ctrl+C…) are browser business, not game input —
    // don't swallow them, and release the key if it was held pre-chord
    if (e.metaKey || e.ctrlKey || e.altKey) { keys.delete(e.code); return; }
    e.preventDefault();
    if (e.type === "keydown") keys.add(e.code); else keys.delete(e.code);
  };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKey);
  raf = requestAnimationFrame(loop);

  return () => { claimPad(false); cancelAnimationFrame(raf); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey); };
}

// —— host side: turn remote state into controller-port key events ————————————
// codeTable is the iframe's __p2codes (action -> keyId, axes -> [neg, pos]).
export function makeInjector(win: Window, canvas: EventTarget, codeTable: Record<string, number | number[]>) {
  const DEAD = 0.5;
  let current = new Set<string>(); // code chars currently held
  const fire = (type: "keydown" | "keyup", code: string) => {
    const ev = new (win as any).KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, composed: true });
    canvas.dispatchEvent(ev);
  };
  const charOf = (keyId: number) => String.fromCharCode(keyId);

  const applyState = (s: PadState) => {
    const want = new Set<string>();
    for (const a of s.down) { const k = codeTable[a]; if (typeof k === "number") want.add(charOf(k)); }
    const axis = (name: string, v: number) => {
      const pair = codeTable[name];
      if (!Array.isArray(pair)) return;
      if (v < -DEAD) want.add(charOf(pair[0]));
      else if (v > DEAD) want.add(charOf(pair[1]));
    };
    axis("analog_left_x", s.axes.lx); axis("analog_left_y", s.axes.ly);
    axis("analog_right_x", s.axes.rx); axis("analog_right_y", s.axes.ry);

    for (const code of want) if (!current.has(code)) fire("keydown", code);
    for (const code of current) if (!want.has(code)) fire("keyup", code);
    current = want;
  };

  const release = () => { for (const code of current) fire("keyup", code); current = new Set(); };
  return { applyState, release };
}
