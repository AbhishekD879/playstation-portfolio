// The counter maths. Part of `npm test`.
//
// Worth its own file because every failure mode here produces a PLAUSIBLE
// number rather than an error: a reset counter read as a delta, a percentage
// divided by an empty interval, a build with no profiler reporting five zeroes
// as though it had measured them. None of those throw, and all of them would be
// believed.
import { strict as assert } from "node:assert";
import { read, sample, type Counters } from "./enginePerf.ts";

const base = (over: Partial<Counters> = {}): Counters => ({
  t: 0,
  frames: 0,
  vblanks: 0,
  prof: { ee: 0, vu: 0, vif: 0, gif: 0, iop: 0, spu: 0, gssync: 0, other: 0 },
  jit: { blocks: 0, live: 0, bytes: 0, ms: 0 },
  ...over,
});

// —— rates ————————————————————————————————————————————————————————————————
{
  // One second, 30 frames presented, 30 fields: a 30fps game running at half a
  // real PS2's pace.
  const r = read(base(), base({ t: 1000, frames: 30, vblanks: 30 }))!;
  assert.ok(r, "two good samples make a reading");
  assert.equal(Math.round(r.fps), 30);
  assert.equal(Math.round(r.speed), 50);
}
{
  // Half a second must double the rate, not report the raw difference.
  const r = read(base(), base({ t: 500, frames: 30 }))!;
  assert.equal(Math.round(r.fps), 60);
}

// —— a reset must not read as a measurement ————————————————————————————————
{
  // Booting a disc rebuilds the VM and zeroes the counters. Subtracting across
  // that gives a large negative delta, which would render as a wild rate.
  const prev = base({ frames: 5000, vblanks: 5000 });
  assert.equal(read(prev, base({ t: 1000 })), null, "frame counter going backwards is a reset");
}
{
  const prev = base({ jit: { blocks: 900, live: 900, bytes: 9e6, ms: 400 } });
  assert.equal(read(prev, base({ t: 1000 })), null, "JIT counter going backwards is a reset");
}
{
  const prev = base({ prof: { ee: 900, vu: 5, vif: 5, gif: 5, iop: 5, spu: 5, gssync: 5, other: 5 } });
  const now = base({ t: 1000, prof: { ee: 10, vu: 6, vif: 6, gif: 6, iop: 6, spu: 6, gssync: 6, other: 6 } });
  assert.equal(read(prev, now), null, "a zone going backwards is a reset");
}
{
  // Two samples taken in the same millisecond, or out of order.
  assert.equal(read(base(), base({ t: 0 })), null, "an empty interval is not a reading");
  assert.equal(read(base({ t: 100 }), base({ t: 50 })), null, "time going backwards is not a reading");
}

// —— the profiler split ————————————————————————————————————————————————————
{
  const prev = base();
  const now = base({
    t: 1000,
    prof: { ee: 300, vu: 200, vif: 50, gif: 50, iop: 100, spu: 200, gssync: 50, other: 50 },
  });
  const r = read(prev, now)!;
  assert.ok(r.split, "a profiled build reports a split");
  const by = Object.fromEntries(r.split!.map((z) => [z.zone, Math.round(z.pct)]));
  assert.deepEqual(by, { ee: 30, vu: 20, vif: 5, gif: 5, iop: 10, spu: 20, gssync: 5, other: 5 });
  assert.ok(
    r.split!.some((z) => z.zone === "vu" && z.pct > 0),
    "the vector units get their own share — the zones are exclusive, so VU time is " +
      "NOT inside EE's, and dropping it would hide the work a SIMD flag moves",
  );
  assert.equal(
    Math.round(r.split!.reduce((a, z) => a + z.pct, 0)),
    100,
    "the shares are of the profiled total, so they add to 100",
  );
}
{
  // The shared core has no PROFILE, and every zone getter returns -1. That is
  // "this build cannot say", which must not render as "nothing used any time".
  const off = { ee: -1, vu: -1, vif: -1, gif: -1, iop: -1, spu: -1, gssync: -1, other: -1 };
  const r = read(base({ prof: off }), base({ t: 1000, frames: 60, vblanks: 60, prof: off }))!;
  assert.equal(r.split, null, "an unprofiled build reports no split, not zeroes");
  assert.equal(Math.round(r.fps), 60, "but it still reports the rates it does have");
}
{
  // A paused VM charges nothing anywhere. Zeroes are the honest answer; NaN
  // from dividing by the empty total is not.
  const r = read(base(), base({ t: 1000 }))!;
  assert.ok(r.split);
  for (const z of r.split!) assert.equal(z.pct, 0, `${z.zone} is 0%, not NaN`);
}

