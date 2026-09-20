// Engine speed variants: one wasm build per compiler lever, so a speed change
// can be attributed to a flag instead of to luck.
//
// The wasm core had been built the same way since it first worked —
// `-fexceptions -pthread -O3` — with three levers never tried. Each is a build,
// not a setting: they change how the C++ is compiled, so there is nothing to
// toggle at runtime and no way to A/B them inside one binary.
//
//   WASM_EH   Emscripten's default -fexceptions routes every call that COULD
//             throw through an invoke_* trampoline in JS, so the cost lands on
//             every call site rather than on a throw. Native wasm EH deletes
//             the trampolines: measured here at 184KB (9%) less code and 10KB
//             less JS glue on an otherwise identical build.
//   SIMD      -msimd128 vectorises the AHEAD-OF-TIME C++ only — the SPU mixer,
//             VIF/GIF unpack loops, IPU MPEG decode. It does NOT touch
//             recompiled code: the JIT already hand-emits v128 (see
//             Jitter_CodeGen_Wasm_Md.cpp). That covers the VU as well as the
//             EE, because CVuExecutor extends the same CGenericMipsExecutor —
//             so both of those zones may not move at all while sound and the
//             transfer units do.
//   LTO       Cross-translation-unit inlining. Matters mostly for the
//             MemoryUtils_*Proxy calls that JIT'd blocks make constantly.
//
// PROFILE is a fourth build-time flag and not a lever at all: it turns on the
// per-frame profiler whose numbers say WHERE the time goes. It costs a little
// itself, which is why `profiled` is recorded here — comparing FPS between a
// profiling and a non-profiling build measures the instrumentation, not the
// lever.
//
// All of this is debug surface. A variant that wins moves into the shared core
// and its directory stops existing; nothing here is meant to ship as a choice a
// player makes.

export interface EngineVariant {
  /** Directory under public/ as `play-<id>`. `mt` is the shared core. */
  id: string;
  label: string;
  /** The CMake levers the build was configured with, verbatim, so a reading can
   *  be traced back to a build. Empty for the shared core. */
  levers: readonly string[];
  /** What it changes — and, where it matters, what it cannot change. */
  why: string;
  /** Carries the per-frame profiler, so it can report a subsystem split. */
  profiled: boolean;
}

/** Every build a player may be routed to. A directory that is not listed here
 *  is unreachable, because the id becomes a URL path. */
export const ENGINE_VARIANTS: readonly EngineVariant[] = [
  {
    id: "mt",
    label: "Shared core",
    levers: [],
    why: "What everyone plays on. No profiler, so it reports FPS and speed but no breakdown.",
    profiled: false,
  },
  {
    id: "prof",
    label: "Profiling",
    levers: ["PROFILE"],
    why: "The shared core plus the per-frame profiler. The baseline to compare the levers against, and the only build that can say whether time goes to the CPU, the sound chip or waiting on the GPU.",
    profiled: true,
  },
  {
    id: "fast",
    label: "Wasm EH + SIMD",
    levers: ["PROFILE", "PORTFOLIO_WASM_EH", "PORTFOLIO_SIMD"],
    why: "Both levers at once, profiled. Use this to find out whether there is any gain worth chasing before splitting them apart.",
    profiled: true,
  },
  {
    id: "ehx",
    label: "Wasm EH only",
    levers: ["PROFILE", "PORTFOLIO_WASM_EH"],
    why: "Isolates native exception handling. Build this only if the combined build showed a gain worth attributing.",
    profiled: true,
  },
  {
    id: "simd",
    label: "SIMD only",
    levers: ["PROFILE", "PORTFOLIO_SIMD"],
    why: "Isolates vectorising the ahead-of-time C++. Expect it in sound and the transfer units, not in CPU or vector-unit time — those are recompiled, and the recompiler already emits SIMD.",
    profiled: true,
  },
  {
    id: "lto",
    label: "Wasm EH + SIMD + LTO",
    levers: ["PROFILE", "PORTFOLIO_WASM_EH", "PORTFOLIO_SIMD", "PORTFOLIO_LTO"],
    why: "Adds link-time optimisation on top. Slowest to build and the likeliest to break the link, so it is kept separate from the combined build.",
    profiled: true,
  },
];

const BY_ID = new Map(ENGINE_VARIANTS.map((v) => [v.id, v]));

/** The shared core — what a missing or unbuilt variant falls back to. */
export const DEFAULT_VARIANT = "mt";

// The id becomes a path segment, and it can arrive from a URL a stranger wrote
// or from localStorage a stranger's script wrote. Shape first so nothing that
// could traverse a path gets as far as the lookup, then membership so only a
// directory we actually ship can be reached. Both, so the shape rule still
// holds if this registry is ever built from something less trusted.
const ID_SHAPE = /^[a-z][a-z0-9]{0,15}$/;

export function isEngineVariant(id: unknown): id is string {
  return typeof id === "string" && ID_SHAPE.test(id) && BY_ID.has(id);
}

export function engineVariant(id: string): EngineVariant | null {
  return BY_ID.get(id) ?? null;
}

/** The frame URL for a variant. Callers must have checked isEngineVariant. */
export const variantUrl = (id: string) => `/play-${id}/index.html`;

// —— is it actually built? ————————————————————————————————————————————————
//
// These directories are gitignored, so which ones exist depends on what has
// been built on this machine. A variant that was never built must read as
// unavailable rather than boot to a blank screen — one HEAD on its wasm,
// remembered for the life of the page.

const probes = new Map<string, Promise<boolean>>();

export function variantAvailable(id: string, doFetch: typeof fetch = fetch): Promise<boolean> {
  if (!isEngineVariant(id)) return Promise.resolve(false);
  let probe = probes.get(id);
  if (!probe) {
    probe = doFetch(`/play-${id}/Play.wasm`, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    probes.set(id, probe);
  }
  return probe;
}

/** Only for tests — the probe cache is per-page otherwise. */
export function resetVariantProbes(): void {
  probes.clear();
}

// —— the choice ————————————————————————————————————————————————————————————
//
// Read once at mount like the engine and the clock: switching build means
// re-setting the iframe src, which restarts the game, so the panel asks the
// caller to reboot rather than changing anything under a running VM.

const KEY = "asp.ps2.variant";

export function readVariant(search = location.search): string {
  const q = new URLSearchParams(search).get("core");
  if (isEngineVariant(q)) return q;
  try {
    const v = localStorage.getItem(KEY);
    if (isEngineVariant(v)) return v;
  } catch {
    /* private mode — fall through to the shared core */
  }
  return DEFAULT_VARIANT;
}

export function writeVariant(id: string): void {
  if (!isEngineVariant(id)) return;
  try { localStorage.setItem(KEY, id); } catch { /* nothing to do if storage is blocked */ }
}
