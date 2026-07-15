// Wikipedia — search + a clean reader (REST summary; full article opens out,
// since Wikipedia forbids framing).
import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { wikiSearch, wikiPage, type WikiHit, type WikiPage } from "../apps";
import type { NavAction } from "../input";
import * as sfx from "../audio";

export default function WikiApp(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [hits, setHits] = createSignal<WikiHit[] | null>([]);
  const [page, setPage] = createSignal<WikiPage | null>(null);
  const [loadingPage, setLoadingPage] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  let input!: HTMLInputElement;
  let listEl!: HTMLDivElement;
  let searchSeq = 0;
  let lastSearched = "";

  onMount(() => setTimeout(() => input?.focus(), 60));

  async function runSearch(query: string) {
    if (!query.trim()) return;
    lastSearched = query.trim();
    const seq = ++searchSeq;
    setHits(null);
    const r = await wikiSearch(query).catch(() => []);
    if (seq === searchSeq) { setHits(r); setSel(0); }
  }

  createEffect(() => {
    sel();
    listEl?.querySelector(".guide-row.selected")?.scrollIntoView({ block: "nearest" });
  });

  const move = (d: number) => {
    const n = hits()?.length ?? 0;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };
  function open() {
    const h = hits()?.[sel()];
    if (!h) return;
    sfx.confirm();
    setLoadingPage(true);
    wikiPage(h.title)
      .then(setPage)
      .catch(() => setPage(null))
      .finally(() => setLoadingPage(false));
  }

  props.bind((a) => {
    if (page()) {
      if (a === "confirm") window.open(page()!.url, "_blank");
      if (a === "back") { sfx.back(); setPage(null); }
      return;
    }
    if (a === "up") move(-1);
    if (a === "down") move(1);
    if (a === "confirm") open();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide">
      <div class="guide-head">
        <div>
          <div class="panel-tag">WIKIPEDIA</div>
          <input
            ref={input}
            class="guide-search"
            placeholder="Search the sum of human knowledge…"
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
              if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
              if (e.key === "Enter") { const t = q().trim(); if (t && t !== lastSearched) runSearch(t); else open(); }
              if (e.key === "Escape") {
                if (page()) setPage(null);
                else { sfx.back(); props.onClose(); }
              }
            }}
          />
        </div>
      </div>
      <Show when={!loadingPage()} fallback={<div class="guide-loading">Turning pages…</div>}>
        <Show
          when={!page()}
          fallback={
            <div class="wiki-page">
              <Show when={page()!.thumb}><img class="wiki-thumb" src={page()!.thumb} alt="" /></Show>
              <div class="wiki-body">
                <div class="panel-heading">{page()!.title}</div>
                <p class="wiki-extract">{page()!.extract}</p>
                <div class="modal-hint"><span class="btn-x" /> full article (new tab) · <span class="btn-o" /> back to results</div>
              </div>
            </div>
          }
        >
          <Show when={hits()} fallback={<div class="guide-loading">Searching…</div>}>
            <div class="guide-list" ref={listEl}>
              <For each={hits()!}>
                {(h, i) => (
                  <div class="guide-row wiki-row" classList={{ selected: i() === sel() }} onClick={() => { setSel(i()); open(); }}>
                    <span class="guide-title">{h.title}</span>
                    <span class="wiki-snip">{h.snippet}…</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
      <div class="panel-hint guide-hint">type + ENTER to search · <span class="btn-x" /> read · <span class="btn-o" /> back</div>
    </div>
  );
}
