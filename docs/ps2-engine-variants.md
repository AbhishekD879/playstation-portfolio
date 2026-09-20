# PS2 engine speed variants

One wasm build per compiler lever, so a speed change can be attributed to a
flag instead of to luck.

The PS2 core had been built the same way since it first worked —
`-fexceptions -pthread -O3 -DNDEBUG` — with three levers never tried. None of
them is a runtime setting: they change how the C++ is compiled, so the only way
to compare them is to compile twice and measure.

Related: [ps2-tuned-cores.md](ps2-tuned-cores.md) is the *per-game* version of
the same idea — a build chosen by disc, not by a person testing a flag.

## The levers

Defined in the fork's top-level `CMakeLists.txt`, all `OFF` by default so the
shared core keeps building exactly as it did.

| CMake option | Flag | What it reaches |
| --- | --- | --- |
| `PORTFOLIO_WASM_EH` | `-fwasm-exceptions` | Every call site. Emscripten's default `-fexceptions` routes anything that *could* throw through an `invoke_*` trampoline in JS, so the cost is paid on calls, not on throws. |
| `PORTFOLIO_SIMD` | `-msimd128` | The ahead-of-time C++ only: SPU mixer, IPU MPEG decode, GS vertex conversion. |
| `PORTFOLIO_LTO` | `-flto` | Cross-translation-unit inlining, mostly of the `MemoryUtils_*Proxy` calls JIT'd blocks make constantly. |

`PROFILE` is a fourth flag and not a lever: it turns on the per-frame profiler
whose numbers say *where* the time goes. It costs a little itself, so comparing
FPS between a profiling and a non-profiling build measures the instrumentation.
Compare like with like.

### What SIMD does not reach

The recompiler already hand-emits `v128` — see
`deps/CodeGen/src/Jitter_CodeGen_Wasm_Md.cpp` and the SIMD opcode table in
`WasmDefs.h`. JIT'd game code is therefore *already* vectorised, and
`-msimd128` cannot make it more so — and that applies to the **VU as well as
the EE**, since `CVuExecutor` extends the same `CGenericMipsExecutor`. Expect
movement in the ahead-of-time loops (SPU mixing, VIF/GIF unpacking, IPU
decode), not in EE or VU time.

Measured on the binary: the SIMD prefix byte `0xFD` goes from 651 occurrences
to 8,874 on an otherwise identical build, all of it in ahead-of-time code.

## Building one

From the fork (`~/src/Play-`), with emsdk sourced:

```sh
source ~/emsdk/emsdk_env.sh
emcmake cmake -S . -B build_wasm_<id> -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_PSFPLAYER=OFF -DBUILD_TESTS=OFF -DUSE_QT=OFF \
  -DPROFILE=ON <levers>
ninja -C build_wasm_<id> Play
```

`<levers>` per variant:

| id | levers |
| --- | --- |
| `prof` | *(none — the profiled baseline)* |
| `fast` | `-DPORTFOLIO_WASM_EH=ON -DPORTFOLIO_SIMD=ON` |
| `ehx` | `-DPORTFOLIO_WASM_EH=ON` |
| `simd` | `-DPORTFOLIO_SIMD=ON` |
| `lto` | `-DPORTFOLIO_WASM_EH=ON -DPORTFOLIO_SIMD=ON -DPORTFOLIO_LTO=ON` |

Configure prints the flags it settled on — check that line before waiting for a
compile:

```
-- portfolio wasm cxx flags:  -pthread -fwasm-exceptions -msimd128
```

Then deploy into this repo:

```sh
cd ~/playstation-portfolio
mkdir -p public/play-<id>
cp public/play-mt/{index.html,worker-trap-shim.js,LICENSE} public/play-<id>/
cp ~/src/Play-/build_wasm_<id>/Source/ui_js/Play.{js,wasm,js.symbols} public/play-<id>/
```

