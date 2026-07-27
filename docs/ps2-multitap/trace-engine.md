# Trace Engine — experimental superblock recompiler for the web build

The one performance lever left after everything cheaper was measured and spent.
Status: **BUILT, PROVEN CORRECT, MEASURED — NOT ADOPTED.** Lives on the
`trace-engine` branch of the fork; the shipped `multitap` branch is untouched. Everything below is grounded in numbers
from the deterministic benchmark (±2%, `Module.setFrameLimit(false)`, wall time
to 1800 emulated frames of Shadow of the Colossus).

## Why this and nothing else

Every small lever is measured and bounded:

| lever | measured | verdict |
|---|---|---|
| JS boundary on host calls | ~2% | shipped (free) |
| TLB check elimination | ≤7% ceiling | rejected |
| dispatch lookup (`FindBlockAt`) | ~0% — 422M extra lookups cost nothing | rejected |
| neural frame interpolation | 125–153ms/frame vs 16–50ms budget | rejected |

What remains is the *quality of the generated code itself*: one
`WebAssembly.Module` per basic block, guest registers reloaded from
`CMIPS::m_State` at every block entry and spilled at every exit, no
optimisation across block boundaries. PCSX2 gets its speed from exactly the
two things this denies: cross-block register allocation and native memory
access. Fastmem is unreachable in a sandbox; **larger compilation units are
not**.

## Viability measurement (2026-07-28)

Instrumented the EE executor: at each dispatch, was the new PC statically
predictable from the previous block (fallthrough `end+4`, or the decoded
branch target of the instruction at `end-4`)?

| | SotC | SmackDown HCTP |
|---|---|---|
| EE dispatches (bench run) | 297M | 265M |
| statically chainable | **71.7%** (ft 18.9 / br 52.7) | **90.2%** (ft 22.3 / br 67.9) |
| mean chain length | 3.5 blocks | 10.7 blocks |
| runs ≥4 blocks | 15% of runs | (higher) |

So a compiler that follows static successors keeps execution inside one
compiled region for 72–90% of transitions. The prize is NOT dispatch
elimination (measured free) — it is that a multi-block function gives the
browser's optimising tier (TurboFan) a window wider than one basic block, and
lets us keep guest state in wasm locals across an average of 3.5–10.7 blocks.

**Measurement gotchas encoded here so they aren't re-learned:**
- First touch of every address dispatches the *empty sentinel block*
  (garbage begin/end) which then self-compiles — never memoise anything from a
  block where `IsEmpty()`.
- EE, IOP and VU executors instantiate the same template; gate stats on
  `m_maxAddress >= 0x10000000` or IOP pollutes them.
- `HasLinkSlot(BRANCH)` is always false on emscripten (trampoline offsets are
  only recorded in the native-linking path), so out-links cannot be used to
  find branch targets — decode with `GetInstructionEffectiveAddress` at
  `end-4` like `PartitionFunction` does.
- Self-looping blocks never appear as dispatches at all (`loopsOnItself`
  compiles an in-module `Goto`) — the measured 72–90% is *on top of* loops
  the per-block engine already keeps internal.

## Design: NET traces, not general regions

HP Dynamo's Next-Executing-Tail: when a block's execution counter crosses a
threshold, record the actually-executed successor blocks until a backward
branch, another trace head, or a length cap; compile that linear path as one
unit with side exits. Most production DBTs are NET variants.

Traces fit our backend in a way general regions cannot: the wasm codegen's
`BuildLabelFlows` supports structured If/Else and **exactly one loop**
("Note: We only support one loop block"). A trace is linear code with
early-out side exits (fits nested Ifs) plus at most one backedge —
tail-jumps-to-head, the single supported loop, which is also the case that
matters (hot game loops).

### Components

1. **Trace former** (executor side, reuses existing machinery):
   hotness counter per block head (threshold ~50); on hot, follow *static*
   successors — fallthrough always, branch target only when the branch is
   unconditional (`j`, `jal`, `b`) — until: an indirect jump, a join into
   another trace head, a backward target that isn't the trace head, or cap
   (~16 blocks ≈ covers the measured chain lengths). If the last block
   branches back to the head, mark the trace as a loop.
2. **Trace compiler** (new `CompileTraceRange` beside `CompileRange`):
   concatenate the constituent blocks' instruction ranges into ONE Jitter
   function. Conditional branches inside the trace become
   `BeginIf { spill nPC = target; Goto exitLabel }` side exits. The loop case
   emits the existing `loopsOnItself` pattern (backedge guarded by
   `nHasException == 0`, which is how the cycle quota already interrupts
   self-loops — timers and vblank stay correct with zero new mechanism).
