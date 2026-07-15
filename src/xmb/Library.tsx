// Open Library — search any book; public-domain titles open in the
// archive.org reader right inside the console.
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { searchBooks, type Book } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

export default function Library(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [books, setBooks] = createSignal<Book[] | null>(null);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [reading, setReading] = createSignal<Book | null>(null);
  let input!: HTMLInputElement;
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
    <div class="guide">
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
        <div class="guide-head">
          <div>
            <div class="panel-tag">LIBRARY — OPEN LIBRARY + INTERNET ARCHIVE</div>
            <input
              ref={input}
              class="guide-search"
              placeholder="Search books…"
              value={q()}
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === "Enter") { const t = q().trim(); if (t && t !== lastSearched) runSearch(t); else pick(); }
                if (e.key === "Escape") { sfx.back(); props.onClose(); }
              }}
            />
          </div>
        </div>
        <Show when={books()} fallback={<div class="guide-loading">Walking the stacks…</div>}>
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
        <div class="panel-hint guide-hint">
          "readable" opens right here · others open on Open Library · <span class="btn-x" /> open · <span class="btn-o" /> back
        </div>
      </Show>
    </div>
  );
}
