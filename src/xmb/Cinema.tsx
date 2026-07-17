// Archive Cinema — public-domain films from archive.org, searched live and
// played through the archive's own embed player.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchArchive, type IAItem } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

export default function Cinema(props: {
  onWatch: () => void; // trophy hook
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [items, setItems] = createSignal<IAItem[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [playing, setPlaying] = createSignal<IAItem | null>(null);
  let input!: HTMLInputElement;
  let searchSeq = 0;

  async function runSearch(query: string) {
    const seq = ++searchSeq;
    const r = await searchArchive("feature_films", query).catch(() => []);
    if (seq === searchSeq) { setItems(r); setSel(0); }
  }

  onMount(() => {
    runSearch("");
    setTimeout(() => input?.focus(), 60);
  });

  const move = (d: number) => {
    const n = items()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };
  const play = () => {
    const it = items()?.[sel()];
    if (it) { sfx.confirm(); setPlaying(it); props.onWatch(); }
  };

  props.bind((a) => {
    if (playing()) {
      if (a === "back") { sfx.back(); setPlaying(null); }
      return;
    }
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-3);
    if (a === "down") move(3);
    if (a === "confirm") play();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide">
      <Show
        when={!playing()}
        fallback={
          <div class="fullapp">
            <iframe credentialless={true}
              class="fullapp-frame"
              src={`https://archive.org/embed/${playing()!.id}?autoplay=1`}
              allow="autoplay; fullscreen"
              title={playing()!.title}
            />
            <button class="session-eject" onClick={() => { sfx.back(); setPlaying(null); }}>⏏ STOP</button>
          </div>
        }
      >
        <div class="guide-head">
          <div>
            <div class="panel-tag">ARCHIVE CINEMA — PUBLIC-DOMAIN FILMS · ARCHIVE.ORG</div>
            <input
              ref={input}
              class="guide-search"
              placeholder="Search films… (try: detour, dementia, plan 9)"
              value={q()}
              onInput={(e) => { setQ(e.currentTarget.value); runSearch(e.currentTarget.value); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === "Enter") play();
                if (e.key === "Escape") { sfx.back(); e.currentTarget.blur(); } // step out of the field; next Esc closes the app
              }}
            />
          </div>
          <div class="guide-count">
            <Show when={items()}>{items()!.length} films · most-watched first</Show>
          </div>
        </div>
        <Show when={items()} fallback={<div class="guide-loading">Dusting off the reels…</div>}>
          <TileGrid
            tiles={items()!.map((it) => ({ img: `https://archive.org/services/img/${it.id}`, title: it.title }))}
            sel={sel()}
            cols={3}
            fallback="🎬"
            onPick={(i) => { setSel(i); play(); }}
            onHover={(i) => setSel(i)}
          />
        </Show>
        <div class="panel-hint guide-hint"><span class="btn-x" /> watch · <span class="btn-o" /> back</div>
      </Show>
    </div>
  );
}