3. **Register caching inside the trace**: Jitter IR already allocates
   temporaries within a function; concatenation alone gives TurboFan a
   multi-block window. Explicit GPR→local promotion is Phase 3, only if
   Phase 2's numbers demand it.
4. **Invalidation**: a trace registers itself against every constituent
   block's address range so the existing self-modifying-code flush
   (`ClearActiveBlocksInRange`) kills traces exactly like blocks. A killed
   trace falls back to per-block execution — which still exists untouched
   underneath. Correctness never depends on traces.
5. **Dispatch**: trace lookup layered in front of `FindBlockAt` for trace
   heads only (a second map keyed by head address). Miss = per-block path.

### Safety posture

- The per-block engine remains the substrate; traces are a cache in front of
  it. Any trace can be discarded at any time.
- Side exits write `nPC` and return — identical architectural state to a
  block exit. An exception inside a trace works exactly as inside a block
  (host call sets `nHasException`; the backedge/exit checks it).
- Gated: `?engine=trace` URL override + Labs flag, default OFF. The
  deterministic bench + SmackDown/SotC boot gate must pass before every
  promotion, same as every engine change so far.

### Phases and kill criteria

- **P0 — viability** ✅ (this doc).
- **P1 — former + straight-line traces** (no loop backedge): measure. Kill
  if <5% on the bench.
- **P2 — loop traces** (the `loopsOnItself` pattern generalised): measure.
  This is where the win should live; hot loops spanning 2–4 blocks are the
  common PS2 idiom (SotC avg chain 3.5).
- **P3 — explicit register promotion** only if P2 shows the boundary
  spill/reload is what remains.

Expected honestly: unknown. This is the only candidate whose ceiling is NOT
already bounded by a measurement, which is precisely why it is the one worth
building. jor1k's precedent (whole-binary → 10× over interpreter) and the
[WATaBoy JIT-to-wasm result (~1.2× over native interpreter)] say the range is
wide; our own history (TLB 7%, dispatch 0%) says assume nothing.

## Result (2026-07-28) — built, correct, does not pay

Implemented P0.5 (oracle), P1 (former + straight-line traces) and P2 (loop
traces). All measured on the deterministic bench, SotC, interleaved in-session.

**Correctness: proven.** The oracle — XXH3 of `MIPSSTATE` at frames 600/1200/1800
with scheduling-dependent fields masked — is **bit-identical between trace-on and
trace-off in every variant**: `c651955ddda652e9 / 8c22e109e0e899f6 /
6c07c0c0a293436f`. That is a machine-checked equivalence proof over ~9 billion
emulated cycles, and it caught two real bugs before any of them could reach a
save file.

**Performance: it doesn't pay.**

| variant | 1800 frames | vs baseline |
|---|---|---|
| baseline (no traces) | 26793–27064 ms | — |
| P1 flat guards | 29193 ms | −9% |
| P1 nested guards | 27280 ms | −0.8% (noise) |
| P2 + loop traces | 28055 ms | −4.7% |

Coverage reached 17% of EE dispatches, 2535 traces formed.

**Why.** Every seam must write `nPC` and the cycle quota to memory to keep
architectural state exact — a full barrier. So concatenation alone buys the
optimiser nothing: guest registers still live in `m_State` across every seam,
which is precisely the thing that was supposed to improve. Winning would require
relaxed seams plus register promotion (P3) — state held in wasm locals and synced
only on exit — which is far deeper surgery, and P2's negative result argues
against attempting it.

**Two bugs found, both instructive:**
1. `BranchLikely` nullifies its delay slot with `Goto(GetLastBlockLabel())`. A
   block places that label immediately before its epilog; a trace has exactly one
   at the very end, so a not-taken likely branch leapt over every seam — `nPC`
   and the quota never updated and the guest span forever having consumed **zero
   cycles**. Fixed with a positive whitelist of traceable terminators (excludes
   BEQL/BNEL/BLEZL/BGTZL, the REGIMM `*L` forms, and COP0/1/2 branches).
2. The seam's fallthrough must be **relative** (`nPC += len`) exactly as
   `CompileEpilog` does it; an absolute `nPC = end + 4` diverges whenever an
   instruction already moved `nPC` (eret, exception handlers).

**Debugging note:** flat-vs-nested mattered for a second reason — with flat
guards, exiting early still evaluates every later constituent's guard. That alone
was the −9%.

## Related

- `WebAssembly/jit-interface` (Phase 1, Ben Titzer): `func.new` — real native
  JIT would obsolete all of this. Re-check every ~6 months.
- Wasm tail calls (Baseline everywhere, verified in Chrome 150): NOT used by
  this design — the slope test showed dispatch is free, so `return_call`
  chaining solves a non-problem. Traces exist for codegen quality, not
  dispatch count.
