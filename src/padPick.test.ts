// Self-check for player one's pad selection.
// Run: npx tsx src/gamepadBridge.test.ts
//
// This exists because a stale co-op lock silently killed player one's input
// across every game, with no error and nothing on screen. The invariant worth
// protecting is narrow: if ANY pad is connected, player one gets one.
import { strict as assert } from "node:assert";
import { pickPad } from "./padPick";

const pad = (index: number) => ({ index });

// —— no lock: first pad drives player one ——
assert.equal(pickPad([pad(0), pad(1)], null)?.index, 0);
assert.equal(pickPad([pad(3)], null)?.index, 3, "index need not be zero-based");

// —— lock honoured when the pad is present ——
assert.equal(pickPad([pad(0), pad(1)], 1)?.index, 1, "co-op lock still works");
assert.equal(pickPad([pad(2), pad(5)], 5)?.index, 5);

// —— ★ the regression: a lock matching nothing must NOT silence player one ——
assert.equal(pickPad([pad(0)], 7)?.index, 0, "stale lock falls back, never returns null");
assert.equal(pickPad([pad(3), pad(4)], 0)?.index, 3, "unplugged locked pad falls back");

// —— genuinely no pads: null is correct (nothing to drive) ——
assert.equal(pickPad([], null), null);
assert.equal(pickPad([], 2), null, "no pads + a lock is still just no pads");

// —— ★ the invariant, stated directly ——
// For any pad list and ANY lock value, a connected pad always yields a pad.
for (const pads of [[pad(0)], [pad(0), pad(1)], [pad(2), pad(9)]]) {
  for (const lock of [null, -1, 0, 1, 2, 9, 99]) {
    assert.ok(pickPad(pads, lock), `pads=${pads.map((p) => p.index)} lock=${lock} must yield a pad`);
  }
}

console.log("padPick: player one always gets a pad ok");
