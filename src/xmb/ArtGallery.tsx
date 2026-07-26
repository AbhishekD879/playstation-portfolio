// Art Gallery — masterpieces from the Art Institute of Chicago's open API,
// browsed guide-style and viewed with the Ken Burns treatment.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchArt, type Artwork } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";
import DepthPhoto from "./DepthPhoto";
import HzScreen from "./HzScreen";

export default function ArtGallery(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [works, setWorks] = createSignal<Artwork[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [viewing, setViewing] = createSignal(false);
  let input: HTMLInputElement | undefined;
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
    <div class="artwrap">
      <Show
        when={!viewing()}
        fallback={
          <div class="photos" onClick={() => move(1)}>
            <Show when={works()?.[sel()]} keyed>
              {(w) => <DepthPhoto class="photos-img" src={w.img} alt={w.title} />}
            </Show>
            <div class="photos-chrome">
              <span>{works()![sel()].title} — {works()![sel()].artist}</span>
              <span>←→ browse · <span class="btn-o" /> back to list</span>
            </div>
          </div>
        }
      >
        <HzScreen
          kick="Art Gallery · the Met, New York"
          count={works() ? `${works()!.length} work${works()!.length === 1 ? "" : "s"}` : ""}
          hints="✕ view full-screen · ○ back"
          sub="type to search the collection"
          onClose={props.onClose}
          search={{
            value: q(),
            placeholder: "monet, samurai, gothic, waves",
            onInput: setQ,
            ref: (el) => (input = el),
            onEnter: () => {
              const t = q().trim();
              if (t && t !== lastSearched) runSearch(t);
              else if (works()?.length) { sfx.confirm(); setViewing(true); }
            },
          }}
        >
          <Show when={works()} fallback={<p class="hz-note">Unlocking the vault…</p>}>
            <TileGrid
              tiles={works()!.map((w) => ({ img: w.img, title: w.title, sub: w.artist }))}
              sel={sel()}
              fallback="🖼"
              onPick={(i) => { setSel(i); sfx.confirm(); setViewing(true); }}
              onHover={(i) => setSel(i)}
            />
          </Show>
        </HzScreen>
      </Show>
    </div>
  );
}
