// Open Library — search any book; public-domain titles open in the
// archive.org reader right inside the console.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchBooks, type Book } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";
import HzScreen from "./HzScreen";

export default function Library(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [books, setBooks] = createSignal<Book[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [reading, setReading] = createSignal<Book | null>(null);
  let input: HTMLInputElement | undefined;
  let searchSeq = 0;
  let lastSearched = "";

  onMount(() => {
    searchBooks("science fiction classics").then(setBooks).catch(() => setBooks([]));
    setTimeout(() => input?.focus(), 60);
  });

  async function runSearch(query: string) {
    if (!query.trim()) return;
    lastSearched = query.trim();
    const seq = ++searchSeq;
    setBooks(null);
    const r = await searchBooks(query).catch(() => []);
    if (seq === searchSeq) { setBooks(r); setSel(0); }
  }

  const move = (d: number) => {
    const n = books()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };
  function pick() {
    const b = books()?.[sel()];
    if (!b) return;
    if (b.ia) { sfx.confirm(); setReading(b); }
    else { sfx.confirm(); window.open(`https://openlibrary.org${b.key}`, "_blank"); }
  }

  props.bind((a) => {
    if (reading()) {
      if (a === "back") { sfx.back(); setReading(null); }
      return;
    }
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-COLS);
    if (a === "down") move(COLS);
    if (a === "confirm") pick();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="artwrap">
      <Show
        when={!reading()}
        fallback={
          <div class="fullapp">
            <iframe credentialless={true}
              class="fullapp-frame"
              src={`https://archive.org/embed/${reading()!.ia}?ui=embed`}
              allow="fullscreen"
              title={reading()!.title}
            />
            <button class="session-eject" onClick={() => { sfx.back(); setReading(null); }}>⏏ CLOSE BOOK</button>
          </div>
        }
      >
        <HzScreen
          kick="Library · Open Library + Internet Archive"
          count={books() ? `${books()!.length} book${books()!.length === 1 ? "" : "s"}` : ""}
          hints="✕ open · ○ back"
          sub="“readable” opens here · others on Open Library"
          onClose={props.onClose}
          search={{
            value: q(),
            placeholder: "title, author, subject…",
            onInput: setQ,
            ref: (el) => (input = el),
            onEnter: () => { const t = q().trim(); if (t && t !== lastSearched) runSearch(t); else pick(); },
          }}
        >
          <Show when={books()} fallback={<p class="hz-note">Walking the stacks…</p>}>
            <TileGrid
              tiles={books()!.map((b) => ({
                img: b.cover?.replace("-M.jpg", "-L.jpg"),
                title: b.title,
                sub: `${b.author}${b.year ? ` · ${b.year}` : ""}`,
                badge: b.ia ? "readable" : undefined,
              }))}
              sel={sel()}
              shape="cover"
              fallback="📕"
              onPick={(i) => { setSel(i); pick(); }}
              onHover={(i) => setSel(i)}
            />
          </Show>
        </HzScreen>
      </Show>
    </div>
  );
}
