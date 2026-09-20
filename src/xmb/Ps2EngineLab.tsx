// What the emulator is doing right now: where the second goes, and the one
// control that only makes sense while a game is running.
//
// Reached from the in-game bar, next to the fps toggle. It used to hide behind
// a ?perf=1 URL flag, which is not a UI — nobody lands on a query string they
// have not been told about.
//
// It also used to carry its own copies of the clock and the internal-resolution
// settings. Those already live in the Emulator sheet on PS2 home, which is
// where every boot-time choice is made, so a second set here was two homes for
// one decision. Same for the choice of engine build, which moved there too.
// What is left is the part that could not live anywhere else: a live reading,
// and the frame limiter.
//
// The limiter is here rather than in the Emulator sheet because unlocking it is
// not a preference, it is an act of measurement. Locked, every build presents
// 60 frames and reports 100%, so nothing can be told apart; unlocked,
// frames-per-second is the score.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "./icons";
import * as sfx from "../audio";
import { ZONE_LABEL, type Reading } from "../ps2/enginePerf";
import { engineVariant } from "../ps2/engineVariants";

interface Props {
  /** Live reading, or null while the first interval is still being collected. */
  reading: () => Reading | null;
  /** Which build is running — named, so a reading can be attributed to one. */
  variant: () => string;
  frameLimit: () => boolean;
  onFrameLimit: (on: boolean) => void;
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

  return (
    <>
      <button class="ghost-btn ps2-lab-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        <Icon name="lightning" /> performance
      </button>

      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>

      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Performance">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Performance</div>
            <div class="s">
              Running on {current()?.label ?? props.variant()}
              {current()?.levers.length ? ` · ${current()!.levers.join(" ")}` : ""}
            </div>
          </div>
        </div>

        <div class="hz-sheet-body">
          {/* —— what it is doing right now ———————————————————————————— */}
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
                    into running them. That is recompilation stutter, and no engine build fixes it.
                  </p>
                </Show>
              </>
            )}
          </Show>

          {/* The one control that is an act of measurement rather than a
              preference, so it does not belong in the Emulator sheet with the
              settings that persist. */}
          <h4 class="gap">While measuring</h4>
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
                Lets the emulator run as fast as this machine allows, so the numbers above
                become a score instead of a target. Leave it locked to play — unlocked, the
                game runs too fast to control.
              </span>
            </span>
            <span class="s">{props.frameLimit() ? "LOCKED" : "UNLOCKED"}</span>
          </button>
          <p class="hz-sheet-note">
            The clock, the internal resolution and the engine build are all settled before a
            disc spins — they live under Emulator on the PS2 screen.
          </p>
        </div>

        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