// —— JIT ——————————————————————————————————————————————————————————————————
{
  // 250 ms of a 1 s interval spent inside WebAssembly.Module is a quarter of
  // the wall clock gone to recompiling — the number that says whether
  // recompilation is the stutter.
  const now = base({ t: 1000, jit: { blocks: 40, live: 1200, bytes: 512 * 1024, ms: 250 } });
  const r = read(base(), now)!;
  assert.equal(r.jit.compiled, 40);
  assert.equal(r.jit.live, 1200, "live is a level, not a rate — reported as-is");
  assert.equal(Math.round(r.jit.kbPerSec), 512);
  assert.equal(Math.round(r.jit.pctOfWall), 25);
}

// —— reading the module ————————————————————————————————————————————————————
{
  assert.equal(sample(null, 0), null, "no module, no sample");
  assert.equal(sample({}, 0), null, "a module without the counters is not an engine we can read");
}
{
  // A variant deployed by hand may be an older build with fewer bindings. That
  // is a normal thing to meet, not a crash: the getters it does have still read.
  const partial = { getFrameCount: () => 10, getVblankCount: () => 12 };
  const s = sample(partial, 5)!;
  assert.ok(s, "a build with only the frame counters still samples");
  assert.equal(s.frames, 10);
  assert.equal(s.prof.ee, -1, "a missing profiler getter reads as absent, not as zero");
  assert.equal(s.jit.blocks, 0, "a missing JIT getter reads as zero, which is its true floor");
}
{
  // A core built before the vector zones were collected: five getters answer,
  // three are missing. Its split would be wrong, so it must read as unprofiled
  // rather than as a plausible five-zone breakdown.
  const older = {
    getFrameCount: () => 60, getVblankCount: () => 60,
    getProfEe: () => 8, getProfIop: () => 1, getProfSpu: () => 2,
    getProfGsSync: () => 3, getProfOther: () => 1,
  };
  const s1 = sample(older, 0)!, s2 = sample(older, 1000)!;
  assert.equal(s1.prof.vu, -1, "a missing vector getter reads as absent");
  assert.equal(read(s1, s2)!.split, null,
    "and one absent zone makes the whole split unavailable, not partly wrong");
}
{
  const full = {
    getFrameCount: () => 60, getVblankCount: () => 60,
    getProfEe: () => 8, getProfIop: () => 1, getProfSpu: () => 2,
    getProfGsSync: () => 3, getProfOther: () => 1,
    getProfVu: () => 4, getProfVif: () => 1, getProfGif: () => 1,
    getJitBlocksCompiled: () => 7, getJitBlocksLive: () => 7,
    getJitCodeBytes: () => 2048, getJitCompileMs: () => 4,
  };
  const s = sample(full, 1)!;
  assert.equal(s.prof.gssync, 3);
  assert.equal(s.jit.bytes, 2048);
}
{
  // An embind getter that throws its way to NaN must not poison the delta.
  const nan = { getFrameCount: () => 1, getVblankCount: () => 1, getJitCompileMs: () => NaN };
  assert.equal(sample(nan, 0)!.jit.ms, 0, "a non-finite counter falls back rather than spreading NaN");
}

console.log("enginePerf: ok");
