// GameShelf — the library shown INSIDE the PS2, PSP and retro homes. A cover-art
// grid of YOUR games (linked from disk / copied into the console). ✕ plays;
// DEL removes an entry; R re-links a moved file. Bring-your-own (copy) and
// link-from-disk are the action buttons up top. Games come from your own local
// files only — nothing is fetched from the internet.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { CORE_NAMES, coverCandidates, fsAccessSupported, isLinked, relinkGame, removeGame, saveCover, type GameRecord, type GameSystem } from "../gamesdb";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

const mb = (n?: number) => (!n ? "" : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`);
const sysLabel = (s: string) => (s === "ps2" ? "PlayStation 2" : CORE_NAMES[s] ?? s);

export default function GameShelf(props: {
  profileId: string;
  systems: GameSystem[];       // which systems this home shows
  owned: GameRecord[];         // full library (parent-owned, already loaded)
  title: string;
  onPlay: (g: GameRecord) => void;
  onInsert: () => void;        // bring your own — copy into the console
  onLink?: () => void;         // bring your own — link from disk (Chromium)
  onChanged: () => void;       // library mutated (remove / relink)
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  extra?: () => any;           // e.g. PS2's "Join 2-player" button
}) {
  const [covers, setCovers] = createSignal<Record<string, string>>({});
  const [sel, setSel] = createSignal(0);
  const [note, setNote] = createSignal("");

  const inSystems = (s: string) => props.systems.includes(s as GameSystem);
  const rows = () => props.owned.filter((g) => inSystems(g.sys ?? g.core));

  const resolveCover = (g: GameRecord) => {
    if (g.cover) { setCovers((c) => ({ ...c, [g.id]: g.cover! })); return; }
    const urls = coverCandidates(g);
    const tryNext = (list: string[]) => {
      if (!list.length) return;
      const img = new Image();
      img.onload = () => { setCovers((c) => ({ ...c, [g.id]: list[0] })); saveCover(g.id, list[0]); };
      img.onerror = () => tryNext(list.slice(1));
      img.src = list[0];
    };
    tryNext(urls);
  };

  onMount(() => {
    for (const g of rows()) resolveCover(g);
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      else if (e.key.toLowerCase() === "r") relink();
      else if (e.key.toLowerCase() === "i") props.onInsert();
      else if (e.key.toLowerCase() === "l") props.onLink?.();
    };
    addEventListener("keydown", keys);
    onCleanup(() => removeEventListener("keydown", keys));
  });

  const move = (d: number) => { const n = rows().length; if (!n) return; setSel(Math.max(0, Math.min(n - 1, sel() + d))); sfx.tickV(); };

  async function remove() {
    const g = rows()[sel()];
    if (!g) return;
    await removeGame(g.id);
    sfx.back();
    setNote(`Removed ${g.name}${isLinked(g) && g.origin !== "download" ? " — the file on your disk is untouched" : ""}`);
    setSel(Math.max(0, sel() - 1));
    props.onChanged();
  }

  async function relink() {
    const g = rows()[sel()];
    if (!g || !isLinked(g) || g.origin === "download" || !fsAccessSupported()) return;
    try {
      const [h] = await (window as any).showOpenFilePicker({ multiple: false });
      const f = await h.getFile();
      await relinkGame(g.id, h, f.size);
      sfx.confirm(); setNote(`${g.name} → re-linked`); props.onChanged();
    } catch { /* dismissed */ }
  }

  const badge = (g: GameRecord) => (g.origin === "download" ? "DOWNLOADED" : isLinked(g) ? "LINKED" : "INSTALLED");

  props.bind((a) => {
    if (a === "left") move(-1);
    else if (a === "right") move(1);
    else if (a === "up") move(-COLS);
    else if (a === "down") move(COLS);
    else if (a === "confirm") { const g = rows()[sel()]; if (g) props.onPlay(g); }
    else if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide gameshelf">
      <div class="guide-head">
        <div>
          <div class="panel-tag">{props.title}</div>
          <div class="gamelib-sub">
            {rows().length} game{rows().length === 1 ? "" : "s"} · added from your own files · nothing leaves this machine
            <Show when={note()}> — {note()}</Show>
          </div>
        </div>
        <div class="gameshelf-actions">
          <button class="ghost-btn" onClick={props.onInsert}>＋ Bring your own</button>
          <Show when={fsAccessSupported() && props.onLink}><button class="ghost-btn" onClick={props.onLink}>🔗 Link from disk</button></Show>
          {props.extra?.()}
          <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
        </div>
      </div>

      <Show
        when={rows().length}
        fallback={
          <div class="guide-loading">
            No games here yet. “Bring your own” copies a game file into the console, or “Link from disk” keeps it on your drive and plays it from there.
          </div>
        }
      >
        <TileGrid
          tiles={rows().map((g) => ({
            img: covers()[g.id],
            title: g.name.replace(/\.[^.]+$/, ""),
            sub: `${sysLabel(g.sys ?? g.core)} · ${mb(g.size)}`,
            badge: badge(g),
          }))}
          sel={sel()}
          shape="cover"
          fallback="🎮"
          onPick={(i) => { setSel(i); const g = rows()[i]; if (g) props.onPlay(g); }}
          onHover={(i) => setSel(i)}
        />
      </Show>

      <div class="panel-hint guide-hint">
        <span class="btn-x" /> play · <span class="btn-o" /> back · I bring own · {fsAccessSupported() ? "L link · " : ""}DEL remove · R re-link
      </div>
    </div>
  );
}
