// GameShelf — the browsable library shown INSIDE the PS2 home and the retro
// home. One cover-art grid mixing YOUR games (linked/installed/downloaded)
// with the DOWNLOADABLE catalog for this system. ✕ plays (downloading first
// if it's a catalog game); DEL removes an owned entry; R re-links a moved
// file. Bring-your-own (insert / link-from-disk) and "add a game source" are
// action buttons up top. Pure view + download helper — all library mutation
// and routing is owned by the caller via onPlay.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { CORE_NAMES, coverCandidates, fsAccessSupported, isLinked, relinkGame, removeGame, saveCover, type GameRecord } from "../gamesdb";
import { downloadGame, fetchCatalog, type CatalogGame, type GameSystem } from "../gameSources";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import TileGrid, { COLS } from "./TileGrid";

const mb = (n?: number) => (!n ? "" : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`);
const sysLabel = (s: string) => (s === "ps2" ? "PlayStation 2" : CORE_NAMES[s] ?? s);

// unified row: either an owned record or a not-yet-downloaded catalog game
type Row = { key: string; kind: "owned"; g: GameRecord } | { key: string; kind: "catalog"; c: CatalogGame };

export default function GameShelf(props: {
  profileId: string;
  systems: GameSystem[];       // which systems this home shows
  owned: GameRecord[];         // full library (parent-owned, already loaded)
  title: string;
  onPlay: (g: GameRecord) => void;
  onInsert: () => void;        // bring your own — copy into the console
  onLink?: () => void;         // bring your own — link from disk (Chromium)
  onChanged: () => void;       // library mutated (download/remove/relink)
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  extra?: () => any;           // e.g. PS2's "Join 2-player" button
}) {
  const [catalog, setCatalog] = createSignal<CatalogGame[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [errs, setErrs] = createSignal<string[]>([]);
  const [covers, setCovers] = createSignal<Record<string, string>>({});
  const [dl, setDl] = createSignal<Record<string, number>>({}); // id → progress 0..1 (or -1)
  const [sel, setSel] = createSignal(0);
  const [note, setNote] = createSignal("");

  const inSystems = (s: string) => props.systems.includes(s as GameSystem);
  const ownedHere = () => props.owned.filter((g) => inSystems(g.sys ?? g.core));

  // combined rows: your games first, then catalog games you don't already have
  const rows = (): Row[] => {
    const own = ownedHere().map((g) => ({ key: "o-" + g.id, kind: "owned" as const, g }));
    const ownedIds = new Set(props.owned.map((g) => g.id));
    const cat = catalog().filter((c) => inSystems(c.system) && !ownedIds.has(c.id)).map((c) => ({ key: "c-" + c.id, kind: "catalog" as const, c }));
    return [...own, ...cat];
  };

  const resolveCover = (key: string, name: string, sys: string, hint: string | undefined, seed?: string) => {
    if (hint) { setCovers((c) => ({ ...c, [key]: hint })); return; }
    const urls = coverCandidates({ name, sys: sys === "ps2" ? "ps2" : undefined, core: sys } as GameRecord);
    const tryNext = (list: string[]) => {
      if (!list.length) return;
      const img = new Image();
      img.onload = () => { setCovers((c) => ({ ...c, [key]: list[0] })); if (seed) saveCover(seed, list[0]); };
      img.onerror = () => tryNext(list.slice(1));
      img.src = list[0];
    };
    tryNext(urls);
  };

  onMount(() => {
    for (const g of ownedHere()) resolveCover("o-" + g.id, g.name, g.sys ?? g.core, g.cover, g.id);
    fetchCatalog().then(({ games, errors }) => {
      setCatalog(games); setErrs(errors); setLoading(false);
      for (const c of games) if (inSystems(c.system)) resolveCover("c-" + c.id, c.name, c.system, c.cover);
    }).catch(() => { setLoading(false); });

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

  async function select() {
    const row = rows()[sel()];
    if (!row) return;
    if (row.kind === "owned") { props.onPlay(row.g); return; }
    const c = row.c;
    if (dl()[c.id] != null) return; // already downloading
    sfx.confirm();
    setNote(`Downloading ${c.name}…`);
    setDl((m) => ({ ...m, [c.id]: 0 }));
    try {
      const rec = await downloadGame(c, props.profileId, (f) => setDl((m) => ({ ...m, [c.id]: f })));
      setDl((m) => { const n = { ...m }; delete n[c.id]; return n; });
      setNote(`Downloaded ${c.name}`);
      props.onChanged();
      props.onPlay(rec);
    } catch (e: any) {
      setDl((m) => { const n = { ...m }; delete n[c.id]; return n; });
      sfx.deny();
      setNote(`Couldn't download ${c.name} — ${e?.message ?? "the host may block cross-origin. Put it in a source you control (a GitHub repo)."}`);
    }
  }

  async function remove() {
    const row = rows()[sel()];
    if (!row || row.kind !== "owned") return;
    await removeGame(row.g.id);
    sfx.back();
    setNote(`Removed ${row.g.name}${isLinked(row.g) && row.g.origin !== "download" ? " — the file on your disk is untouched" : ""}`);
    setSel(Math.max(0, sel() - 1));
    props.onChanged();
  }

  async function relink() {
    const row = rows()[sel()];
    if (!row || row.kind !== "owned" || !isLinked(row.g) || row.g.origin === "download" || !fsAccessSupported()) return;
    try {
      const [h] = await (window as any).showOpenFilePicker({ multiple: false });
      const f = await h.getFile();
      await relinkGame(row.g.id, h, f.size);
      sfx.confirm(); setNote(`${row.g.name} → re-linked`); props.onChanged();
    } catch { /* dismissed */ }
  }

  const badge = (row: Row) => {
    if (row.kind === "catalog") { const p = dl()[row.c.id]; return p != null ? (p < 0 ? "DOWNLOADING" : `${Math.round(p * 100)}%`) : "DOWNLOAD"; }
    return row.g.origin === "download" ? "DOWNLOADED" : isLinked(row.g) ? "LINKED" : "INSTALLED";
  };

  props.bind((a) => {
    if (a === "left") move(-1);
    else if (a === "right") move(1);
    else if (a === "up") move(-COLS);
    else if (a === "down") move(COLS);
    else if (a === "confirm") select();
    else if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="guide gameshelf">
      <div class="guide-head">
        <div>
          <div class="panel-tag">{props.title}</div>
          <div class="gamelib-sub">
            {ownedHere().length} in your library · downloadable games stream in from your sources · nothing leaves this machine
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

      <Show when={!loading() || rows().length} fallback={<div class="guide-loading">Loading your shelf…</div>}>
        <Show
          when={rows().length}
          fallback={
            <div class="guide-loading">
              Nothing here yet. “Bring your own” to add a game you have, or add a download catalog you control in Settings → Game Sources (a GitHub repo works great).
              <Show when={errs().length}><div class="gameshelf-errs">Sources with trouble: {errs().join(" · ")}</div></Show>
            </div>
          }
        >
          <TileGrid
            tiles={rows().map((row) => row.kind === "owned"
              ? { img: covers()[row.key], title: row.g.name.replace(/\.[^.]+$/, ""), sub: `${sysLabel(row.g.sys ?? row.g.core)} · ${mb(row.g.size)}`, badge: badge(row) }
              : { img: covers()[row.key], title: row.c.name.replace(/\.[^.]+$/, ""), sub: `${sysLabel(row.c.system)}${row.c.size ? " · " + mb(row.c.size) : ""} · ${row.c.sourceName}`, badge: badge(row) })}
            sel={sel()}
            shape="cover"
            fallback="🎮"
            onPick={(i) => { setSel(i); select(); }}
            onHover={(i) => setSel(i)}
          />
        </Show>
      </Show>

      <div class="panel-hint guide-hint">
        <span class="btn-x" /> play / download · <span class="btn-o" /> back · I bring own · {fsAccessSupported() ? "L link · " : ""}DEL remove · R re-link
      </div>
    </div>
  );
}
