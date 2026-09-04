// Which emulator PS2 discs boot on, and how hard it drives the emulated CPU.
//
// Both are set-once preferences, so they get a pill in the hero action row and
// nothing more — the first version put a whole panel inline, which made a
// setting nobody changes the loudest object on a screen about games. Choosing
// opens the same slide-in sheet the per-game options use, so there is one
// language for "here are your choices" on this screen.
//
// It lives on PS2 home because every launch passes through here and both
// choices have to be settled before a disc spins — see engineChoice.ts.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import {
  readClock, readEngine, readRes, writeClock, writeEngine, writeRes,
  type Ps2Clock, type Ps2Engine, type Ps2Res,
} from "../ps2/engineChoice";

const ENGINES: { id: Ps2Engine; title: string; sub: string }[] = [
  {
    id: "advanced",
    title: "Advanced",
    sub: "Up to 6 players. Boots games the native build can't, and shows FPS and speed while you play.",
  },
  {
    id: "native",
    title: "Native",
    sub: "The unmodified upstream build. Two players, no speed readout. Use it to compare if a game misbehaves.",
  },
];

// The PCSX2-style underclock: fewer emulated CPU cycles per frame, so a heavy
// game stops running in slow motion and loses in-game framerate instead —
// like a struggling real PS2. Numbers below were measured on Shadow of the
// Colossus, the heaviest title in the library.
const CLOCKS: { id: Ps2Clock; title: string; sub: string }[] = [
  {
    id: "full",
    title: "Full speed",
    sub: "The console's real clock. Games that already run well stay exactly as they are.",
  },
  {
    id: "half",
    title: "Balanced",
    sub: "Console CPU at half clock. Heavy games run much closer to real time and give up some of their own framerate.",
  },
  {
    id: "third",
    title: "Fast",
    // the aggressive setting is honest about its cost: cycle-count-sensitive
    // games can crash under a deep underclock (the same trade PCSX2's
    // cyclerate hack makes) — that is the player's call to make, informed
    sub: "Console CPU at a third. For games that crawl — near real-time speed with console-era framerate. Some games may be unstable this low; drop to Balanced if one crashes.",
  },
];

// Internal render resolution. The GS draws at N× native, so 3D games get clean
// edges instead of the PS2's 512×448 stair-steps. It is real geometry, not a
// filter — the same lever PCSX2 exposes — and costs GPU fill in proportion, so
// 1× stays the default and 3× is as high as a phone should go.
const RESOLUTIONS: { id: Ps2Res; title: string; sub: string }[] = [
  { id: 1, title: "Native", sub: "The PS2's own resolution. Exactly the picture the console drew." },
  { id: 2, title: "2× internal", sub: "Renders every frame at twice the size. Clean edges on most games; modest GPU cost." },
  { id: 3, title: "3× internal", sub: "Three times the native size. Sharpest picture; heavy on a phone, and some games need 1× to render correctly." },
];

const engineLabel = (e: Ps2Engine) => (e === "native" ? "Native" : "Advanced");
const clockLabel = (c: Ps2Clock) => CLOCKS.find((r) => r.id === c)!.title;

export default function Ps2EnginePick() {
  const [engine, setEngine] = createSignal<Ps2Engine>(readEngine());
  const [clock, setClock] = createSignal<Ps2Clock>(readClock());
  const [res, setRes] = createSignal<Ps2Res>(readRes());
  const pickRes = (r: Ps2Res) => { if (r !== res()) { writeRes(r); setRes(r); } };
  const [open, setOpen] = createSignal(false);
  const pickEngine = (e: Ps2Engine) => {
    if (e !== engine()) { writeEngine(e); setEngine(e); }
    sfx.tickH();
  };
  const pickClock = (c: Ps2Clock) => {
    if (c !== clock()) { writeClock(c); setClock(c); }
    sfx.tickH();
  };
  // the pill names anything that departs from the default, so a non-standard
  // setup is visible without opening the sheet
  const pillLabel = () =>
    `Emulator · ${engineLabel(engine())}${clock() === "full" ? "" : ` · ${clockLabel(clock())}`}`;

  let pill!: HTMLButtonElement;
  let sheet!: HTMLElement;
  let body!: HTMLDivElement;
  const close = () => { sfx.back(); setOpen(false); queueMicrotask(() => pill.focus({ preventScroll: true })); };
  const show = () => {
    sfx.tickH(); setOpen(true);
    // start at the top and hand focus to the sheet, so a keyboard or a
    // controller is inside it right away — the previous version left focus on
    // the pill behind the panel
    queueMicrotask(() => {
      body.scrollTop = 0;
      // preventScroll: the sheet is still sliding in, and a plain focus() would
      // scroll the shelf's container to chase the row — that shift is what left
      // the sheet's head above the screen
      (sheet.querySelector<HTMLElement>('[aria-checked="true"]') ?? sheet.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    });
  };
  // While the sheet is open it owns the keyboard: Escape closes it, ↑/↓ walk
  // the rows, and nothing leaks to the shelf underneath (whose Backspace means
  // "remove this game"). Capture phase so it runs before the shelf's listener.
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

  const advancedOnly = () => engine() === "native";

  return (
    <>
      <button class="hz-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        {pillLabel()}
      </button>

      {/* tap outside closes, like any sheet; stops short of the Control Center */}
      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>

      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Emulator settings">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Emulator</div>
            <div class="s">Applies to every PS2 disc you boot</div>
          </div>
        </div>

        {/* the settings scroll on their own; the title above and Close below
            stay put, so the way out never has to be scrolled to */}
        <div class="hz-sheet-body" ref={body}>
          <h4 id="hz-eng">Engine</h4>
          <div role="radiogroup" aria-labelledby="hz-eng">
            <For each={ENGINES}>{(r) => (
              <button class="hz-srow" classList={{ pri: engine() === r.id }}
                role="radio" aria-checked={engine() === r.id} onClick={() => pickEngine(r.id)}>
                <span><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
                <span class="s">{engine() === r.id ? "ON" : ""}</span>
              </button>
            )}</For>
          </div>

          <h4 id="hz-perf" class="gap">Performance</h4>
          <Show when={advancedOnly()}><p class="hz-sheet-note">Advanced engine only — the native build runs at the console's clock.</p></Show>
          <div role="radiogroup" aria-labelledby="hz-perf">
            <For each={CLOCKS}>{(r) => (
              <button class="hz-srow" classList={{ pri: clock() === r.id }}
                disabled={advancedOnly()}
                role="radio" aria-checked={clock() === r.id} onClick={() => pickClock(r.id)}>
                <span><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
                <span class="s">{clock() === r.id ? "ON" : ""}</span>
              </button>
            )}</For>
          </div>

          <h4 id="hz-pic" class="gap">Picture</h4>
          <Show when={advancedOnly()}><p class="hz-sheet-note">Advanced engine only — the native build draws at the PS2's own resolution.</p></Show>
          <div role="radiogroup" aria-labelledby="hz-pic">
            <For each={RESOLUTIONS}>{(r) => (
              <button class="hz-srow" classList={{ pri: res() === r.id }}
                disabled={advancedOnly()}
                role="radio" aria-checked={res() === r.id} onClick={() => pickRes(r.id)}>
                <span><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
                <span class="s">{res() === r.id ? "ON" : ""}</span>
              </button>
            )}</For>
          </div>
        </div>

        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
