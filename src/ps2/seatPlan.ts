// How N players land on a PS2's two controller ports.
//
// A PS2 has TWO ports; a multitap fans one port into four slots. So players 1–4
// live on port 1 and players 5–6 on port 2 — the same split portSlotFor()
// computes for the emulator. The seat picker draws that split, and this is the
// arithmetic behind the drawing: which seats exist, which are taken, and which
// physical hardware each side of the gap needs.
//
// Pure on purpose. The picker is then a dumb rendering of this, which is what
// makes the port story testable without a browser.

import { MAX_MULTITAP_PLAYERS, tapsFor } from "./engineRouter";

/** Seats on one port. */
export interface PortPlan {
  /** 1-based player numbers on this port, always four then two */
  seats: number[];
  /** how many of them the current count fills */
  filled: number;
  /** what this port needs to work, in words a person can act on */
  needs: string;
}

export interface SeatPlan {
  count: number;
  ports: [PortPlan, PortPlan];
  /** multitaps required in total */
  taps: number;
}

/** Clamp to what the fork can actually drive. */
export const clampSeats = (n: number) =>
  Math.max(1, Math.min(MAX_MULTITAP_PLAYERS, Math.round(n) || 1));

export function seatPlan(count: number): SeatPlan {
  const n = clampSeats(count);
  // ★ The split is NOT always 4|2. Two players sit on the console's own two
  // ports with a controller each and no multitap — which is what tapsFor()
  // already encodes for the engine, and what the old copy on this screen said.
  // Above two, a multitap on port 1 carries players 1–4 and port 2 takes 5–6,
  // matching the fork's `port * 4 + slot` addressing.
  const tap = tapsFor(n);
  const split: [number[], number[]] = n <= 2 ? [[1], [2]] : [[1, 2, 3, 4], [5, 6]];

  const port = (seats: number[], needsTap: boolean): PortPlan => {
    const filled = seats.filter((p) => p <= n).length;
    return {
      seats,
      filled,
      // Say what this side of the gap needs in words someone can act on. A port
      // with one pad on it is just a controller; a multitap is what more than
      // one player on the SAME port is for.
      needs: filled === 0 ? "empty" : needsTap ? "multitap" : "one pad",
    };
  };
  const ports: [PortPlan, PortPlan] = [port(split[0], tap.port0), port(split[1], tap.port1)];
  return { count: n, ports, taps: [tap.port0, tap.port1].filter(Boolean).length };
}
