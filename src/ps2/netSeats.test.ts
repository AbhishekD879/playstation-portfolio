// Self-check for remote pad assignment.
// Run: npx tsx src/ps2/netSeats.test.ts
import { strict as assert } from "node:assert";
import { freedPads, reconcileSeats, remoteSlots, type SeatMap } from "./netSeats";

const m = (o: Record<string, number> = {}): SeatMap => new Map(Object.entries(o));
const obj = (s: SeatMap) => Object.fromEntries([...s.entries()].sort());

// —— arrival order fills 1,2,3… (0 is the host) ——
assert.deepEqual(obj(reconcileSeats(m(), ["a"], 6)), { a: 1 });
assert.deepEqual(obj(reconcileSeats(m(), ["a", "b", "c"], 6)), { a: 1, b: 2, c: 3 });

// —— ★ existing joiners KEEP their pad when someone else joins ——
// Otherwise everyone swaps wrestlers whenever a friend connects.
{
  const s1 = reconcileSeats(m(), ["a", "b"], 6);
  const s2 = reconcileSeats(s1, ["a", "b", "c"], 6);
  assert.equal(s2.get("a"), 1, "a keeps pad 1");
  assert.equal(s2.get("b"), 2, "b keeps pad 2");
  assert.equal(s2.get("c"), 3);
}

// —— ★ a leaver's pad is reused, and nobody else moves ——
{
  const s1 = reconcileSeats(m(), ["a", "b", "c"], 6);   // 1,2,3
  const s2 = reconcileSeats(s1, ["a", "c"], 6);          // b leaves
  assert.equal(s2.get("a"), 1); assert.equal(s2.get("c"), 3, "c must NOT slide down to 2");
  const s3 = reconcileSeats(s2, ["a", "c", "d"], 6);     // d takes the hole
  assert.equal(s3.get("d"), 2, "lowest free pad is reused");
  assert.equal(s3.get("c"), 3, "c still unmoved");
}

// —— ★ never two joiners on one pad, at any size ——
for (const n of [1, 2, 3, 5, 9]) {
  const ids = Array.from({ length: n }, (_, i) => "p" + i);
  const s = reconcileSeats(m(), ids, 6);
  const pads = [...s.values()];
  assert.equal(new Set(pads).size, pads.length, `n=${n}: pads must be unique`);
  assert.ok(pads.every((p) => p >= 1 && p <= 5), `n=${n}: pads stay in 1..5`);
}

// —— over capacity: extra joiners get NO pad rather than doubling up ——
{
  const s = reconcileSeats(m(), ["a", "b", "c", "d", "e", "f", "g"], 6);
  assert.equal(s.size, 5, "only five remote pads exist");
  assert.equal(new Set(s.values()).size, 5);
}

// —— capacity follows the host's player count ——
assert.equal(remoteSlots(1), 0, "solo host has no remote slots");
assert.equal(remoteSlots(2), 1);
assert.equal(remoteSlots(6), 5);
assert.equal(remoteSlots(99), 5, "clamped");
{
  const s = reconcileSeats(m(), ["a", "b", "c"], remoteSlots(3) + 1);
  assert.equal(s.size, 2, "3 players = host + 2 remotes");
}

// —— freed pads are reported so their injectors can be released ——
{
  const s1 = reconcileSeats(m(), ["a", "b", "c"], 6);
  const s2 = reconcileSeats(s1, ["a"], 6);
  assert.deepEqual(freedPads(s1, s2), [2, 3]);
  assert.deepEqual(freedPads(s1, s1), [], "no churn, nothing freed");
}

// —— empty room is stable ——
assert.equal(reconcileSeats(m({ a: 1 }), [], 6).size, 0);

console.log("netSeats: remote pad assignment ok");