The host page is copied verbatim and derives its own directory from the URL, so
there is nothing in it to edit. That matters: it used to hardcode `/play-mt/`,
which meant a copy served its own page while loading the **shared core's** wasm
— an A/B that silently compared a build against itself.

Register the id in `src/ps2/engineVariants.ts` if it is not already there. An id
that is not in that registry is unreachable, because it becomes a URL path.

## Using it

Open the PS2 player with `?perf=1`. An `⚡` pill appears in the in-game bar next
to `▤ fps`, with:

- **Reading** — FPS, speed, the per-subsystem split, and the JIT's own cost,
  sampled once a second.
- **Build** — every variant; the ones not built on this machine are greyed out.
  Switching restarts the disc, and keeps the memory card.
- **Knobs** — the frame limiter, internal resolution, console clock.

**Unlock the frame limiter before comparing anything.** Locked, a fast build and
a slow one both present 60 frames and report 100% speed, and every lever reads
as "no change". Unlocked, frames-per-second is the score. (`setFrameLimit` used
to write a preference nothing re-read, so the knob did nothing until the next
boot; it now calls `ReloadFrameRateLimit` — see `MultitapBindings.cpp`.)

Measure at **full clock**. An underclocked run emulates fewer cycles per frame,
so it is not comparable with anything.

### Reading the split

The eight zones are **exclusive**: `CProfiler::EnterZone` charges elapsed time
to the zone already on top before pushing a new one, so vector-unit time is
*not* inside the EE's figure. This matters, and it was wrong at first — the
accumulator collected only `EE`, `IOP`, `SPU`, `GSSYNC` and `OTHER`, silently
dropping the `VU`, `VIF0`, `VIF1` and `GIF` zones the engine was already
measuring. A split that cannot see the vector units cannot see the work a
vectorising flag would move, which is the one thing worth measuring.

Which lever a zone answers to depends on whether that zone runs **JIT'd** code
or **ahead-of-time** C++, because `SIMD` only reaches the latter:

- **CPU (EE)** and **Vector units (VU)** → both recompiled (`CVuExecutor`
  extends `CGenericMipsExecutor`, the same path as the EE), and the recompiler
  already hand-emits `v128`. `SIMD` cannot reach either. `WASM_EH` and `LTO`
  can, via the runtime helpers JIT'd code calls out to.
- **Vector feed (VIF)**, **GPU feed (GIF)**, **Sound (SPU)** → ahead-of-time
  C++ unpack and mix loops. This is where `SIMD` has something to reach.
- **Waiting on GPU** → no compiler flag helps. Lower the internal resolution.
- **JIT "compiling" above ~5%** → the browser is spending the frame compiling
  new blocks rather than running them. A different problem: every recompiled
  block becomes its own `WebAssembly.Module`, compiled synchronously on the VM
  worker.

The panel shows shares only, no absolute figure. The engine's counter is
nanoseconds (`Profiler.cpp` `AddTimeToZone`) divided by a thousand into a
variable that was *named* `ms` and was microseconds — so an absolute number
would have been labelled wrong. The share is unit-free and is the whole signal.

A core built before a zone existed returns `-1` for it, and one `-1` makes the
whole split unavailable rather than partly wrong. That is deliberate: a
five-of-eight breakdown adds to 100% and looks completely credible.

## Measured

Shadow of the Colossus, `play-prof`, full clock, limiter unlocked, 25 s window
after ~75 s of boot, nothing else running. 20.4 FPS, 34% speed.

| zone | share | kind |
| --- | --- | --- |
| Vector units (VU) | **39.6%** | recompiled |
| CPU (EE) | 28.9% | recompiled |
| Vector feed (VIF) | 17.9% | ahead-of-time C++ |
| GPU feed (GIF) | 10.8% | ahead-of-time C++ |
| I/O chip (IOP) | 1.3% | recompiled |
| Sound (SPU) | 0.4% | ahead-of-time C++ |
| GPU wait | 0.0% | — |
| Other | 1.0% | — |

