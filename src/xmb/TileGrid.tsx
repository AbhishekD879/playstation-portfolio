// PS-store-style tile grid — image-first picking, glowing selection.
// Thumbnail height is measured, not derived from CSS aspect-ratio: Chromium
// collapses aspect-ratio boxes inside 1fr grid tracks to a zero-height row
// (the cell paints full size but the row shrinks → thin "pipe" strips). A
// ResizeObserver sets an explicit px height instead. COLS stays the nav default.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

export const COLS = 4;
const RATIO = { wide: 16 / 9, cover: 2 / 3, square: 1 } as const;
const GAP = 16;

export interface Tile {
  img?: string;
  title: string;
  sub?: string;
  badge?: string;
}

export default function TileGrid(props: {
  tiles: Tile[];
  sel: number;
  shape?: "wide" | "cover" | "square"; // 16:9 · 2:3 · 1:1
  cols?: number; // defaults to COLS(4); keep nav math in the app in sync
  fit?: "cover" | "contain"; // contain = show the whole artwork, letterboxed
  fallback?: string; // emoji shown when a tile has no image
  onPick: (i: number) => void;
  onHover?: (i: number) => void;
}) {
  let grid!: HTMLDivElement;
  const cols = () => props.cols ?? COLS;
  const [thumbH, setThumbH] = createSignal(150);

  const measure = () => {
    if (!grid) return;
    const cw = (grid.clientWidth - GAP * (cols() - 1)) / cols();
    setThumbH(Math.round(cw / RATIO[props.shape ?? "wide"]));
  };
  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => { cols(); props.shape; measure(); });

  createEffect(() => {
    props.sel;
    grid?.querySelector(".tile.selected")?.scrollIntoView({ block: "nearest" });
  });

  return (
    <div class="tile-grid" ref={grid} style={{ "grid-template-columns": `repeat(${cols()}, 1fr)` }}>
      <For each={props.tiles}>
        {(t, i) => (
          <div
            class="tile"
            classList={{ selected: i() === props.sel }}
            onClick={() => props.onPick(i())}
            onMouseEnter={() => props.onHover?.(i())}
          >
            <div class="tile-thumb" style={{ height: `${thumbH()}px` }}>
              <Show
                when={t.img}
                fallback={<div class="tile-fallback">{props.fallback ?? "▦"}</div>}
              >
                <img class="tile-img" classList={{ contain: props.fit === "contain" }} src={t.img} alt="" loading="lazy"
                  onError={(e) => { const el = e.currentTarget; el.style.display = "none"; el.parentElement!.insertAdjacentHTML("beforeend", `<div class="tile-fallback">${props.fallback ?? "▦"}</div>`); }} />
              </Show>
              <Show when={t.badge}><span class="tile-badge">{t.badge}</span></Show>
            </div>
            <div class="tile-body">
              <div class="tile-title">{t.title}</div>
              <Show when={t.sub}><div class="tile-sub">{t.sub}</div></Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
