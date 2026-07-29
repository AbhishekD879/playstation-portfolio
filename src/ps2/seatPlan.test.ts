// Self-check for the port arithmetic the seat picker draws.
import assert from "node:assert/strict";
import { clampSeats, seatPlan } from "./seatPlan";

assert.equal(clampSeats(0), 1, "never zero seats");
assert.equal(clampSeats(99), 6, "capped at what the fork drives");
assert.equal(clampSeats(3.4), 3);

// ★ two players fit on the console's OWN two ports — no multitap at all, and
// one seat drawn per port rather than two on port 1
const two = seatPlan(2);
assert.deepEqual(two.ports.map((p) => p.seats), [[1], [2]]);
assert.deepEqual(two.ports.map((p) => p.filled), [1, 1]);
assert.equal(two.taps, 0, "a pad in each native port needs no multitap");
assert.equal(two.ports[0].needs, "one pad");

// one player needs no tap anywhere, and port 2 is empty
assert.equal(seatPlan(1).taps, 0);
assert.equal(seatPlan(1).ports[0].needs, "one pad");
assert.equal(seatPlan(1).ports[1].needs, "empty");

// four fills port 1 exactly, port 2 still empty
const four = seatPlan(4);
assert.deepEqual(four.ports.map((p) => p.filled), [4, 0]);
assert.equal(four.taps, 1);

// five spills onto port 2 as a single controller — still one tap
// five spills onto port 2 — the engine registers a tap on both above four, so
// the drawing must not claim otherwise
const five = seatPlan(5);
assert.deepEqual(five.ports.map((p) => p.filled), [4, 1]);
assert.equal(five.taps, 2, "tapsFor() sets both ports above four");

// six needs a tap on both ports
const six = seatPlan(6);
assert.deepEqual(six.ports.map((p) => p.filled), [4, 2]);
assert.equal(six.taps, 2);

// above two, the split is the multitap topology the engine addresses
assert.deepEqual(six.ports[0].seats, [1, 2, 3, 4]);
assert.deepEqual(six.ports[1].seats, [5, 6]);

console.log("seatPlan: port arithmetic ok");
