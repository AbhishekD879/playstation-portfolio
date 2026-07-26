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
import { For, createSignal } from "solid-js";
import * as sfx from "../audio";
import {
  readClock, readEngine, writeClock, writeEngine,
  type Ps2Clock, type Ps2Engine,
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

const engineLabel = (e: Ps2Engine) => (e === "native" ? "Native" : "Advanced");
const clockLabel = (c: Ps2Clock) => CLOCKS.find((r) => r.id === c)!.title;

export default function Ps2EnginePick() {
  const [engine, setEngine] = createSignal<Ps2Engine>(readEngine());
  const [clock, setClock] = createSignal<Ps2Clock>(readClock());
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

  return (
    <>
      <button class="hz-btn" onClick={() => { sfx.tickH(); setOpen(true); }}>
        {pillLabel()}
      </button>

      <aside class="hz-sheet" hidden={!open()} aria-label="Emulator">
        <h4>Emulator</h4>
        <For each={ENGINES}>{(r) => (
          <button class="hz-srow" classList={{ pri: engine() === r.id }}
            role="radio" aria-checked={engine() === r.id} onClick={() => pickEngine(r.id)}>
            <span><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
            <span class="s">{engine() === r.id ? "ON" : ""}</span>
          </button>
        )}</For>

        <h4 style="margin-top:clamp(14px,1.8cqw,26px)">Performance</h4>
        <For each={CLOCKS}>{(r) => (
          <button class="hz-srow" classList={{ pri: clock() === r.id }}
            disabled={engine() === "native"}
            role="radio" aria-checked={clock() === r.id} onClick={() => pickClock(r.id)}>
            <span><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
            <span class="s">{clock() === r.id ? "ON" : ""}</span>
          </button>
        )}</For>

        <button class="hz-srow" onClick={() => { sfx.back(); setOpen(false); }} style="margin-top:auto">
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
