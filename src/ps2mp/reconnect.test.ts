// Self-check for reconnection rules.
// Run: npx tsx src/ps2mp/reconnect.test.ts
import { strict as assert } from "node:assert";
import { backoffMs, classify, retryLabel, shouldRetry, GONE_ATTEMPTS } from "./reconnect";

// —— classification ——
assert.equal(classify("connected"), "connected");
assert.equal(classify("failed"), "dropped");
assert.equal(classify("disconnected"), "dropped");
assert.equal(classify("signaling closed"), "dropped");
assert.equal(classify("host left"), "gone");
assert.equal(classify("closed"), "closed");
assert.equal(classify("checking"), "connecting");

// —— ★ quitting must never be retried ——
// Otherwise pressing Leave drags you back into the room you just left.
assert.equal(shouldRetry(classify("closed")), false, "an explicit quit is final");
assert.equal(shouldRetry(classify("cancelled")), false);
assert.equal(shouldRetry(classify("connected")), false, "a healthy link is not retried");
assert.equal(shouldRetry(classify("connecting")), false, "still trying is not a failure");

// —— ★ real drops DO retry, including the host vanishing ——
assert.equal(shouldRetry(classify("failed")), true);
assert.equal(shouldRetry(classify("disconnected")), true);
assert.equal(shouldRetry(classify("host left")), true, "a host reloading should heal");

// —— backoff: doubles, then caps, never zero, never unbounded ——
assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(backoffMs), [500, 1000, 2000, 4000, 8000, 8000, 8000]);
assert.ok(backoffMs(0) >= 500, "attempt 0 is clamped, not instant");
assert.ok(backoffMs(1e6) === 8000, "always capped");
for (let n = 1; n < 40; n++) {
  const d = backoffMs(n);
  assert.ok(d >= 500 && d <= 8000, `attempt ${n} in range, got ${d}`);
}
// monotonic up to the cap — never waits LESS after a later failure
for (let n = 2; n <= 5; n++) assert.ok(backoffMs(n) >= backoffMs(n - 1), `attempt ${n} not shorter`);

// —— labels name what happened, and distinguish the two causes ——
assert.match(retryLabel("dropped", 1), /Connection lost/);
assert.match(retryLabel("gone", 1), /Host disconnected/);
assert.match(retryLabel("dropped", 4), /try 4/, "later attempts show the count");
assert.notEqual(retryLabel("gone", 2), retryLabel("dropped", 2), "causes read differently");

console.log("reconnect: retry rules ok");

// —— a host who quits must end the session, not hang it ——
// The room dies with its host, so the retry lands on "no such room". That used
// to classify as "connecting": no retry, no report, and a joiner left staring
// at a frozen frame that looked like a live game.
assert.equal(classify("error: no such room"), "gone", "a hostless room is gone, not connecting");
assert.equal(classify("error: room full"), "gone", "no seat to come back to");
assert.equal(shouldRetry("gone", 1), true, "a reloading host is worth a short wait");
assert.equal(shouldRetry("gone", GONE_ATTEMPTS), false, "but not an unbounded one");
assert.equal(shouldRetry("dropped", 99), true, "a network blip always keeps trying");
assert.match(retryLabel("gone", GONE_ATTEMPTS), /closed the room/, "the last word says it is over");
console.log("host-quit path OK");
