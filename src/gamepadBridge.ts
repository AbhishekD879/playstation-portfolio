// Gamepad → keyboard bridge for engines that only listen for the keyboard
// (js-dos / DOSBox, Ruffle / Flash). Runs its own poll loop while a game is
// active — our normal nav polling (input.ts) is disabled then, so no double-
// handling. Synthesizes real KeyboardEvents (key + code + keyCode, since older
// engines read keyCode) on the game element AND document. All reads merge
// across every connected pad (Xbox controllers register a phantom 2nd slot).

import { claimPad, rumble } from "./input";

interface KeyDef { key: string; code: string; keyCode: number }
const K = (key: string, code: string, keyCode: number): KeyDef => ({ key, code, keyCode });
export type PadMap = Record<number, KeyDef>;
// analog stick → keys: axis index, key when pushed negative / positive
interface AxisBind { axis: number; neg: KeyDef; pos: KeyDef; dead?: number }
export interface BridgeConfig {
  map: PadMap;
  axes: AxisBind[];
  hold?: KeyDef[];
  /** pad button that quits the game (default 8 = Back). null = no pad quit —
   *  used when that button is needed in-game (e.g. PS2 Select). */
  quitButton?: number | null;
  /** button indices that kick a rumble pulse on press (e.g. DOOM fire). */
  rumbleOn?: number[];
}

const UP = K("ArrowUp", "ArrowUp", 38), DOWN = K("ArrowDown", "ArrowDown", 40);
const LEFT = K("ArrowLeft", "ArrowLeft", 37), RIGHT = K("ArrowRight", "ArrowRight", 39);
const CTRL = K("Control", "ControlLeft", 17), SPACE = K(" ", "Space", 32);
const SHIFT = K("Shift", "ShiftLeft", 16), ENTER = K("Enter", "Enter", 13), ESC = K("Escape", "Escape", 27);
const COMMA = K(",", "Comma", 188), PERIOD = K(".", "Period", 190);

// ——— Flash & anything generic: d-pad + left stick = arrows, face = actions ———
export const DEFAULT_CONFIG: BridgeConfig = {
  map: {
    12: UP, 13: DOWN, 14: LEFT, 15: RIGHT,
    0: SPACE, 1: CTRL, 2: K("z", "KeyZ", 90), 3: K("x", "KeyX", 88),
    9: ENTER, 4: SHIFT, 5: CTRL, 6: SHIFT, 7: SPACE,
  },
  axes: [
    { axis: 0, neg: LEFT, pos: RIGHT },  // left stick X → arrows
    { axis: 1, neg: UP, pos: DOWN },     // left stick Y → arrows
  ],
};

// ——— PlayStation 2 (Play!): its fixed keyboard map → real pad layout ———
// Play! keys: arrows=d-pad · Z=Cross A=Square S=Triangle X=Circle ·
// Return=Start Backspace=Select · 1/2/3=L1/L2/L3 8/9/0=R1/R2/R3 ·
// F,H,T,G=left stick · J,L,I,K=right stick
export const PS2_CONFIG: BridgeConfig = {
  quitButton: null, // Back = SELECT in-game; quit via the eject button
  map: {
    12: UP, 13: DOWN, 14: LEFT, 15: RIGHT,
    0: K("z", "KeyZ", 90),          // A → Cross
    1: K("x", "KeyX", 88),          // B → Circle
    2: K("a", "KeyA", 65),          // X → Square
    3: K("s", "KeyS", 83),          // Y → Triangle
    9: ENTER,                        // Start
    8: K("Backspace", "Backspace", 8), // Back → Select
    // Play! matches the literal code string "Key1" (not the real DOM code
    // "Digit1") — see InputProviderEmscripten::MakeBindingTarget. Synthetic
    // events can send it; a real keyboard never could.
    4: K("1", "Key1", 49),           // LB → L1
    5: K("8", "Key8", 56),           // RB → R1
    6: K("2", "Key2", 50),           // LT → L2
    7: K("9", "Key9", 57),           // RT → R2
    10: K("3", "Key3", 51),          // L3
    11: K("0", "Key0", 48),          // R3
  },
  axes: [
    { axis: 0, neg: K("f", "KeyF", 70), pos: K("h", "KeyH", 72) }, // L stick X
    { axis: 1, neg: K("t", "KeyT", 84), pos: K("g", "KeyG", 71) }, // L stick Y
    { axis: 2, neg: K("j", "KeyJ", 74), pos: K("l", "KeyL", 76) }, // R stick X
    { axis: 3, neg: K("i", "KeyI", 73), pos: K("k", "KeyK", 75) }, // R stick Y
  ],
};

