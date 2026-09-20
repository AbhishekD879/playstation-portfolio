// The engine lab: which wasm build is running, what it costs, and the knobs
// that make a measurement mean something. Debug surface, behind ?perf=1.
//
// Three sections, in the order the questions get asked:
//
//   READING   where the time actually goes, sampled once a second. Without
//             this, tuning is guessing — the whole reason the panel exists is
//             that a compiler flag helping the sound chip looks identical to
//             one helping nothing at all.
//   BUILD     which variant boots. Each is one compiler lever; swapping means
//             reloading the frame, so it restarts the disc.
//   KNOBS     runtime settings, live where the engine allows it.
//
// The frame limiter is first among the knobs on purpose. Left on, every build
// presents 60 frames and reports 100%, and every lever reads as "no change".
// Unlocked, frames-per-second is the score.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { ZONE_LABEL, type Reading } from "../ps2/enginePerf";
import { ENGINE_VARIANTS, engineVariant, type EngineVariant } from "../ps2/engineVariants";
import type { Ps2Clock, Ps2Res } from "../ps2/engineChoice";

interface Props {
  /** Live reading, or null while the first interval is still being collected. */
  reading: () => Reading | null;
  /** Which build is running. */
  variant: () => string;
  /** Which builds are actually deployed — the rest were never built here. */
  built: () => ReadonlySet<string>;
  /** Chosen anew. The caller reloads the frame, which restarts the disc. */
  onVariant: (id: string) => void;

  frameLimit: () => boolean;
  onFrameLimit: (on: boolean) => void;
  res: () => Ps2Res;
  onRes: (r: Ps2Res) => void;
  clock: () => Ps2Clock;
  /** Latched at boot, so the caller restarts the disc. */
  onClock: (c: Ps2Clock) => void;
}

const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

/** A zone's share as a bar. Colour is not the signal — length is — but waiting
 *  on the GPU is called out because it is the one zone no compiler flag here
 *  can touch, and mistaking it for CPU time wastes a build. */
function ZoneBar(props: { zone: string; label: string; share: number }) {
  return (
    <div class="lab-zone">
      <span class="lab-zone-k">{props.label}</span>
      <span class="lab-zone-track">
        <span
          class="lab-zone-fill"
          classList={{ gpu: props.zone === "gssync" }}
          style={{ width: `${Math.min(100, props.share)}%` }}
        />
      </span>
      <span class="lab-zone-v">{pct(props.share)}</span>
    </div>
  );
}

