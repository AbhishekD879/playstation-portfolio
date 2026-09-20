// Turning the emulator's raw counters into a reading.
//
// Every counter the engine exports is CUMULATIVE — total frames presented,
// total microseconds charged to the EE, total ms the browser spent compiling
// JIT blocks. None is a rate, and none means anything on its own. Two samples
// and the wall-clock gap between them is what turns "4127ms of EE since boot"
// into "the CPU is 71% of this second", the only form the number is useful in.
//
// Kept separate from the panel because it is the part that can be wrong in a
// way nobody would notice: a divide-by-zero on a paused VM, or a percentage
// split computed against the wrong denominator, reads as a plausible number
// rather than as a bug.

/** NTSC field rate. Speed is measured against this, not against the host's
 *  refresh: a 30fps game at full speed and a 60fps game at half speed present
 *  the same number of frames and are completely different problems. */
export const NTSC_HZ = 59.94;

// Every zone the engine profiles. They are EXCLUSIVE — the emulator charges
// elapsed time to the zone already running before entering a new one — so VU
// time is NOT inside EE's, and a split that listed only the first five would
// silently hide the vector and transfer units. Order is the order they are
// shown in.
export const ZONES = ["ee", "vu", "vif", "gif", "iop", "spu", "gssync", "other"] as const;
export type Zone = (typeof ZONES)[number];

/** What one poll of the module reads. All cumulative; `t` is performance.now(). */
export interface Counters {
  t: number;
  frames: number;
  vblanks: number;
  /** Cumulative MICROseconds per profiler zone. -1 on a build without PROFILE.
   *  Microseconds because the engine's own counter is nanoseconds divided by a
   *  thousand — it was named "ms" in the emulator and was not ms. */
  prof: Record<Zone, number>;
  /** Cumulative JIT totals. Always present — these are not behind PROFILE. */
  jit: { blocks: number; live: number; bytes: number; ms: number };
}

export interface ZoneShare {
  zone: Zone;
  /** Microseconds charged to this zone during the interval. */
  us: number;
  /** Share of all profiled time in the interval, 0–100. */
  pct: number;
}

export interface JitReading {
  /** Blocks compiled during the interval. */
  compiled: number;
  /** Blocks still resident. Unbounded by design — worth watching. */
  live: number;
  /** Generated wasm handed to the browser during the interval, KB/s. */
  kbPerSec: number;
  /** Wall time lost to WebAssembly.Module/Instance during the interval, as a
   *  share of the interval, 0–100. This is the number that says whether
   *  recompilation is the stutter. */
  pctOfWall: number;
}

export interface Reading {
  fps: number;
  /** Emulated speed against a real PS2's field rate, in percent. */
  speed: number;
  /** null when the build has no profiler, so the panel can say which it is
   *  rather than showing a row of zeroes. */
  split: ZoneShare[] | null;
  jit: JitReading;
}

/** A build without PROFILE returns -1.0 from every zone getter. */
const profiled = (prof: Record<Zone, number>) => ZONES.every((z) => prof[z] >= 0);

/**
 * Two samples into a reading, or null when they cannot make one.
 *
 * Returns null rather than zeroes when the interval is empty or any cumulative
 * counter went BACKWARDS. Backwards means the VM was rebuilt under us — booting
 * a disc resets the counters — and treating that as a delta would report a
 * wild negative rate as though it were a measurement.
 */
export function read(prev: Counters, now: Counters): Reading | null {
  const dt = (now.t - prev.t) / 1000;
  if (!(dt > 0)) return null;
  if (now.frames < prev.frames || now.vblanks < prev.vblanks) return null;
  if (now.jit.blocks < prev.jit.blocks || now.jit.ms < prev.jit.ms) return null;

  let split: ZoneShare[] | null = null;
  if (profiled(prev.prof) && profiled(now.prof)) {
    const us = ZONES.map((zone) => ({ zone, us: now.prof[zone] - prev.prof[zone] }));
    // A zone going backwards is the same reset signal as the frame counters.
    if (us.some((z) => z.us < 0)) return null;
    const total = us.reduce((a, z) => a + z.us, 0);
    // A paused VM charges nothing anywhere. Report the zeroes rather than
    // dividing by them — "everything is 0" is a true and useful reading.
    split = us.map((z) => ({ ...z, pct: total > 0 ? (z.us / total) * 100 : 0 }));
  }

  const jitMs = now.jit.ms - prev.jit.ms;
  return {
    fps: Math.max(0, (now.frames - prev.frames) / dt),
    speed: Math.max(0, ((now.vblanks - prev.vblanks) / dt / NTSC_HZ) * 100),
    split,
    jit: {
      compiled: now.jit.blocks - prev.jit.blocks,
      live: now.jit.live,
      kbPerSec: Math.max(0, (now.jit.bytes - prev.jit.bytes) / 1024 / dt),
      pctOfWall: Math.max(0, (jitMs / (dt * 1000)) * 100),
    },
  };
}

/**
 * Read the counters off a module handle, or null if it is not an engine that
 * exports them. The native build has none of these; the shared core has the
 * JIT ones but not the profiler, which `read` detects from the -1s.
 */
export function sample(mod: unknown, at: number): Counters | null {
  const m = mod as Record<string, undefined | (() => number)>;
  if (!m || typeof m.getFrameCount !== "function" || typeof m.getVblankCount !== "function") {
    return null;
  }
  // Every getter is guarded rather than assumed: these builds are deployed by
  // hand into gitignored directories, so a stale one with a smaller set of
  // bindings is a normal thing to meet, not a corrupt install.
  const num = (name: string, fallback: number) => {
    const fn = m[name];
    if (typeof fn !== "function") return fallback;
    const v = fn();
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    t: at,
    frames: num("getFrameCount", 0),
    vblanks: num("getVblankCount", 0),
    prof: {
      ee: num("getProfEe", -1),
      iop: num("getProfIop", -1),
      spu: num("getProfSpu", -1),
      gssync: num("getProfGsSync", -1),
      other: num("getProfOther", -1),
      // A core built before these existed reports -1, which reads as "this
      // build has no profiler" — correct, because its split would be wrong.
      vu: num("getProfVu", -1),
      vif: num("getProfVif", -1),
      gif: num("getProfGif", -1),
    },
    jit: {
      blocks: num("getJitBlocksCompiled", 0),
      live: num("getJitBlocksLive", 0),
      bytes: num("getJitCodeBytes", 0),
      ms: num("getJitCompileMs", 0),
    },
  };
}

/** What each zone is, in the terms a reader can act on. */
export const ZONE_LABEL: Record<Zone, string> = {
  ee: "CPU",
  vu: "Vector units",
  vif: "Vector feed",
  gif: "GPU feed",
  iop: "I/O chip",
  spu: "Sound",
  gssync: "GPU wait",
  other: "Other",
};