// ——— EmulatorJS (retro cartridges): speak its DEFAULT keyboard bindings ———
// EJS matches inputs on e.keyCode (its keyLookup turns the default strings
// into keyCodes), so the keyCode field below is what actually lands. Its own
// gamepad handler is bypassed on purpose: it keys on "id_index" pairs that
// break whenever a phantom duplicate pad shifts the indices.
export const EJS_CONFIG: BridgeConfig = {
  quitButton: null, // Select/Back is a real console button in-game (GBA menus!)
  map: {
    12: UP, 13: DOWN, 14: LEFT, 15: RIGHT,
    0: K("x", "KeyX", 88),   // A → EJS "x" (B button on Nintendo-style cores)
    1: K("z", "KeyZ", 90),   // B → EJS "z"
    2: K("s", "KeyS", 83),   // X → EJS "s"
    3: K("a", "KeyA", 65),   // Y → EJS "a"
    4: K("q", "KeyQ", 81),   // LB → L
    5: K("e", "KeyE", 69),   // RB → R
    6: K("Tab", "Tab", 9),   // LT → L2
    7: K("r", "KeyR", 82),   // RT → R2
    8: K("v", "KeyV", 86),   // Back → Select
    9: ENTER,                // Start
  },
  axes: [
    { axis: 0, neg: LEFT, pos: RIGHT }, // left stick doubles the d-pad
    { axis: 1, neg: UP, pos: DOWN },
  ],
};

// ——— DOOM: real Xbox-FPS scheme (twin-stick, always-run) ———
// Left stick = move + strafe · Right stick X = turn · RT/A = fire · X = use ·
// B = use · Y = weapon · LB/RB = strafe · Start = menu · Back = quit.
export const DOOM_CONFIG: BridgeConfig = {
  map: {
    7: CTRL,                 // RT → FIRE
    0: CTRL,                 // A  → FIRE (thumb-friendly)
    2: SPACE,                // X  → USE / open door
    1: SPACE,                // B  → USE
    3: ENTER,                // Y  → weapon change / menu select
    4: COMMA, 5: PERIOD,     // LB/RB → strafe L/R
    9: ESC,                  // Start → DOOM menu
    12: UP, 13: DOWN, 14: LEFT, 15: RIGHT, // d-pad → menu navigation
  },
  axes: [
    { axis: 1, neg: UP, pos: DOWN },       // LEFT stick Y → move forward/back
    { axis: 0, neg: COMMA, pos: PERIOD },  // LEFT stick X → strafe left/right
    { axis: 2, neg: LEFT, pos: RIGHT },    // RIGHT stick X → TURN left/right
  ],
  hold: [SHIFT], // always-run, like every modern console shooter
  rumbleOn: [0, 7], // A / RT → fire kicks the controller
};

const QUIT_BTN = 8; // Back/Select → leave the game
let cfg: BridgeConfig = DEFAULT_CONFIG;

let raf = 0;
let targets: EventTarget[] = [];
let onQuit: (() => void) | null = null;
const down = new Set<string>(); // key-source ids currently held (btn "b12", axis "a0-")

function allPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected !== false);
}
// the ONE real pad (standard-mapped; phantom duplicates report mapping "") — read
// buttons AND axes from it so a phantom's stuck sticks/buttons can't interfere
function primaryPad(pads: Gamepad[]): Gamepad | null {
  if (!pads.length) return null;
  const std = pads.filter((p) => p.mapping === "standard");
  if (std.length) return std[std.length - 1];
  return pads.reduce((best, p) => (p.buttons.length > best.buttons.length ? p : best), pads[0]);
}

function fire(type: "keydown" | "keyup", d: KeyDef) {
  for (const t of targets) {
    const ev = new KeyboardEvent(type, { key: d.key, code: d.code, bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(ev, "keyCode", { get: () => d.keyCode }); // init dict ignores keyCode
    Object.defineProperty(ev, "which", { get: () => d.keyCode });
    t.dispatchEvent(ev);
  }
}

const btnPressed = (p: Gamepad, i: number) => !!p.buttons[i]?.pressed;
const axisVal = (p: Gamepad, i: number) => p.axes[i] ?? 0;

// edge-detected key: hold `id` in `down`, send keydown on rising / keyup on falling
function edge(id: string, on: boolean, key: KeyDef) {
  if (on && !down.has(id)) { down.add(id); fire("keydown", key); }
  else if (!on && down.has(id)) { down.delete(id); fire("keyup", key); }
}

function loop() {
  raf = requestAnimationFrame(loop);
  const p = primaryPad(allPads());
  if (!p) return;
  const qb = cfg.quitButton === undefined ? QUIT_BTN : cfg.quitButton;
  if (qb !== null) {
    const q = btnPressed(p, qb);
    if (q && !down.has("quit")) { down.add("quit"); onQuit?.(); return; }
    if (!q) down.delete("quit");
  }

  for (const key of Object.keys(cfg.map)) {
    const i = +key;
    const pressed = btnPressed(p, i);
    if (pressed && !down.has("b" + i) && cfg.rumbleOn?.includes(i)) rumble(0.7, 0.5, 90);
    edge("b" + i, pressed, cfg.map[i]);
  }
  for (let j = 0; j < cfg.axes.length; j++) {
    const bind = cfg.axes[j];
    const v = axisVal(p, bind.axis);
    const dead = bind.dead ?? 0.5;
    edge(`a${j}-`, v < -dead, bind.neg);
    edge(`a${j}+`, v > dead, bind.pos);
  }
}

export function startBridge(target: EventTarget | null, quit: () => void, config: BridgeConfig = DEFAULT_CONFIG) {
  onQuit = quit;
  cfg = config;
  if (!targets.length) claimPad(true); // the game owns the pad — no app-key synthesis
  // ONE dispatch per event, on the deepest target — it bubbles to document and
  // window anyway. The old [target, document] pair delivered every key TWICE to
  // window-level engines (js-dos!): menus toggled open-and-shut, actions
  // self-cancelled. (PS2 never noticed: its canvas lives in an iframe, so the
  // parent-document copy reached nobody.)
  targets = target ? [target] : [document];
  down.clear();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
  // hold keys (e.g. always-run) go down immediately and stay until stop
  cfg.hold?.forEach((k, n) => { down.add("hold" + n); fire("keydown", k); });
}

export function stopBridge() {
  cancelAnimationFrame(raf);
  // release everything so a held key can't leak into the next screen
  for (const key of Object.keys(cfg.map)) if (down.has("b" + key)) fire("keyup", cfg.map[+key]);
  for (let j = 0; j < cfg.axes.length; j++) {
    if (down.has(`a${j}-`)) fire("keyup", cfg.axes[j].neg);
    if (down.has(`a${j}+`)) fire("keyup", cfg.axes[j].pos);
  }
  cfg.hold?.forEach((k) => fire("keyup", k));
  down.clear();
  if (targets.length) claimPad(false);
  targets = [];
  onQuit = null;
  cfg = DEFAULT_CONFIG;
}