export default function Ps2EngineLab(props: Props) {
  const [open, setOpen] = createSignal(false);
  let pill!: HTMLButtonElement;
  let sheet!: HTMLElement;

  const close = () => { sfx.back(); setOpen(false); queueMicrotask(() => pill.focus({ preventScroll: true })); };
  const show = () => {
    sfx.tickH(); setOpen(true);
    queueMicrotask(() => {
      (sheet.querySelector<HTMLElement>('[aria-checked="true"]') ?? sheet.querySelector<HTMLElement>("button"))
        ?.focus({ preventScroll: true });
    });
  };

  // Same contract as the other in-game sheets: while it is open it owns the
  // keyboard, so Backspace cannot reach the game underneath. The emulator binds
  // Backspace to SELECT, and a panel that let it through would press a button
  // in the game every time someone tried to correct themselves.
  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...sheet.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true });
      }
      if (e.key !== "Tab") e.stopPropagation();
    };
    addEventListener("keydown", keys, true);
    onCleanup(() => removeEventListener("keydown", keys, true));
  });

  const current = () => engineVariant(props.variant());

  const pickVariant = (v: EngineVariant) => {
    if (v.id !== props.variant()) props.onVariant(v.id);
    sfx.tickH();
    close();
  };

  return (
    <>
      <button class="ghost-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        ⚡ {current()?.label ?? "engine"}
      </button>

      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>

      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Engine lab">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Engine lab</div>
            <div class="s">
              {current()?.label ?? props.variant()}
              {current()?.levers.length ? ` · ${current()!.levers.join(" ")}` : " · no levers"}
            </div>
          </div>
        </div>

        <div class="hz-sheet-body">
          {/* —— what it is doing right now ———————————————————————————— */}
          <h4>Reading</h4>
          <Show when={props.reading()} fallback={<p class="hz-sheet-note">Measuring…</p>}>
            {(r) => (
              <>
                <div class="lab-top">
                  <span><b>{r().fps.toFixed(1)}</b> FPS</span>
                  <span><b>{r().speed.toFixed(0)}</b>% speed</span>
                </div>

                <Show
                  when={r().split}
                  fallback={
                    <p class="hz-sheet-note">
                      This build has no profiler, so it can say how fast but not where the time
                      goes. Switch to a profiling build below for the breakdown.
                    </p>
                  }
                >
                  {(split) => (
                    <div class="lab-zones">
                      <For each={split()}>
                        {(z) => <ZoneBar zone={z.zone} label={ZONE_LABEL[z.zone]} share={z.pct} />}
                      </For>
                      <p class="hz-sheet-note">
                        Shares of the emulator thread's own second, EE / VU / VIF / GIF / IOP /
                        SPU / GS-wait / other. The zones are exclusive, so vector-unit time is
                        not counted inside the CPU's. CPU and vector units run recompiled code,
                        so SIMD cannot reach them; sound and the feed units are ahead-of-time C++
                        and can. GPU wait is the one no compiler flag shrinks — if that is the
                        tall bar, the internal resolution is the lever, not the build.
                      </p>
                    </div>
                  )}
                </Show>

                {/* The JIT is the cost unique to running this in a browser: every
                    recompiled block becomes a WebAssembly module the browser
                    compiles synchronously. Nothing outside the emulator can see
                    it, and it is a different problem from slow code. */}
                <div class="lab-jit">
                  <span><b>{pct(r().jit.pctOfWall)}</b> compiling</span>
                  <span><b>{r().jit.compiled}</b> blocks/s</span>
                  <span><b>{r().jit.kbPerSec.toFixed(0)}</b> KB/s</span>
                  <span><b>{r().jit.live.toLocaleString()}</b> live</span>
                </div>
                <Show when={r().jit.pctOfWall >= 5}>
                  <p class="hz-sheet-note">
                    A twentieth of the second or more is going into compiling new blocks, not
                    into running them. That is recompilation stutter, and no flag below fixes it.
                  </p>
                </Show>
              </>
            )}
          </Show>

          {/* —— which build ——————————————————————————————————————————— */}
          <h4 class="gap">Build</h4>
          <div role="radiogroup" aria-label="Engine build">
            <For each={ENGINE_VARIANTS}>
              {(v) => {
                const here = () => props.built().has(v.id);
                const on = () => props.variant() === v.id;
                return (
                  <button
                    class="hz-srow"
                    classList={{ pri: on() }}
                    role="radio"
                    aria-checked={on()}
                    disabled={!here()}
                    onClick={() => pickVariant(v)}
                  >
                    <span>
                      <span class="t">{v.label}</span>
                      <span class="s">{here() ? v.why : "Not built on this machine."}</span>
                    </span>
                    <span class="s">{on() ? "ON" : here() ? "" : "—"}</span>
                  </button>
                );
              }}
            </For>
          </div>
          <p class="hz-sheet-note">
            Each is a separate compile, so switching restarts the disc. Your memory card is kept.
            A build that is not here has not been made yet — see docs/ps2-engine-variants.md for
            the one-line recipe.
          </p>

          {/* —— knobs ————————————————————————————————————————————————— */}
          <h4 class="gap">Knobs</h4>
          <button
            class="hz-srow"
            classList={{ pri: !props.frameLimit() }}
            role="switch"
            aria-checked={!props.frameLimit()}
            onClick={() => { sfx.tickH(); props.onFrameLimit(!props.frameLimit()); }}
          >
            <span>
              <span class="t">Unlock the frame limiter</span>
              <span class="s">
                Lets the emulator run as fast as this machine allows, so FPS becomes the score.
                Leave it locked to play; unlock it to compare two builds, because a locked one
                reports 100% on both.
              </span>
            </span>
            <span class="s">{props.frameLimit() ? "LOCKED" : "UNLOCKED"}</span>
          </button>

          <div role="radiogroup" aria-label="Internal resolution">
            <For each={[1, 2, 3] as Ps2Res[]}>
              {(r) => (
                <button
                  class="hz-srow"
                  classList={{ pri: props.res() === r }}
                  role="radio"
                  aria-checked={props.res() === r}
                  onClick={() => { sfx.tickH(); props.onRes(r); }}
                >
                  <span>
                    <span class="t">{r}× internal resolution</span>
                    <span class="s">
                      {r === 1
                        ? "Native. The only setting that cannot be GPU-bound."
                        : `Draws every framebuffer at ${r}× — sharper, and the first thing to lower if "GPU wait" is the tall bar above.`}
                    </span>
                  </span>
                  <span class="s">{props.res() === r ? "ON" : ""}</span>
                </button>
              )}
            </For>
          </div>

          <div role="radiogroup" aria-label="Console clock">
            <For each={[["full", "Full clock"], ["half", "Half clock"], ["third", "Third clock"]] as [Ps2Clock, string][]}>
              {([c, label]) => (
                <button
                  class="hz-srow"
                  classList={{ pri: props.clock() === c }}
                  role="radio"
                  aria-checked={props.clock() === c}
                  onClick={() => { sfx.tickH(); props.onClock(c); }}
                >
                  <span>
                    <span class="t">{label}</span>
                    <span class="s">
                      {c === "full"
                        ? "What a real PS2 runs at. Measure here — an underclocked run is not comparable."
                        : `Emulates fewer CPU cycles per frame, so a struggling machine reaches real time and the game's own framerate drops instead. Restarts the disc.`}
                    </span>
                  </span>
                  <span class="s">{props.clock() === c ? "ON" : ""}</span>
                </button>
              )}
            </For>
          </div>

          <p class="hz-sheet-note">
            Resolution and the limiter apply immediately. The clock is latched when a game boots,
            so changing it restarts the disc.
          </p>
        </div>

        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
