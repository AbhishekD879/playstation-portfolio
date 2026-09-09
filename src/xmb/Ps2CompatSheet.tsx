// "Will my disc work?" — the catalog, on the shelf, before a disc exists.
//
// The PS2 shelf used to answer this with one apologetic line: "experimental
// core, many titles run slowly or not at all". True, and useless — a player had
// no way to tell which half their game was in, so a title that was never going
// to boot looked identical to a bug in our console. Play! publishes a per-title
// record of exactly that (2.6k titles), so we ship it and let people check
// before they spend an hour ripping a disc.
//
// Sits beside the engine picker deliberately: both are decisions you make with
// nothing inserted, and both belong before the disc spins rather than after.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { COMPAT_UI, compatTally, searchCompat, type Ps2CompatState } from "../ps2compat";

const ROWS = 60; // 2.6k rows would paint for seconds; the filter is the interface

export default function Ps2CompatSheet() {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal("");
  const tally = compatTally();
  const total = tally.playable + tally.ingame + tally.loadable + tally.intro;
  const found = createMemo(() => searchCompat(q(), ROWS));

  let pill!: HTMLButtonElement;
  let sheet!: HTMLElement;
  let body!: HTMLDivElement;
  let filter!: HTMLInputElement;

  const close = () => { sfx.back(); setOpen(false); queueMicrotask(() => pill.focus({ preventScroll: true })); };
  const show = () => {
    sfx.tickH(); setOpen(true);
    // Straight into the filter: with 2.6k titles, typing is the only way anyone
    // finds their game, so put the cursor where the work happens.
    queueMicrotask(() => { body.scrollTop = 0; filter?.focus({ preventScroll: true }); });
  };

  // While it's open the sheet owns the keyboard, matching every other sheet on
  // the shelf. Capture phase, so the shelf's own Backspace ("remove this game")
  // never fires underneath.
  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...sheet.querySelectorAll<HTMLElement>("input, button:not(:disabled)")];
        const i = rows.indexOf(document.activeElement as HTMLElement);
        rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true });
      }
      if (e.key !== "Tab") e.stopPropagation();
    };
    addEventListener("keydown", keys, true);
    onCleanup(() => removeEventListener("keydown", keys, true));
  });

  const stateOrder: Ps2CompatState[] = ["playable", "ingame", "loadable", "intro"];

  return (
    <>
      <button class="hz-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>
        Game compatibility · {tally.playable.toLocaleString()} play
      </button>

      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>

      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="PlayStation 2 game compatibility">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Which games run</div>
            <div class="s">
              {total.toLocaleString()} titles reported by the Play! community — check yours before you rip a disc
            </div>
          </div>
        </div>

        <div class="hz-sheet-body" ref={body}>
          <input
            class="hz-filter" type="search" ref={filter}
            placeholder={`Search ${total.toLocaleString()} games by name or disc id…`}
            value={q()} onInput={(e) => setQ(e.currentTarget.value)}
            aria-label="Search PlayStation 2 games"
          />

          {/* The shape of the whole library, so "experimental" gets a number.
              Reuses the shelf's own fit pills rather than inventing a scale. */}
          <Show when={!q()}>
            <div class="hz-sys">
              <div class="s">
                <For each={stateOrder}>{(s, i) => (
                  <>
                    <Show when={i() > 0}>{" · "}</Show>
                    <span class={`hz-fit ${COMPAT_UI[s].fit}`}>{tally[s].toLocaleString()} {COMPAT_UI[s].label}</span>
                  </>
                )}</For>
              </div>
            </div>
          </Show>

          <For each={found().rows}>{(g) => {
            const ui = COMPAT_UI[g.state];
            return (
              <div class="hz-sys">
                <div class="hz-sys-head">
                  <span class="t">{g.name}</span>
                  <span class={`hz-fit ${ui.fit}`} title={ui.blurb}>{ui.label}</span>
                </div>
                <div class="s">{g.id} — {ui.blurb}</div>
              </div>
            );
          }}</For>

          <Show when={q() && !found().total}>
            <div class="hz-sheet-note">
              Nothing matches "{q()}". Nobody has reported that title yet — it may still boot, or it may not.
            </div>
          </Show>

          <Show when={found().total > found().rows.length}>
            <div class="hz-sheet-note">
              Showing {found().rows.length} of {found().total.toLocaleString()} matches — keep typing to narrow it down.
            </div>
          </Show>

          <div class="hz-sheet-note">
            These are reports, not promises: each one came from a person testing a single build on a
            single machine, and some are years old. A game marked as playing can still misbehave here,
            and one marked otherwise may have been fixed since.
          </div>
        </div>

        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </>
  );
}
