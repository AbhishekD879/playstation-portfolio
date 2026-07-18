// On-screen controls for the bring-your-own game host (RPG Maker MV/MZ, EasyRPG,
// Ren'Py). Those games listen for keyboard keys — on touch there's no keyboard,
// so they're uncontrollable. This overlay sends real key events into the game:
//   · a touch GAMEPAD (D-pad → arrows, buttons → the engines' usual keys)
//   · a hideable KEYBOARD grid for games that bind arbitrary keys (P, Q, F-keys)
// Hold-to-press (keydown on press, keyup on release). Hidden behind a bar toggle.
import { For, Show, createSignal } from "solid-js";

export interface KeyDef { key: string; code: string; keyCode: number; loc?: number }
const K = (key: string, code: string, keyCode: number, loc?: number): KeyDef => ({ key, code, keyCode, loc });

// letters/digits for the keyboard grid
const letter = (c: string): KeyDef => K(c, "Key" + c.toUpperCase(), c.toUpperCase().charCodeAt(0));
const digit = (n: number): KeyDef => K(String(n), "Digit" + n, 48 + n);

const ARROWS = {
  up: K("ArrowUp", "ArrowUp", 38), down: K("ArrowDown", "ArrowDown", 40),
  left: K("ArrowLeft", "ArrowLeft", 37), right: K("ArrowRight", "ArrowRight", 39),
};
// primary action buttons — the keys these engines actually use
const ACTIONS: { label: string; def: KeyDef; cls?: string }[] = [
  { label: "OK", def: K("Enter", "Enter", 13), cls: "ok" },        // confirm / advance (all engines)
  { label: "Back", def: K("Escape", "Escape", 27), cls: "back" },  // cancel / menu
  { label: "Z", def: letter("z") },                                 // RPG Maker ok
  { label: "X", def: letter("x") },                                 // RPG Maker cancel
  { label: "Run", def: K("Shift", "ShiftLeft", 16, 1) },            // dash / skip
  { label: "␣", def: K(" ", "Space", 32) },                         // Ren'Py advance
];
// the full-key grid rows (for games that bind uncommon keys)
const KB_ROWS: KeyDef[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit),
  "qwertyuiop".split("").map(letter),
  "asdfghjkl".split("").map(letter),
  "zxcvbnm".split("").map(letter),
];
const KB_SPECIAL: { label: string; def: KeyDef }[] = [
  { label: "Tab", def: K("Tab", "Tab", 9) },
  { label: "Ctrl", def: K("Control", "ControlLeft", 17, 1) },
  { label: "Alt", def: K("Alt", "AltLeft", 18, 1) },
  { label: "Enter", def: K("Enter", "Enter", 13) },
  { label: "Esc", def: K("Escape", "Escape", 27) },
  { label: "⌫", def: K("Backspace", "Backspace", 8) },
  { label: "F1", def: K("F1", "F1", 112) },
  { label: "F5", def: K("F5", "F5", 116) },
];

export default function TouchControls(props: { send: (def: KeyDef, down: boolean) => void; onClose: () => void }) {
  const [showKb, setShowKb] = createSignal(false);

  // a hold-to-press control: keydown on press, keyup on release. A quick tap
  // is held for a minimum window (~60ms) so the engine's per-frame input poll
  // still catches it as "triggered" — otherwise instant taps get missed.
  const hold = (def: KeyDef) => {
    let t0 = 0;
    const up = () => props.send(def, false);
    return {
      onPointerDown: (e: PointerEvent) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        e.preventDefault(); t0 = performance.now(); props.send(def, true);
      },
      onPointerUp: () => { const dt = performance.now() - t0; if (dt < 60) setTimeout(up, 60 - dt); else up(); },
      onPointerLeave: (e: PointerEvent) => { if (e.buttons) up(); },
      onPointerCancel: up,
      onContextMenu: (e: Event) => e.preventDefault(),
    };
  };

  return (
    <div class="rpg-touch">
      <button class="rpg-touch-close" onClick={props.onClose} title="Hide controls">✕ controls</button>

      {/* D-pad → arrow keys */}
      <div class="rpg-dpad">
        <button class="rpg-dbtn up" {...hold(ARROWS.up)}>▲</button>
        <button class="rpg-dbtn left" {...hold(ARROWS.left)}>◀</button>
        <button class="rpg-dbtn right" {...hold(ARROWS.right)}>▶</button>
        <button class="rpg-dbtn down" {...hold(ARROWS.down)}>▼</button>
      </div>

      {/* action buttons */}
      <div class="rpg-acts">
        <For each={ACTIONS}>{(a) => <button class={`rpg-abtn ${a.cls ?? ""}`} {...hold(a.def)}>{a.label}</button>}</For>
        <button class="rpg-abtn keys" classList={{ on: showKb() }} onClick={() => setShowKb((v) => !v)} title="Show/hide keyboard">⌨</button>
      </div>

      {/* hideable keyboard for arbitrary keys */}
      <Show when={showKb()}>
        <div class="rpg-keys" onPointerDown={(e) => e.stopPropagation()}>
          <For each={KB_ROWS}>{(row) => (
            <div class="rpg-keys-row">
              <For each={row}>{(d) => <button class="rpg-key" {...hold(d)}>{d.key}</button>}</For>
            </div>
          )}</For>
          <div class="rpg-keys-row">
            <For each={KB_SPECIAL}>{(s) => <button class="rpg-key wide" {...hold(s.def)}>{s.label}</button>}</For>
          </div>
        </div>
      </Show>
    </div>
  );
}
