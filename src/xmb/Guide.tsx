// Searchable guide — used for both the iptv-org TV database and the
// radio-browser station list. Keyboard: type to filter, ↑↓ move, Enter play,
// Esc close. Gamepad drives the same list through the nav binding.
import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { GuideChannel } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";

const SHOW_CAP = 400;

export default function Guide(props: {
  title: string;
  loadingText: string;
  footNote: string;
  fetch: () => Promise<GuideChannel[]>;
  onPlay: (c: GuideChannel) => void;
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [channels, setChannels] = createSignal<GuideChannel[] | null>(null);
  const [error, setError] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  let input!: HTMLInputElement;
  let listEl!: HTMLDivElement;

  onMount(() => {
    props.fetch().then(setChannels).catch(() => setError(true));
    setTimeout(() => input.focus(), 60);
  });

  const results = createMemo(() => {
    const all = channels();
    if (!all) return [];
    const needle = q().trim().toLowerCase();
    const hit = needle ? all.filter((c) => c.title.toLowerCase().includes(needle)) : all;
    return hit.slice(0, SHOW_CAP);
  });

  createEffect(() => {
    q();
    setSel(0);
  });
  createEffect(() => {
    sel();
    listEl?.querySelector(".guide-row.selected")?.scrollIntoView({ block: "nearest" });
  });

  const move = (d: number) => {
    const n = results().length;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };
  const play = () => {
    const c = results()[sel()];
    if (c) { sfx.confirm(); props.onPlay(c); }
  };

  props.bind((a) => {
    if (a === "up") move(-1);
    if (a === "down") move(1);
    if (a === "confirm") play();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide">
      <div class="guide-head">
        <div>
          <div class="panel-tag">{props.title}</div>
          <input
            ref={input}
            class="guide-search"
            placeholder="Type a name…"
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              if (e.key === "PageDown") { e.preventDefault(); move(12); }
              if (e.key === "PageUp") { e.preventDefault(); move(-12); }
              if (e.key === "Enter") play();
              if (e.key === "Escape") { sfx.back(); props.onClose(); }
            }}
          />
        </div>
        <div class="guide-count">
          <Show when={channels()} fallback={error() ? "guide unreachable" : "downloading guide…"}>
            {results().length}{results().length === SHOW_CAP ? "+" : ""} of {channels()!.length.toLocaleString()} channels
          </Show>
        </div>
      </div>

      <Show
        when={channels()}
        fallback={
          <div class="guide-loading">
            {error() ? "Couldn't reach the database — try again later." : props.loadingText}
          </div>
        }
      >
        <div class="guide-list" ref={listEl}>
          <For each={results()}>
            {(c, i) => (
              <div
                class="guide-row"
                classList={{ selected: i() === sel() }}
                onClick={() => { setSel(i()); play(); }}
              >
                <span class="guide-title">{c.title}</span>
                <Show when={c.quality}><span class="guide-q">{c.quality}</span></Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="panel-hint guide-hint">
        {props.footNote} · <span class="btn-x" /> play · <span class="btn-o" /> back
      </div>
    </div>
  );
}
