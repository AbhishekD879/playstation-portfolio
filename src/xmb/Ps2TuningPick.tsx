// Per-game tuning: ours, or the standard settings.
//
// Some discs get settings we worked out for them — a clock, one of Play!'s
// GameConfig knobs, sometimes a whole emulator build. Each was verified
// somewhere, and "somewhere" is the honest word: a clock that fixes an intro
// can starve a later level, and a build that draws an effect the shared core
// skips might blow out a room the shared core renders fine.
//
// So this is a choice rather than a verdict, and the sheet says what we
// actually checked — over.why is the same sentence a future maintainer reads,
// which is the right level of candour for a player deciding whether to trust it.
//
// Only appears for a disc we have something for; otherwise there is nothing to
// choose between and no pill.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import type { Ps2Override } from "../ps2knobs";
import { recommends, writeChoice, type TunedChoice } from "../ps2/tunedChoice";

/** One line naming what the tuning actually does, from the override itself, so
 *  the player can see the shape of it without reading the note. */
function summarise(over: Ps2Override): string {
  const parts: string[] = [];
  if (over.core) parts.push("a build made for this game");
  if (over.clock) parts.push(`${over.clock === "full" ? "full" : over.clock} console clock`);
  if (over.res) parts.push(`${over.res}× internal resolution`);
  if (over.engine) parts.push(`the ${over.engine} engine`);
  if (over.players) parts.push(`${over.players} pads`);
  if (over.knobs) parts.push("emulator knobs found for it");
  return parts.length ? parts.join(", ") : "settings we worked out for it";
}

interface Props {
  titleId: string;
  over: Ps2Override;
  choice: TunedChoice;
  /** Chosen anew — the caller restarts the disc, because the clock, the knobs
   *  and the build are all latched when a game boots. */
  onPick: (c: TunedChoice) => void;
}

export default function Ps2TuningPick(props: Props) {
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

  const pick = (c: TunedChoice) => {
    if (c !== props.choice) {
      writeChoice(props.titleId, c);
      props.onPick(c);
    }
    sfx.tickH();
    close();
  };

  // Same contract as the emulator sheet: while it is open it owns the keyboard,
  // so Backspace cannot reach the shelf underneath (where it means "remove
  // this game").
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

  return (
    <>
      {/* ghost-btn, not hz-btn: this lives in the in-game action row beside
          "save card" and "eject", which is where a player whose game breaks
          three levels in will actually go looking. */}
      <button class="ghost-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        ⚙ {props.choice === "tuned" ? "tuned" : "standard"}
      </button>

      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>

      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Tuning for this game">
        <div class="hz-sheet-head">
          <div>
            <div class="t">This game</div>
            <div class="s">{props.titleId} · changing this restarts the disc</div>
          </div>
        </div>

        <div class="hz-sheet-body">
          <div role="radiogroup" aria-label="Tuning">
            <button class="hz-srow" classList={{ pri: props.choice === "tuned" }}
              role="radio" aria-checked={props.choice === "tuned"} onClick={() => pick("tuned")}>
              <span>
                <span class="t">Tuned for this game</span>
                <span class="s">Runs it with {summarise(props.over)}.</span>
              </span>
              <span class="s">{props.choice === "tuned" ? "ON" : ""}</span>
            </button>

            <button class="hz-srow" classList={{ pri: props.choice === "standard" }}
              role="radio" aria-checked={props.choice === "standard"} onClick={() => pick("standard")}>
              <span>
                <span class="t">Standard settings</span>
                <span class="s">Ignores all of it and uses your normal emulator settings. Try this if the game misbehaves later on.</span>
              </span>
              <span class="s">{props.choice === "standard" ? "ON" : ""}</span>
            </button>
          </div>

          {/* what we checked, in the same words the code carries */}
          <Show when={props.over.why}>
            <h4 class="gap">What we found</h4>
            <p class="hz-sheet-note">{props.over.why}</p>
          </Show>
          <p class="hz-sheet-note">
            Tested as far as we got — a setting that fixes one part of a game can
            cost another. Your memory card is kept either way, so switching picks
            up from your last save.
          </p>
          <Show when={!recommends(props.over)}>
            <p class="hz-sheet-note">We are less sure about this one, so it is off unless you ask for it.</p>
          </Show>
        </div>

        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