JIT: 11.3 blocks/s, 22,452 live, **0.04%** of wall time compiling.

What that says:

- **VU is the single biggest consumer**, and it is recompiled. This is the
  measurement that justified collecting all eight zones: with the old
  five-zone accumulator the shares summed to 31.6% of the real work and the
  panel would have shown **EE at 91%** — credible, wrong, and it would have
  sent the next few builds after the wrong lever.
- **SIMD's ceiling here is VIF + GIF = 28.7%**, not "sound and IPU" as first
  guessed. SPU is 0.4%; vectorising the mixer would buy nothing on this game.
- **`WASM_EH` is the only lever that reaches the 68.5%** in VU + EE + IOP,
  because the trampolines sit on the calls recompiled code makes out to runtime
  helpers.
- **Not GPU bound** (GPU wait 0.0%), so internal resolution is free here.
- **Not recompilation stutter** (0.04%), so the per-block `WebAssembly.Module`
  cost is a non-issue once a game is warm — worth re-checking during a level
  transition, which is when new blocks appear.

One game, one scene. Other titles will sit elsewhere, which is the point of
having the panel rather than a number in a document.

### Comparing two builds honestly

"FPS after N seconds" is not a fair comparison: with the limiter unlocked the
faster build has run *further into the game* by then, so the two are measuring
different scenes. On the same build the two methods gave 34.0% and 37.9% — the
spread is the scene, not the build.

Compare at the same **emulated** point instead: skip a fixed number of fields,
then time how long the next fixed span takes. Same work, wall time is the score.
A good check that it worked — the JIT counters come out byte-identical on both
builds (1053 blocks compiled, 23,224 live), because the same emulated span
compiles the same blocks.

### play-fast vs play-prof

`WASM_EH` + `SIMD`, same disc, ~6000 fields:

| | `play-prof` | `play-fast` | |
| --- | --- | --- | --- |
| fields | 6006 | 5996 | |
| seconds | 264.5 | 246.5 | −6.8% |
| fields/sec | 22.7 | **24.3** | **+7.1%** |
| speed | 37.9% | 40.6% | |

Shares converted back to absolute time, which is what actually moved:

| zone | change | kind |
| --- | --- | --- |
| GPU feed (GIF) | **−17%** | ahead-of-time C++ |
| Vector feed (VIF) | **−9%** | ahead-of-time C++ |
| Vector units (VU) | −6.6% | recompiled |
| CPU (EE) | −2% | recompiled |

The shape is what the zone kinds predict: `SIMD` reaches the two ahead-of-time
transfer units hardest, `WASM_EH` gives a broad smaller win across the
recompiled zones. Note EE's *share* rose (29.9% to 31.4%) while its absolute
time fell — a share going up only means everything around it got faster.

**+7% is not free but it is not transformative either.** Worth taking; not
worth expecting it to turn 40% speed into playable. Build `ehx` and `simd`
separately if the split between the two levers matters — on this evidence
`SIMD` is carrying more of it than the code-size win from `WASM_EH` suggested.

## These are local-only

The variant directories are gitignored and stripped from any deploy by
`scripts/stripLocalCores.mjs`. They exist to be compared and thrown away.

`src/ps2/localCores.test.ts` enforces both halves of that: anything gitignored
under `public/play-*` must be in the strip list, and anything in the strip list
must be gitignored — because stripping `play-mt`, which *does* ship, would take
PS2 down in production only.

**When a lever wins, it does not stay a variant.** It moves into the shared core
— turn the option on in the `play-mt` build, rebuild, commit the binary — and
its variant directory stops existing.

## Upstream

Checked 2026-09-20 against `jpd002/Play-` (note: default branch is `master`,
not `main`). The fork was 7 commits behind: three CI action bumps and two
`GSH_Vulkan` barrier fixes. The wasm build is `-sUSE_WEBGL2=1` and never
compiles `GSH_Vulkan`, so the sync was housekeeping with no performance content.
Merged at `45efdfab`.
