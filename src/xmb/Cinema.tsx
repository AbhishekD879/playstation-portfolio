// Archive Cinema — public-domain films from archive.org, searched live and
// played through the archive's own embed player.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchArchive, type IAItem } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";
import HzScreen from "./HzScreen";

export default function Cinema(props: {
  onWatch: () => void; // trophy hook
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [items, setItems] = createSignal<IAItem[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [playing, setPlaying] = createSignal<IAItem | null>(null);
  let input: HTMLInputElement | undefined;
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
    <div class="artwrap">
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
        <HzScreen
          kick="Archive Cinema · public-domain films"
          count={items() ? `${items()!.length} films · most-watched first` : ""}
          hints="✕ watch · ○ back"
          sub="archive.org"
          onClose={props.onClose}
          search={{
            value: q(),
            placeholder: "detour, dementia, plan 9…",
            onInput: (v) => { setQ(v); runSearch(v); },
            ref: (el) => (input = el),
            onEnter: play,
          }}
        >
          <Show when={items()} fallback={<p class="hz-note">Dusting off the reels…</p>}>
            <TileGrid
              tiles={items()!.map((it) => ({ img: `https://archive.org/services/img/${it.id}`, title: it.title }))}
              sel={sel()}
              cols={3}
              fallback="🎬"
              onPick={(i) => { setSel(i); play(); }}
              onHover={(i) => setSel(i)}
            />
          </Show>
        </HzScreen>
      </Show>
    </div>
  );
}
