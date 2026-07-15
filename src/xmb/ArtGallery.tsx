// Art Gallery — masterpieces from the Art Institute of Chicago's open API,
// browsed guide-style and viewed with the Ken Burns treatment.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchArt, type Artwork } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

export default function ArtGallery(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [works, setWorks] = createSignal<Artwork[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [viewing, setViewing] = createSignal(false);
  let input!: HTMLInputElement;
  let searchSeq = 0;
  let lastSearched = "";

  onMount(() => {
    searchArt("").then(setWorks).catch(() => setWorks([]));
    setTimeout(() => input?.focus(), 60);
  });

  async function runSearch(query: string) {
    lastSearched = query.trim();
    const seq = ++searchSeq;
    setWorks(null);
    const r = await searchArt(query).catch(() => []);
    if (seq === searchSeq) { setWorks(r); setSel(0); }
  }

  const move = (d: number) => {
    const n = works()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };

  props.bind((a) => {
    if (viewing()) {
      if (a === "left") move(-1);
      if (a === "right") move(1);
      if (a === "back" || a === "confirm") { sfx.back(); setViewing(false); }
      return;
    }
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-COLS);
    if (a === "down") move(COLS);
    if (a === "confirm") { if (works()?.length) { sfx.confirm(); setViewing(true); } }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide">
      <Show
        when={!viewing()}
        fallback={
          <div class="photos" onClick={() => move(1)}>
            <Show when={works()?.[sel()]} keyed>
              {(w) => <img class="photos-img" src={w.img} alt={w.title} />}
            </Show>
            <div class="photos-chrome">
              <span>{works()![sel()].title} — {works()![sel()].artist}</span>
              <span>←→ browse · <span class="btn-o" /> back to list</span>
            </div>
          </div>
        }
      >
        <div class="guide-head">
          <div>
            <div class="panel-tag">ART GALLERY — THE MET, NEW YORK</div>
            <input
              ref={input}
              class="guide-search"
              placeholder="Search art… (monet, samurai, gothic, waves)"
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === "Enter") {
                  const t = q().trim();
                  if (t && t !== lastSearched) runSearch(t);
                  else if (works()?.length) { sfx.confirm(); setViewing(true); }
                }
                if (e.key === "Escape") { sfx.back(); props.onClose(); }
              }}
            />
          </div>
          <div class="guide-count"><Show when={works()}>{works()!.length} works</Show></div>
        </div>
        <Show when={works()} fallback={<div class="guide-loading">Unlocking the vault…</div>}>
          <TileGrid
            tiles={works()!.map((w) => ({ img: w.img, title: w.title, sub: w.artist }))}
            sel={sel()}
            fallback="🖼"
            onPick={(i) => { setSel(i); sfx.confirm(); setViewing(true); }}
            onHover={(i) => setSel(i)}
          />
        </Show>
        <div class="panel-hint guide-hint"><span class="btn-x" /> view full-screen · <span class="btn-o" /> back</div>
      </Show>
    </div>
  );
}
