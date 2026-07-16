// Native YouTube — search & trending through the Invidious instance network
// (key-less, fails over across healthy instances), playback through the
// official youtube-nocookie embed so it always plays. Paste-a-link still works.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { ytSearch, ytTrending, type YtVideo } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

const fmtLen = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}`) + ":" + String(s % 60).padStart(2, "0");
const fmtViews = (v?: number) => (v == null ? "" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M views` : v >= 1e3 ? `${Math.round(v / 1e3)}K views` : `${v} views`);

export default function YouTubeApp(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void; initialQuery?: string }) {
  const [vids, setVids] = createSignal<YtVideo[] | null>(null);
  const [note, setNote] = createSignal("");
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [playing, setPlaying] = createSignal<YtVideo | null>(null);
  let input!: HTMLInputElement;
  let searchSeq = 0;
  let lastSearched = "";

  onMount(() => {
    // the AI agent can hand us a search to run on arrival
    if (props.initialQuery?.trim()) {
      setQ(props.initialQuery);
      runSearch(props.initialQuery);
    } else {
      ytTrending()
        .then((v) => { setVids(v); if (!v.length) setNote("Trending is napping — search still works, or paste a YouTube URL."); })
        .catch(() => { setVids([]); setNote("The instance network is down right now — paste a YouTube URL instead."); });
    }
    setTimeout(() => input?.focus(), 60);
  });

  async function runSearch(query: string) {
    const raw = query.trim();
    if (!raw) return;
    lastSearched = raw;
    // pasted URL? play it straight away
    const m = raw.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (m) {
      setPlaying({ id: m[1], title: "your link", author: "", length: 0 });
      sfx.confirm();
      return;
    }
    const seq = ++searchSeq;
    setVids(null);
    setNote("");
    try {
      const r = await ytSearch(raw);
      if (seq === searchSeq) { setVids(r); setSel(0); }
    } catch {
      if (seq === searchSeq) { setVids([]); setNote("No instance answered — try again, or paste a YouTube URL."); }
    }
  }

  const move = (d: number) => {
    const n = vids()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };
  const gridNav = (a: NavAction) => {
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-COLS);
    if (a === "down") move(COLS);
  };
  const play = () => {
    const v = vids()?.[sel()];
    if (v) { sfx.confirm(); setPlaying(v); }
  };

  props.bind((a) => {
    if (playing()) {
      if (a === "back") { sfx.back(); setPlaying(null); }
      return;
    }
    gridNav(a);
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
              src={`https://www.youtube-nocookie.com/embed/${playing()!.id}?autoplay=1`}
              allow="autoplay; encrypted-media; fullscreen"
              title={playing()!.title}
            />
            <button class="session-eject" onClick={() => { sfx.back(); setPlaying(null); }}>⏏ BACK TO RESULTS</button>
          </div>
        }
      >
        <div class="guide-head">
          <div>
            <div class="panel-tag">YOUTUBE — TRENDING & SEARCH VIA THE INVIDIOUS NETWORK · PLAYBACK OFFICIAL EMBED</div>
            <input
              ref={input}
              class="guide-search"
              placeholder="Search YouTube… or paste any video link"
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); } // drop into the grid
                if (e.key === "Enter") { const t = q().trim(); if (t && t !== lastSearched) runSearch(t); else play(); }
                if (e.key === "Escape") { sfx.back(); props.onClose(); }
              }}
            />
          </div>
          <div class="guide-count"><Show when={vids()}>{vids()!.length} videos</Show></div>
        </div>
        <Show when={vids()} fallback={<div class="guide-loading">Asking the network…</div>}>
          <Show when={vids()!.length} fallback={<div class="guide-loading">{note() || "Nothing found."}</div>}>
            <TileGrid
              tiles={vids()!.map((v) => ({
                img: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
                title: v.title,
                sub: `${v.author}${v.views != null ? " · " + fmtViews(v.views) : ""}`,
                badge: v.length > 0 ? fmtLen(v.length) : v.length < 0 ? "● LIVE" : undefined,
              }))}
              sel={sel()}
              fallback="▶"
              onPick={(i) => { setSel(i); play(); }}
              onHover={(i) => setSel(i)}
            />
          </Show>
        </Show>
        <div class="panel-hint guide-hint">
          type + ENTER to search · ↓ then arrows to browse · <span class="btn-x" /> play · <span class="btn-o" /> back
        </div>
      </Show>
    </div>
  );
}
