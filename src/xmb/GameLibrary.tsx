// Game Library — the console's shelf. Every game you've added, PS2 discs and
// retro cartridges alike, as a cover-art grid: box art from libretro-thumbnails
// (best-effort by name), LINKED (streams from your disk) vs INSTALLED (stored
// in the console) badges, play counts. ✕ plays · ⌦/□(click) removes an entry ·
// re-link swaps a moved file's handle. Adding games happens in the Game column
// ("Link Games from Disk…" / "Insert Cartridge…") or inside the PS2 app.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { CORE_NAMES, coverCandidates, fsAccessSupported, isLinked, relinkGame, removeGame, saveCover, type GameRecord } from "../gamesdb";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

const sysName = (g: GameRecord) => (g.sys === "ps2" ? "PlayStation 2" : CORE_NAMES[g.core] ?? g.core);
const mb = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`);

export default function GameLibrary(props: {
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  games: GameRecord[];
  onPlay: (g: GameRecord) => void;
  onChanged: () => void; // deleted / re-linked — parent refreshes the list
}) {
  const [sel, setSel] = createSignal(0);
  const [covers, setCovers] = createSignal<Record<string, string>>({});
  const [note, setNote] = createSignal("");

  // resolve box art: try candidates in order, remember the winner
  onMount(() => {
    for (const g of props.games) {
      if (g.cover) { setCovers((c) => ({ ...c, [g.id]: g.cover! })); continue; }
      const tryNext = (urls: string[]) => {
        if (!urls.length) return;
        const img = new Image();
        img.onload = () => { setCovers((c) => ({ ...c, [g.id]: urls[0] })); saveCover(g.id, urls[0]); };
        img.onerror = () => tryNext(urls.slice(1));
        img.src = urls[0];
      };
      tryNext(coverCandidates(g));
    }
    // management keys (keyboard/mouse — the pad plays, the keyboard curates)
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      if (e.key.toLowerCase() === "r") relink();
    };
    addEventListener("keydown", keys);
    onCleanup(() => removeEventListener("keydown", keys));
  });

  const move = (d: number) => {
    const n = props.games.length;
    if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d)));
    sfx.tickV();
  };

  async function remove() {
    const g = props.games[sel()];
    if (!g) return;
    await removeGame(g.id);
    sfx.back();
    setNote(`Removed ${g.name}${isLinked(g) ? " — the file on your disk is untouched" : ""}`);
    setSel(Math.max(0, sel() - 1));
    props.onChanged();
  }

  async function relink() {
    const g = props.games[sel()];
    if (!g || !isLinked(g) || !fsAccessSupported()) return;
    try {
      const [h] = await (window as any).showOpenFilePicker({ multiple: false });
      const f = await h.getFile();
      await relinkGame(g.id, h, f.size);
      sfx.confirm();
      setNote(`${g.name} → re-linked to ${f.name}`);
      props.onChanged();
    } catch { /* picker dismissed */ }
  }

  props.bind((a) => {
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "up") move(-COLS);
    if (a === "down") move(COLS);
    if (a === "confirm") { const g = props.games[sel()]; if (g) props.onPlay(g); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide">
      <div class="guide-head">
        <div>
          <div class="panel-tag">GAME LIBRARY — YOUR SHELF · NOTHING LEAVES THIS MACHINE</div>
          <div class="gamelib-sub">
            {props.games.length} game{props.games.length === 1 ? "" : "s"} ·
            linked games stream straight from your disk · installed ones live in the console
            {note() ? ` — ${note()}` : ""}
          </div>
        </div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <Show
        when={props.games.length}
        fallback={
          <div class="guide-loading">
            The shelf is empty. Add games from the Game column —
            “Link Games from Disk…” keeps them on your drive, “Insert Cartridge…” stores a copy here.
          </div>
        }
      >
        <TileGrid
          tiles={props.games.map((g) => ({
            img: covers()[g.id],
            title: g.name.replace(/\.[^.]+$/, ""),
            sub: `${sysName(g)} · ${mb(g.size)} · played ${g.plays ?? 0}×`,
            badge: isLinked(g) ? "LINKED" : "INSTALLED",
          }))}
          sel={sel()}
          shape="cover"
          fallback="🎮"
          onPick={(i) => { setSel(i); const g = props.games[i]; if (g) props.onPlay(g); }}
          onHover={(i) => setSel(i)}
        />
      </Show>
      <div class="panel-hint guide-hint">
        <span class="btn-x" /> play · <span class="btn-o" /> back · DEL remove · R re-link a moved file
      </div>
    </div>
  );
}
