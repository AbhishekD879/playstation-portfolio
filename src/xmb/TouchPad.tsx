// On-screen gamepad for keyboard-driven engines with no touch controls of
// their own (PS2 / DOOM). Hidden on desktop via CSS (@media pointer: coarse).
// Buttons are dumb: pointerdown → press(true), release → press(false); the
// caller decides which key each press becomes.
import { For, Show, type JSX } from "solid-js";

export interface TB { label: JSX.Element | string; cls?: string; press: (on: boolean) => void }

const ARROWS = { up: "▲", down: "▼", left: "◀", right: "▶" } as const;

function Btn(p: { cls: string; press: (on: boolean) => void; label?: string; children?: JSX.Element }) {
  return (
    <button
      class={p.cls}
      aria-label={p.label}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); p.press(true); }}
      onPointerUp={() => p.press(false)}
      onPointerCancel={() => p.press(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {p.children}
    </button>
  );
}

export default function TouchPad(props: {
  dpad: (dir: "up" | "down" | "left" | "right", on: boolean) => void;
  face: TB[];        // right-thumb cluster (PS diamond via gp-n/e/s/w, or gp-big/gp-mid)
  pills?: TB[];      // small bottom-center pills (Start / Select / menu / mode)
  shoulderL?: TB[];  // above the d-pad (L1/L2, strafe)
  shoulderR?: TB[];  // above the face cluster
}) {
  return (
    <div class="gpad">
      <Show when={props.shoulderL?.length}>
        <div class="gpad-shoulder gpad-sl">
          <For each={props.shoulderL}>{(b) => <Btn cls={`gpad-pill ${b.cls ?? ""}`} press={b.press}>{b.label}</Btn>}</For>
        </div>
      </Show>
      <Show when={props.shoulderR?.length}>
        <div class="gpad-shoulder gpad-sr">
          <For each={props.shoulderR}>{(b) => <Btn cls={`gpad-pill ${b.cls ?? ""}`} press={b.press}>{b.label}</Btn>}</For>
        </div>
      </Show>
      <div class="gpad-dpad">
        <For each={["up", "down", "left", "right"] as const}>
          {(dir) => <Btn cls={`gpad-d gpad-${dir}`} label={dir} press={(on) => props.dpad(dir, on)}>{ARROWS[dir]}</Btn>}
        </For>
      </div>
      <Show when={props.pills?.length}>
        <div class="gpad-pills">
          <For each={props.pills}>{(b) => <Btn cls={`gpad-pill ${b.cls ?? ""}`} press={b.press}>{b.label}</Btn>}</For>
        </div>
      </Show>
      <div class="gpad-face">
        <For each={props.face}>{(b) => <Btn cls={`gpad-b ${b.cls ?? ""}`} press={b.press}>{b.label}</Btn>}</For>
      </div>
    </div>
  );
}
