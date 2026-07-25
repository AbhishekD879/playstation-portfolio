// Retro 2-player netplay — NES/SNES/GBA/Mega Drive with a friend over WebRTC.
//
// Same host-authoritative shape as PS2 multiplayer (src/ps2mp), because it's
// already proven on this console: the HOST runs the emulator and streams its
// canvas; the JOINER runs no emulator at all, just watches the video and sends
// controller state back. One emulator = no desync, ever.
//
// The win over the PS2 path is input injection. There we synthesise keyboard
// events; EmulatorJS exposes the real thing —
//   EJS_emulator.gameManager.simulateInput(player, buttonIndex, value)
// — so player 2 is driven directly, with no key-binding collisions and no need
// for the user to configure a second controller in the EJS menu.
//
// Rollback netcode would cut the latency further, but it needs deterministic
// save/load of core state every frame, which EmulatorJS doesn't expose. For
// couch-style co-op this is the honest trade: a few frames of lag, zero desync.
import type { Action, PadState } from "./ps2mp/input";

/** EmulatorJS button indices — taken from its own `buttonLabels` table
 *  (0:BUTTON_1 … 15:DPAD_RIGHT), not guessed. */
export const EJS_BUTTON = {
  BUTTON_1: 0, BUTTON_2: 1, BUTTON_3: 2, BUTTON_4: 3,
  LEFT_TOP_SHOULDER: 4, RIGHT_TOP_SHOULDER: 5,
  LEFT_BOTTOM_SHOULDER: 6, RIGHT_BOTTOM_SHOULDER: 7,
  SELECT: 8, START: 9, LEFT_STICK: 10, RIGHT_STICK: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
} as const;

/** Our shared controller vocabulary → EmulatorJS buttons. Face buttons follow
 *  the same positional mapping the local pad bridge uses (EJS_CONFIG), so
 *  player 2 feels identical to player 1. */
export const ACTION_TO_EJS: Partial<Record<Action, number>> = {
  dpad_up: EJS_BUTTON.DPAD_UP,
  dpad_down: EJS_BUTTON.DPAD_DOWN,
  dpad_left: EJS_BUTTON.DPAD_LEFT,
  dpad_right: EJS_BUTTON.DPAD_RIGHT,
  cross: EJS_BUTTON.BUTTON_1,      // bottom face → B
  circle: EJS_BUTTON.BUTTON_2,     // right face  → A
  square: EJS_BUTTON.BUTTON_3,     // left face   → Y
  triangle: EJS_BUTTON.BUTTON_4,   // top face    → X
  l1: EJS_BUTTON.LEFT_TOP_SHOULDER,
  r1: EJS_BUTTON.RIGHT_TOP_SHOULDER,
  l2: EJS_BUTTON.LEFT_BOTTOM_SHOULDER,
  r2: EJS_BUTTON.RIGHT_BOTTOM_SHOULDER,
  l3: EJS_BUTTON.LEFT_STICK,
  r3: EJS_BUTTON.RIGHT_STICK,
  select: EJS_BUTTON.SELECT,
  start: EJS_BUTTON.START,
};

/** The analog stick drives the d-pad too — plenty of retro games are played on
 *  a stick, and the cores have no analog axis anyway. */
const STICK_DEAD = 0.5;

export interface RetroInjector {
  /** Apply a full controller snapshot for `player` (0-based; 1 = player two). */
  applyState(s: PadState): void;
  /** Let go of everything — call when the joiner leaves so nothing sticks. */
  release(): void;
}

type SimulateInput = (player: number, button: number, value: number) => void;

/** Build an injector that drives `player` through EmulatorJS.
 *  `sim` is normally `EJS_emulator.gameManager.simulateInput` — passed in so
 *  this stays a pure, testable unit. */
export function makeRetroInjector(sim: SimulateInput, player = 1): RetroInjector {
  let held = new Set<number>();

  const applyState = (s: PadState) => {
    const want = new Set<number>();
    for (const a of s.down) {
      const b = ACTION_TO_EJS[a];
      if (b !== undefined) want.add(b);
    }
    // stick → d-pad, so a joiner on an analog controller still moves
    if (s.axes.lx < -STICK_DEAD) want.add(EJS_BUTTON.DPAD_LEFT);
    if (s.axes.lx > STICK_DEAD) want.add(EJS_BUTTON.DPAD_RIGHT);
    if (s.axes.ly < -STICK_DEAD) want.add(EJS_BUTTON.DPAD_UP);
    if (s.axes.ly > STICK_DEAD) want.add(EJS_BUTTON.DPAD_DOWN);

    // only send the edges: simulateInput on every button every frame would
    // hammer the core needlessly
    for (const b of want) if (!held.has(b)) sim(player, b, 1);
    for (const b of held) if (!want.has(b)) sim(player, b, 0);
    held = want;
  };

  const release = () => {
    for (const b of held) sim(player, b, 0);
    held = new Set();
  };

  return { applyState, release };
}

/** Reach EmulatorJS's input API from the page, or null if it isn't up yet. */
export function ejsSimulateInput(): SimulateInput | null {
  const em = (window as any).EJS_emulator;
  const gm = em?.gameManager;
  if (!gm || typeof gm.simulateInput !== "function") return null;
  return (p, b, v) => gm.simulateInput(p, b, v);
}

/** The emulator's canvas — what we stream to the joiner. EmulatorJS mounts in
 *  the top document, so this is a plain query (no iframe hop like PS2). */
export function ejsCanvas(): HTMLCanvasElement | null {
  const em = (window as any).EJS_emulator;
  return (em?.canvas as HTMLCanvasElement) ?? document.querySelector("#ejs-mount canvas");
}
