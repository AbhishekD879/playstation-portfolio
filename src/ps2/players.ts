// Who is sitting in which PS2 controller slot.
//
// Six seats. A seat is filled by one of four sources, and the emulator cannot
// tell them apart — they all end up as pad input on the seat's slot:
//
//   keyboard  player one's usual bridge (EmulatorJS-style, pad index 0)
//   pad       a physical gamepad claimed on this machine
//   net       a remote player over WebRTC
//   test      ★ a SYNTHETIC pad that presses buttons on a timer
//
// `test` is the verification tool, and it is the same trick as the bot players
// in Board Games: proving a 6-player game really sees six controllers should not
// require owning six controllers. A test pad taps START on a loop, which is
// exactly what a controller-select screen is waiting for, so the game lights up
// that player slot on its own.
//
// Each seat's pattern is phase-offset so you can tell on screen which slot is
// which — seat 3 lights up a beat after seat 2.

import type { Action, PadState } from "../ps2mp/input";
import { MAX_MULTITAP_PLAYERS, tapsFor } from "./engineRouter";

export type SeatSource = "empty" | "keyboard" | "pad" | "net" | "test";

export interface Seat {
  /** 1-based, as shown to a human. Seat 1 is player one. */
  player: number;
  source: SeatSource;
  /** gamepad index for "pad", peer id for "net" — otherwise undefined */
  ref?: number | string;
  label: string;
}

/** Flat pad index the emulator uses for a 1-based player number. */
export const padIndexFor = (player: number) => player - 1;

/** (port, slot) for a 1-based player, matching the fork's `port * 4 + slot`. */
export function portSlotFor(player: number): { port: number; slot: number } {
  const idx = padIndexFor(player);
  return { port: Math.floor(idx / 4), slot: idx % 4 };
}

export const emptySeats = (): Seat[] =>
  Array.from({ length: MAX_MULTITAP_PLAYERS }, (_, i) => ({
    player: i + 1,
    source: i === 0 ? ("keyboard" as SeatSource) : ("empty" as SeatSource),
    label: i === 0 ? "You (keyboard / pad)" : "Empty",
  }));

/** Seats that will actually drive a pad. */
export const filledSeats = (seats: Seat[]) => seats.filter((s) => s.source !== "empty");

/** How many players to boot with — always at least 1, capped at the ceiling. */
export function playerCount(seats: Seat[]): number {
  const highest = seats.reduce((m, s) => (s.source !== "empty" ? Math.max(m, s.player) : m), 1);
  return Math.min(MAX_MULTITAP_PLAYERS, Math.max(1, highest));
}

/** Human summary of what the emulator will be asked for. */
export function seatSummary(seats: Seat[]): string {
  const n = playerCount(seats);
  const taps = tapsFor(n);
  const tapCount = (taps.port0 ? 1 : 0) + (taps.port1 ? 1 : 0);
  if (!tapCount) return `${n} player${n === 1 ? "" : "s"} · no multitap needed`;
  return `${n} players · ${tapCount} multitap${tapCount === 1 ? "" : "s"}`;
}

// —— synthetic test pad ————————————————————————————————————————————————
/** Milliseconds between a test pad's START presses. */
export const TEST_PERIOD = 1500;
const HOLD = 220;   // how long the button stays down
const STAGGER = 260; // per-seat phase offset, so seats are distinguishable

const NEUTRAL: PadState = { down: [], axes: { lx: 0, ly: 0, rx: 0, ry: 0 } };

/**
 * What a test pad for `player` should be sending at time `t` (ms since start).
 * Pure so it can be tested without timers — see players.test.ts.
 *
 * Pattern: START on the beat (what a "press start" screen wants), and a d-pad
 * nudge on the off-beat so the seat is visible even on a menu that ignores START.
 */
export function testPadState(player: number, t: number): PadState {
  const phase = (t + player * STAGGER) % TEST_PERIOD;
  const down: Action[] = [];
  if (phase < HOLD) down.push("start");
  else if (phase >= TEST_PERIOD / 2 && phase < TEST_PERIOD / 2 + HOLD) {
    // alternate direction per seat so two test pads never look identical
    down.push(player % 2 === 0 ? "dpad_right" : "dpad_left");
  }
  return down.length ? { down, axes: NEUTRAL.axes } : NEUTRAL;
}

export interface TestPad { stop(): void }

/**
 * Run a synthetic pad for `player`, pushing state into `apply` every frame.
 * Releases everything on stop so no button is left stuck down in the emulator.
 */
export function startTestPad(player: number, apply: (s: PadState) => void): TestPad {
  const t0 = performance.now();
  let raf = 0;
  let last = "";
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const s = testPadState(player, performance.now() - t0);
    // only push on change: the injector diffs edges, and hammering it every
    // frame with an identical state is pure waste
    const key = s.down.join(",");
    if (key === last) return;
    last = key;
    apply(s);
  };
  raf = requestAnimationFrame(loop);
  return {
    stop() {
      cancelAnimationFrame(raf);
      apply(NEUTRAL);
    },
  };
}
