// Podcasts — iTunes Search finds any show; episodes stream through the
// console's persistent audio player (keeps playing while you browse).
import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { searchPodcasts, fetchEpisodes, type Episode, type Podcast } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";
import HzScreen from "./HzScreen";

export default function Podcasts(props: {
  onPlayAudio: (url: string, label: string) => void;
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [shows, setShows] = createSignal<Podcast[] | null>([]);
  const [episodes, setEpisodes] = createSignal<Episode[] | null>(null);
  const [show, setShow] = createSignal<Podcast | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let listEl!: HTMLDivElement;
  let searchSeq = 0;
  let lastSearched = "";

  onMount(() => {
    searchPodcasts("technology").then(setShows).catch(() => setShows([]));
    setTimeout(() => input?.focus(), 60);
  });

  async function runSearch(query: string) {
    if (!query.trim()) return;
    lastSearched = query.trim();
    const seq = ++searchSeq;
    setShows(null);
    const r = await searchPodcasts(query).catch(() => []);
    if (seq === searchSeq) { setShows(r); setSel(0); }
  }

  createEffect(() => {
    sel();
    listEl?.querySelector(".guide-row.selected")?.scrollIntoView({ block: "nearest" });
  });

  const list = () => (show() ? episodes() : shows());
  const move = (d: number) => {
    const n = list()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };

  function pick() {
    if (!show()) {
      const s = shows()?.[sel()];
      if (!s) return;
      sfx.confirm();
      setShow(s);
      setEpisodes(null);
      setSel(0);
      fetchEpisodes(s.feedUrl).then(setEpisodes).catch(() => setEpisodes([]));
    } else {
      const e = episodes()?.[sel()];
      if (!e) return;
      sfx.confirm();
      props.onPlayAudio(e.url, `${show()!.title} — ${e.title}`.slice(0, 60));
    }
  }
  function back() {
    if (show()) { sfx.back(); setShow(null); setEpisodes(null); setSel(0); }
    else { sfx.back(); props.onClose(); }
  }

  props.bind((a) => {
    if (!show()) {
      if (a === "left") move(-1);
      if (a === "right") move(1);
      if (a === "up") move(-COLS);
      if (a === "down") move(COLS);
    } else {
      if (a === "up") move(-1);
      if (a === "down") move(1);
    }
    if (a === "confirm") pick();
    if (a === "back") back();
  });

  return (
    <HzScreen
      kick={show() ? `Podcasts · ${show()!.title}` : "Podcasts · search any show"}
      count={show() ? show()!.author : list() ? `${shows()?.length ?? 0} shows` : ""}
      hints="✕ select · ○ back"
      sub={show() ? "plays in the background while you browse" : "type and press Enter to search"}
      onClose={props.onClose}
      search={show() ? undefined : {
        value: q(),
        placeholder: "search any show…",
        onInput: setQ,
        ref: (el) => (input = el),
        onEnter: () => { const t = q().trim(); if (t && t !== lastSearched) runSearch(t); else pick(); },
      }}
    >
      <Show when={list()} fallback={<p class="hz-note">{show() ? "Fetching episodes…" : "Searching…"}</p>}>
        <Show
          when={!show()}
          fallback={
            <div class="guide-list" ref={listEl}>
              <For each={episodes()!}>
                {(it, i) => (
                  <div class="guide-row" classList={{ selected: i() === sel() }} onClick={() => { setSel(i()); pick(); }}>
                    <span class="guide-title">{it.title}</span>
                    <span class="guide-q">{it.duration ?? it.date}</span>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <TileGrid
            tiles={shows()!.map((s) => ({
              img: s.art?.replace("100x100", "400x400"),
              title: s.title,
              sub: s.author,
            }))}
            sel={sel()}
            shape="square"
            fallback="🎙"
            onPick={(i) => { setSel(i); pick(); }}
            onHover={(i) => setSel(i)}
          />
        </Show>
      </Show>
    </HzScreen>
  );
}
