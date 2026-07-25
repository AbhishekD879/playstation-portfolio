// Self-check for the PS2 seat model + synthetic test pads.
// Run: npx tsx src/ps2/players.test.ts
//
// The test pads are how we verify a 6-player game actually sees six controllers
// without owning six controllers, so they have to be right: distinguishable per
// seat, and never leaving a button stuck down.
import { strict as assert } from "node:assert";
import {
  TEST_PERIOD, emptySeats, filledSeats, padIndexFor, playerCount,
  portSlotFor, seatSummary, testPadState, type Seat,
} from "./players";

// —— seat -> (port, slot) matches the fork's port*4 + slot ——
assert.deepEqual(portSlotFor(1), { port: 0, slot: 0 });
assert.deepEqual(portSlotFor(4), { port: 0, slot: 3 }, "player 4 fills port 0's last slot");
assert.deepEqual(portSlotFor(5), { port: 1, slot: 0 }, "player 5 spills to port 1");
assert.deepEqual(portSlotFor(6), { port: 1, slot: 1 });
for (let p = 1; p <= 6; p++) {
  const { port, slot } = portSlotFor(p);
  assert.equal(port * 4 + slot, padIndexFor(p), `player ${p} round-trips`);
}

// —— default seating: player one only ——
{
  const s = emptySeats();
  assert.equal(s.length, 6);
  assert.equal(s[0].source, "keyboard");
  assert.equal(filledSeats(s).length, 1);
  assert.equal(playerCount(s), 1);
}

// —— player count follows the HIGHEST filled seat, not the count ——
// Someone seated in slot 4 with 2 and 3 empty still needs a 4-pad boot, or the
// emulator would never address them.
{
  const s = emptySeats();
  s[3].source = "test";
  assert.equal(filledSeats(s).length, 2, "two seats occupied");
  assert.equal(playerCount(s), 4, "but the emulator must be booted for four");
}

// —— count is clamped and never zero ——
{
  const s = emptySeats().map((x) => ({ ...x, source: "empty" as const })) as Seat[];
  assert.equal(playerCount(s), 1, "an empty table still boots one player");
  const full = emptySeats().map((x) => ({ ...x, source: "test" as const })) as Seat[];
  assert.equal(playerCount(full), 6);
}

// —— summary reports the taps the router will ask for ——
{
  const s = emptySeats();
  assert.ok(seatSummary(s).includes("no multitap"), "one player needs no tap");
  s[2].source = "test";
  assert.ok(seatSummary(s).includes("1 multitap"), "3 players = one tap");
  s[5].source = "test";
  assert.ok(seatSummary(s).includes("2 multitaps"), "6 players = two taps");
}

// —— ★ test pads press START, so a controller-select screen registers them ——
{
  let sawStart = false;
  for (let t = 0; t < TEST_PERIOD * 2; t += 20) {
    if (testPadState(1, t).down.includes("start")) { sawStart = true; break }
  }
  assert.ok(sawStart, "a test pad must press START within two cycles");
}

// —— ★ seats are phase-offset, so two test pads are never identical ——
// If they fired together you could not tell on screen which slot was which.
{
  let differed = false;
  for (let t = 0; t < TEST_PERIOD; t += 10) {
    const a = testPadState(1, t).down.join(",");
    const b = testPadState(2, t).down.join(",");
    if (a !== b) { differed = true; break }
  }
  assert.ok(differed, "seats 1 and 2 must not press in lockstep");
}

// —— every seat gets input, and only ever valid actions ——
const VALID = new Set(["start", "dpad_left", "dpad_right"]);
for (let p = 1; p <= 6; p++) {
  let pressed = 0;
  for (let t = 0; t < TEST_PERIOD * 2; t += 10) {
    const st = testPadState(p, t);
    for (const a of st.down) assert.ok(VALID.has(a), `seat ${p} emitted unexpected action ${a}`);
    if (st.down.length) pressed++;
  }
  assert.ok(pressed > 0, `seat ${p} never presses anything`);
}

// —— ★ a test pad always returns to neutral: no stuck buttons ——
// A button left down would look like a wedged controller in-game.
for (let p = 1; p <= 6; p++) {
  let neutralFrames = 0;
  for (let t = 0; t < TEST_PERIOD; t += 10) {
    if (testPadState(p, t).down.length === 0) neutralFrames++;
  }
  assert.ok(neutralFrames > 0, `seat ${p} must release between presses`);
}

// —— axes are always centred: a test pad drives buttons only ——
for (let p = 1; p <= 6; p++) {
  for (let t = 0; t < TEST_PERIOD; t += 50) {
    const { axes } = testPadState(p, t);
    assert.deepEqual(axes, { lx: 0, ly: 0, rx: 0, ry: 0 }, `seat ${p} must not drift its sticks`);
  }
}

// —— deterministic: same input, same output (so a bug is reproducible) ——
assert.deepEqual(testPadState(3, 777), testPadState(3, 777));
assert.deepEqual(testPadState(3, 777), testPadState(3, 777 + TEST_PERIOD), "pattern is periodic");

console.log("players: seats + test pads ok");
