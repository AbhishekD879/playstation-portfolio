// The bug this exists to stop: a transient "disconnected" being treated as a
// real drop, so a wifi hiccup that WebRTC would have healed in a second got
// torn down by both ends at once. Everything below is about the line between
// "wait" and "give up".
import assert from "node:assert/strict";
const { watchLink, GRACE_MS } = await import("./linkHealth.ts");

// A fake connection plus a fake clock, because the real grace is eight seconds
// and no test should wait that long to learn anything.
function rig(opts = {}) {
  const pc = { connectionState: "new" };
  const log = [];
  let pending = null;
  const w = watchLink(pc, {
    onWobble: () => log.push("wobble"),
    onRestored: () => log.push("restored"),
    onLost: () => log.push("lost"),
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
    ...opts,
  });
  return {
    pc, log, w,
    to: (s) => { pc.connectionState = s; return w.update(); },
    fire: () => { const f = pending; pending = null; f?.(); },
    armed: () => pending !== null,
  };
}

// —— the whole point: a wobble that heals is not a drop ————————————————————
{
  const r = rig();
  assert.equal(r.to("connecting"), "connected", "nothing to judge yet");
  assert.equal(r.to("connected"), "connected");
  assert.deepEqual(r.log, [], "a first connect is not a restoration");

  assert.equal(r.to("disconnected"), "wobbling");
  assert.ok(r.armed(), "the grace timer is running");
  assert.deepEqual(r.log, ["wobble"], "reported, not acted on");

  assert.equal(r.to("connected"), "connected", "ICE healed it, as it usually does");
  assert.equal(r.armed(), false, "and the timer is cancelled");
  assert.deepEqual(r.log, ["wobble", "restored"], "never lost");
}

// —— a wobble that does not heal is a drop ————————————————————————————————
{
  const r = rig();
  r.to("connected");
  r.to("disconnected");
  r.fire();                       // grace expires, still disconnected
  assert.deepEqual(r.log, ["wobble", "lost"]);
}

// —— healed by the time the timer fires, with no event in between ——————————
// The state can settle without another change reaching us, so expiry re-reads
// rather than trusting what it saw when it was armed.
{
  const r = rig();
  r.to("connected");
  r.to("disconnected");
  r.pc.connectionState = "connected";   // healed quietly
  r.fire();
  assert.deepEqual(r.log, ["wobble", "restored"], "re-read at expiry, not assumed lost");
}

// —— terminal states are acted on at once ————————————————————————————————
for (const terminal of ["failed", "closed"]) {
  const r = rig();
  r.to("connected");
  assert.equal(r.to(terminal), "lost", `${terminal} is terminal`);
  assert.deepEqual(r.log, ["lost"], "no grace, no wobble");
  assert.equal(r.armed(), false);
}

// a wobble that turns into failure does not wait out the rest of the grace
{
  const r = rig();
  r.to("connected");
  r.to("disconnected");
  r.to("failed");
  assert.deepEqual(r.log, ["wobble", "lost"]);
  assert.equal(r.armed(), false, "the pending timer is cleared");
}

// —— lost is reported exactly once ————————————————————————————————————————
{
  const r = rig();
  r.to("connected");
  r.to("failed");
  r.to("closed");
  r.to("disconnected");
  r.fire();
  assert.deepEqual(r.log, ["lost"], "one departure per peer, whatever the state does after");
}

// —— repeated wobbles arm one timer, not one per event ————————————————————
{
  const r = rig();
  r.to("connected");
  r.to("disconnected");
  r.to("disconnected");
  r.to("disconnected");
  assert.deepEqual(r.log, ["wobble"], "one report per wobble, not per event");
  r.fire();
  assert.deepEqual(r.log, ["wobble", "lost"]);
}

// —— a deliberate teardown stops everything ————————————————————————————————
{
  const r = rig();
  r.to("connected");
  r.to("disconnected");
  r.w.cancel();
  assert.equal(r.armed(), false, "no timer left to fire after we stopped");
  r.to("failed");
  assert.deepEqual(r.log, ["wobble"], "we quit — that is not a drop to report");
}

// —— the grace outlasts ICE's own recovery, and is not silly-long ——————————
assert.ok(GRACE_MS >= 4000, "ICE usually recovers inside a couple of seconds — leave room");
assert.ok(GRACE_MS <= 15000, "a dead session must not leave someone on a frozen frame for long");

// —— the wobble status must not read as a drop to the reconnect classifier ——
// This is the joiner half of the same bug: classify() turns anything with
// "disconnect" in it into "dropped", which starts a reconnect cycle.
const { classify, shouldRetry } = await import("./reconnect.ts");
assert.equal(classify("connection unstable"), "connecting", "a wobble must not read as dropped");
assert.equal(shouldRetry(classify("connection unstable")), false, "and must not start a reconnect");
assert.equal(classify("disconnected"), "dropped", "a real drop still does");
assert.equal(shouldRetry(classify("disconnected")), true);

console.log("linkHealth ok · grace", GRACE_MS, "ms");
