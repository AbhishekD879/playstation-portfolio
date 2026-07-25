// Self-check for the clip ring trim. Run: npx tsx src/capture.test.ts
// Only trimWindow is covered — it's the one piece whose failure mode is silent
// (a clip that muxes fine and then plays as garbage) rather than an exception.
import { strict as assert } from "node:assert";
import { trimWindow, type Chunk } from "./capture";

const S = 1e6;
/** frames at 30fps, keyframe every 30 — the real encoder's cadence */
const ring = (seconds: number): Chunk[] =>
  Array.from({ length: seconds * 30 }, (_, i) => ({
    data: new Uint8Array(1), key: i % 30 === 0, ts: Math.round((i / 30) * S),
  }));

// 1. always starts on a keyframe, whatever the window
for (const w of [1, 5, 15, 60]) {
  const out = trimWindow(ring(30), w * S);
  assert.ok(out.length && out[0].key, `window ${w}s must start on a keyframe`);
}

// 2. covers at least the requested window (we round outward to the keyframe
//    before the cutoff, so slightly more is correct, less is a bug)
const got = trimWindow(ring(30), 15 * S);
const span = (got[got.length - 1].ts - got[0].ts) / S;
assert.ok(span >= 15, `span ${span}s must cover the full 15s window`);
assert.ok(span < 16, `span ${span}s must not over-collect a whole extra GOP`);

// 3. buffer shorter than the window → return everything from the first keyframe
const short = trimWindow(ring(4), 15 * S);
assert.equal(short.length, 4 * 30);
assert.ok(short[0].key);

// 4. degenerate inputs don't throw
assert.deepEqual(trimWindow([], 15 * S), []);
assert.deepEqual(trimWindow([{ data: new Uint8Array(1), key: false, ts: 0 }], 15 * S), []); // no keyframe = nothing decodable

// 5. the tail is preserved exactly — a clip must end on the newest frame
const full = ring(30);
assert.equal(trimWindow(full, 15 * S).at(-1)!.ts, full.at(-1)!.ts);

console.log("capture: trimWindow ok");
