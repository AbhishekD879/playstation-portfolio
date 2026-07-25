// Self-check for PS2 engine routing. Run: npx tsx src/ps2/engineRouter.test.ts
//
// The rule that matters: a 1-2 player session must NEVER be sent to the fork.
// That is the entire safety guarantee of the dual-binary design — if routing
// leaks small sessions onto the experimental engine, the "nothing existing
// breaks" promise is gone, and it would fail silently for most users.
import { strict as assert } from "node:assert";
import { MAX_MULTITAP_PLAYERS, STOCK_PLAYERS, chooseEngine, tapsFor } from "./engineRouter";

// —— ★ small sessions stay on the proven engine ——
for (const n of [1, 2]) {
  const c = chooseEngine(n);
  assert.equal(c.engine, "stock", `${n} player(s) must use the stock engine`);
  assert.equal(c.players, n);
}

// —— sessions that need extra pads go to the fork ——
for (const n of [3, 4, 5, 6]) {
  const c = chooseEngine(n);
  assert.equal(c.engine, "multitap", `${n} players needs the multitap engine`);
  assert.equal(c.players, n);
}

// —— explicit preference wins, and stock stays capped at 2 ——
assert.equal(chooseEngine(6, "stock").engine, "stock");
assert.equal(chooseEngine(6, "stock").players, STOCK_PLAYERS, "stock can never carry 6");
assert.equal(chooseEngine(1, "multitap").engine, "multitap", "explicit multitap is honoured");

// —— clamping: nothing escapes the hardware ceiling ——
assert.equal(chooseEngine(99).players, MAX_MULTITAP_PLAYERS);
assert.equal(chooseEngine(0).players, 1);
assert.equal(chooseEngine(-5).players, 1);
assert.equal(chooseEngine(3.6).players, 4, "rounds rather than producing a fractional pad");
assert.equal(chooseEngine(NaN).players, 1, "NaN must not become a fractional or huge count");

// —— tap allocation matches the hardware: 4 slots per port ——
assert.deepEqual(tapsFor(2), { port0: false, port1: false }, "2 players needs no tap");
assert.deepEqual(tapsFor(3), { port0: true, port1: false });
assert.deepEqual(tapsFor(4), { port0: true, port1: false }, "4 fits in one tap");
assert.deepEqual(tapsFor(5), { port0: true, port1: true }, "5 spills onto the second port");
assert.deepEqual(tapsFor(6), { port0: true, port1: true });

// —— a tapped port supplies 4 pads; an untapped one supplies 1 ——
// This mirrors getMultitapPadCount() in the wasm; if the two ever disagree, the
// UI would offer seats the emulator cannot address.
const padCapacity = (players: number) => {
  const t = tapsFor(players);
  if (!t.port0 && !t.port1) return 2;
  return (t.port0 ? 4 : 1) + (t.port1 ? 4 : 1);
};
for (const n of [3, 4, 5, 6]) {
  assert.ok(padCapacity(n) >= n, `${n} players needs >= ${n} addressable pads, got ${padCapacity(n)}`);
}
assert.equal(padCapacity(2), 2);
assert.equal(padCapacity(4), 5);
assert.equal(padCapacity(6), 8);

// —— every choice carries a human-readable reason ——
for (const n of [1, 2, 3, 6]) {
  assert.ok(chooseEngine(n).reason.length > 0, "a routing decision must explain itself");
}

console.log("engineRouter: routing ok");
