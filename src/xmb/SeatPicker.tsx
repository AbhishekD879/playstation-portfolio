// How many people are playing — the control, not a readout.
//
// It replaces a row of six 22px numbered boxes that failed three ways at once:
// the port gap carrying the whole hardware story was invisible at that size, a
// run of highlighted numbers read as "which ones" while the label said "how
// many", and nothing about it said it could be changed.
//
// So: the quantity is the biggest thing in the block, the affordance sits next
// to the value it changes, and the seats below are sockets big enough to read —
// filled ones are pads plugged in, outlined ones are free. The port boundary is
// a real gap with the seam drawn in it and a brace underneath saying what each
// side needs, which is where the hardware story survives.
//
// The ladder this replaces is still right in the ROOM LIST, where it is a
// compact occupancy readout and nobody is choosing anything.
import { For, Show } from "solid-js";
import * as sfx from "../audio";
import { clampSeats, seatPlan } from "../ps2/seatPlan";

export default function SeatPicker(props: {
  count: number;
  onPick: (n: number) => void;
  /** floor: an online room needs at least one seat to give away */
  min?: number;
  /** hide the port braces where there is no room for them */
  compact?: boolean;
}) {
  const min = () => props.min ?? 1;
  const plan = () => seatPlan(props.count);
  const set = (n: number) => {
    const v = clampSeats(Math.max(min(), n));
    if (v === props.count) return;
    sfx.tickH();
    props.onPick(v);
  };

  // ★ Accessors, called inline in the JSX. Capturing these into consts freezes
  // them at first render and the picker silently stops responding — the same
  // trap PadLadder documents.
  const seat = (p: number) => (
    <button
      class="sp-seat"
      classList={{ on: p <= props.count, barred: p < min() }}
      disabled={p < min()}
      aria-pressed={p <= props.count}
      aria-label={`${p} player${p === 1 ? "" : "s"}`}
      onClick={() => set(p)}
      // The console runs a global crossbar key handler that swallows Enter
      // before a focused button sees it, so claim the key here.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        set(p);
      }}
    >
      <span class="sp-num">{p}</span>
      <i class="sp-plug" aria-hidden="true" />
    </button>
  );

  return (
    <div
      class="sp"
      // the braces size themselves from these, so they stay glued to the seats
      // at any seat size and at either port split
      style={{ "--n1": String(plan().ports[0].seats.length), "--n2": String(plan().ports[1].seats.length) }}
    >
      <div class="sp-val">
        <span class="sp-n">{props.count}</span>
        <span class="sp-u">{props.count === 1 ? "player" : "players"}</span>
        <span class="sp-step">
          <button class="sp-arrow" aria-label="One fewer player"
            disabled={props.count <= min()} onClick={() => set(props.count - 1)}>◀</button>
          <button class="sp-arrow" aria-label="One more player"
            disabled={props.count >= 6} onClick={() => set(props.count + 1)}>▶</button>
        </span>
      </div>

      <div class="sp-row" role="group" aria-label="How many are playing">
        <For each={plan().ports[0].seats}>{seat}</For>
        <span class="sp-split" aria-hidden="true" />
        <For each={plan().ports[1].seats}>{seat}</For>
      </div>

      <Show when={!props.compact}>
        <div class="sp-braces" aria-hidden="true">
          <span class="sp-brace sp-brace-1"><b>Port 1</b> · {plan().ports[0].needs}</span>
          <span class="sp-brace-gap" />
          <span class="sp-brace sp-brace-2"><b>Port 2</b> · {plan().ports[1].needs}</span>
        </div>
      </Show>
    </div>
  );
}
