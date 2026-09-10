// Emulator settings, in the Online screen's own language.
//
// The first attempt reused Ps2EnginePick, the pill-and-slide-in-sheet from PS2
// home. That was wrong twice over. The sheet is `position: absolute; top: 0`
// against a shelf container, so inside this long scrolling page it anchored to
// the top of the scroll box — nowhere near the pill that opened it. And hiding
// three decisions behind a pill is the wrong shape for a screen whose whole job
// is laying choices out where you can see them: names, seats, who can join and
// the invite are all right there on the page.
//
// So these are too — same headings, same party-tab pills, same note underneath
// that changes with the choice. Nothing new to learn, nothing to open.
//
// It matters more here than anywhere else: the host's console does the
// emulating, so whatever is picked here is the picture every person in the room
// watches.
import { For } from "solid-js";
import * as sfx from "../audio";
import {
  readClock, readEngine, readRes, writeClock, writeEngine, writeRes,
  type Ps2Clock, type Ps2Engine, type Ps2Res,
} from "../ps2/engineChoice";
import { createSignal } from "solid-js";

// One line each, because they sit under the row rather than inside a sheet with
// room to breathe. The longer versions live in Ps2EnginePick.
const ENGINES: { id: Ps2Engine; label: string; note: string }[] = [
  { id: "advanced", label: "Advanced", note: "Up to six players, and it boots games the native build cannot. The default, and what most rooms want." },
  { id: "native", label: "Native", note: "Upstream Play!, unmodified. Two players only — worth trying if a game misbehaves on Advanced." },
];

const CLOCKS: { id: Ps2Clock; label: string; note: string }[] = [
  { id: "full", label: "Full speed", note: "The console's real clock. Games that already run well stay exactly as they are." },
  { id: "half", label: "Balanced", note: "Half clock. Heavy games run much closer to real time and give up some of their own framerate." },
  { id: "third", label: "Fast", note: "A third of the clock. For games that crawl — some are unstable this low, so drop back to Balanced if one crashes." },
];

const RESOLUTIONS: { id: Ps2Res; label: string; note: string }[] = [
  { id: 1, label: "Native", note: "The PS2's own resolution. Exactly the picture the console drew." },
  { id: 2, label: "2× internal", note: "Twice the size. Clean edges on most games, modest GPU cost — and everyone in the room sees it." },
  { id: 3, label: "3× internal", note: "Three times the size. Sharpest, heavy on a phone, and a few games need Native to draw correctly." },
];

export default function Ps2OnlineEmulator() {
  const [engine, setEngine] = createSignal<Ps2Engine>(readEngine());
  const [clock, setClock] = createSignal<Ps2Clock>(readClock());
  const [res, setRes] = createSignal<Ps2Res>(readRes());

  const pickEngine = (e: Ps2Engine) => { if (e !== engine()) { writeEngine(e); setEngine(e); } sfx.tickH(); };
  const pickClock = (c: Ps2Clock) => { if (c !== clock()) { writeClock(c); setClock(c); } sfx.tickH(); };
  const pickRes = (r: Ps2Res) => { if (r !== res()) { writeRes(r); setRes(r); } sfx.tickH(); };

  // Speed and picture are fork bindings; the native build has neither and the
  // boot page guards both calls, so on Native they are honestly unavailable
  // rather than silently ignored.
  const nativeOnly = () => engine() === "native";

  const engineNote = () => ENGINES.find((r) => r.id === engine())!.note;
  const clockNote = () => CLOCKS.find((r) => r.id === clock())!.note;
  const resNote = () => RESOLUTIONS.find((r) => r.id === res())!.note;

  return (
    <>
      <div class="online-act">
        <p class="online-sub" style="margin:0">How it runs</p>
      </div>
      <p class="online-note" style="margin:0 0 14px">
        Your console does the emulating for the whole room, so this is the picture everyone gets.
      </p>

      <div class="party-vis" role="group" aria-label="Emulator engine">
        <For each={ENGINES}>{(r) => (
          <button class="party-tab" classList={{ on: engine() === r.id }} aria-pressed={engine() === r.id}
            onClick={() => pickEngine(r.id)}>{r.label}</button>
        )}</For>
      </div>
      <p class="online-note" style="margin-top:10px">{engineNote()}</p>

      <div class="online-act">
        <p class="online-sub" style="margin:0">Speed</p>
      </div>
      <div class="party-vis" role="group" aria-label="Console speed">
        <For each={CLOCKS}>{(r) => (
          <button class="party-tab" classList={{ on: clock() === r.id }} aria-pressed={clock() === r.id}
            disabled={nativeOnly()} onClick={() => pickClock(r.id)}>{r.label}</button>
        )}</For>
      </div>
      <p class="online-note" style="margin-top:10px">
        {nativeOnly() ? "Native runs at the console's clock — switch to Advanced to change this." : clockNote()}
      </p>

      <div class="online-act">
        <p class="online-sub" style="margin:0">Picture</p>
      </div>
      <div class="party-vis" role="group" aria-label="Internal resolution">
        <For each={RESOLUTIONS}>{(r) => (
          <button class="party-tab" classList={{ on: res() === r.id }} aria-pressed={res() === r.id}
            disabled={nativeOnly()} onClick={() => pickRes(r.id)}>{r.label}</button>
        )}</For>
      </div>
      <p class="online-note" style="margin-top:10px">
        {nativeOnly() ? "Native draws at the PS2's own resolution — switch to Advanced to change this." : resNote()}
      </p>
    </>
  );
}
