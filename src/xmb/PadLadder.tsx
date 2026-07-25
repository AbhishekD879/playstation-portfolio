import { For, Show } from "solid-js";

// The console's controller-port ladder.
//
// A PS2 has TWO controller ports; a multitap fans each into four slots. Players
// 1-4 therefore live on port 1 and players 5-6 on port 2 — exactly what
// ps2/players.ts portSlotFor() computes. The ladder draws that topology, and
// the GAP after slot 4 is the port boundary. That gap is the whole idea: it
// explains why a fifth player needs a second multitap without a line of copy.
//
// One component so the picker, the host banner and the in-game strip all speak
// the same vocabulary rather than three dialects of "six little boxes".

export interface Slot {
  /** 1-based player number, as a human counts them. */
  player: number;
  /** occupied. Separate from `label` because a lobby row knows a seat is TAKEN
      without knowing who by — deriving it from the label made every occupied
      seat in the lobby render as "open". */
  taken?: boolean;
  /** who holds it, when known */
  label?: string;
  /** local pad (you / a controller here) vs a remote player */
  remote?: boolean;
  /** currently sending input — the only animated thing in this design */
  active?: boolean;
}

export default function PadLadder(props: {
  count: number;                       // how many slots exist
  slots?: Slot[];                      // occupancy, if known
  onPick?: (n: number) => void;        // interactive picker when provided
  size?: "sm" | "md";
  showPorts?: boolean;                 // draw the PORT 1 / PORT 2 labels
  showWho?: boolean;                   // name each holder under the slot
}) {
  const all = () => Array.from({ length: 6 }, (_, i) => i + 1);
  const slotFor = (n: number) => props.slots?.find((s) => s.player === n);
  const within = (n: number) => n <= props.count;

  // ★ Every one of these is an ACCESSOR, called inline in the JSX below.
  // Solid only tracks what it sees inside the markup — capturing these into
  // consts (`const on = within(n)`) freezes them at first render and the
  // ladder silently stops responding to clicks.
  const rung = (n: number) => {
    const s = () => slotFor(n);
    const on = () => within(n);
    return (
      <button
        class="rung"
        classList={{
          on: on(),
          held: s()?.taken ?? !!s()?.label,
          remote: !!s()?.remote,
          live: !!s()?.active,
          pick: !!props.onPick,
        }}
        disabled={!props.onPick}
        aria-pressed={props.onPick ? on() : undefined}
        aria-label={props.onPick
          ? `Play with ${n} controller${n === 1 ? "" : "s"}`
          : `Player ${n}: ${s()?.label || "open"}`}
        onClick={() => props.onPick?.(n)}
        // ★ The console runs a global crossbar key handler, and it swallows
        // Enter before a focused button ever sees it — so the ladder looked
        // mouse-only to anyone on a keyboard or a pad (✕ maps to Enter here).
        // Claim the key ourselves and stop it bubbling to that handler.
        onKeyDown={(e) => {
          if (!props.onPick) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          props.onPick(n);
        }}
      >
        <span class="rung-n">{n}</span>
        {/* Names only where there is room for them. A lobby row shows
            occupancy as fill; the host banner shows who. */}
        <Show when={props.slots && props.showWho}>
          <span class="rung-who">{s()?.label || (on() ? "open" : "")}</span>
        </Show>
      </button>
    );
  };

  return (
    <div class="ladder" classList={{ sm: props.size === "sm", withwho: !!props.slots && !!props.showWho }}>
      <div class="ladder-port">
        <Show when={props.showPorts}><span class="ladder-lbl">PORT 1</span></Show>
        <div class="ladder-rungs"><For each={all().slice(0, 4)}>{rung}</For></div>
      </div>
      {/* ★ the port break — a real hardware boundary, not decoration */}
      <div class="ladder-break" aria-hidden="true" />
      <div class="ladder-port">
        <Show when={props.showPorts}><span class="ladder-lbl">PORT 2</span></Show>
        <div class="ladder-rungs"><For each={all().slice(4)}>{rung}</For></div>
      </div>
    </div>
  );
}
