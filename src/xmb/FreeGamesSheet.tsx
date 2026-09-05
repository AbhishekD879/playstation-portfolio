// "Free games" on a shelf: homebrew and freely released titles the visitor can
// put on the shelf with one tap, so an empty shelf is never a dead end. The
// file is fetched by the browser from its source (or our allow-listed relay) and
// stored in the library like any other game — same sheet language as Systems.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { FREE_GAMES, downloadUrl, fileNameOf, freeGamesFor, type FreeGame } from "../freegames";
import { addGame, type GameRecord } from "../gamesdb";
import { SYSTEMS } from "../systems";

const kb = (n?: number) => (n ? (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "");

export default function FreeGamesSheet(props: { systems: readonly string[]; profileId: string; owned: GameRecord[]; onChanged: () => void }) {
  const all = () => freeGamesFor(props.systems);
  // a big shelf (the WASM-4 archive is 150 carts) gets a filter box; a short list stays a list
  const [q, setQ] = createSignal("");
  const games = () => {
    const needle = q().trim().toLowerCase();
    return needle ? all().filter((g) => `${g.title} ${g.author} ${g.note}`.toLowerCase().includes(needle)) : all();
  };
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [note, setNote] = createSignal("");
  const have = (g: FreeGame) => props.owned.some((r) => r.source === g.url);

  let pill!: HTMLButtonElement;
  let sheet!: HTMLElement;
  let body!: HTMLDivElement;
  const close = () => { sfx.back(); setOpen(false); queueMicrotask(() => pill.focus({ preventScroll: true })); };
  const show = () => { sfx.tickH(); setOpen(true); queueMicrotask(() => { body.scrollTop = 0; sheet.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); }); };

  async function grab(g: FreeGame) {
    if (busy()) return;
    setBusy(g.id); setNote(`Downloading ${g.title}…`);
    try {
      const res = await fetch(downloadUrl(g));
      if (!res.ok) throw new Error(`${res.status} from ${g.relay ? "the relay" : new URL(g.url).hostname}`);
      const blob = await res.blob();
      if (!blob.size) throw new Error("empty file");
      await addGame({
        id: Math.random().toString(36).slice(2, 10), profileId: props.profileId,
        name: fileNameOf(g), core: g.system, size: blob.size, addedAt: Date.now(), plays: 0,
        kind: "copy", blob, origin: "download", source: g.url,
      });
      props.onChanged();
      sfx.confirm(); setNote(`${g.title} is on your shelf`);
    } catch (e: any) {
      sfx.deny(); setNote(`Couldn't download ${g.title}: ${String(e?.message ?? e).slice(0, 80)}`);
    } finally { setBusy(null); }
  }

  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = [...sheet.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const i = rows.indexOf(document.activeElement as HTMLButtonElement);
        rows[(i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true });
      }
      if (e.key !== "Tab") e.stopPropagation();
    };
    addEventListener("keydown", keys, true);
    onCleanup(() => removeEventListener("keydown", keys, true));
  });

  return (
    <Show when={all().length}>
      <button class="hz-btn" ref={pill} aria-haspopup="dialog" aria-expanded={open()} onClick={show}>Free games · {all().length}</button>
      <Show when={open()}><div class="hz-sheet-scrim" onClick={close} /></Show>
      <aside class="hz-sheet" ref={sheet} hidden={!open()} role="dialog" aria-label="Free games for this shelf">
        <div class="hz-sheet-head">
          <div>
            <div class="t">Free games</div>
            <div class="s">{note() || "Homebrew and freely released titles — downloaded straight onto this shelf"}</div>
          </div>
        </div>
        <div class="hz-sheet-body" ref={body}>
          <Show when={all().length > 12}>
            <input class="hz-filter" type="search" placeholder={`Filter ${all().length} games…`} value={q()} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Filter free games" />
            <Show when={q() && !games().length}><div class="hz-sheet-note">Nothing matches "{q()}"</div></Show>
          </Show>
          <For each={games()}>{(g) => (
            <div class="hz-sys">
              <div class="hz-sys-head">
                <span class="t">{g.title}</span>
                <span class="hz-fit none">{SYSTEMS[g.system]?.name ?? g.system}</span>
              </div>
              <div class="s">{g.author}{g.year ? ` · ${g.year}` : ""}{g.size ? ` · ${kb(g.size)}` : ""} — {g.note}</div>
              <div class="s">{g.licence}</div>
              <div class="hz-bios">
                <Show when={have(g)} fallback={
                  <button class="hz-mini" disabled={!!busy()} onClick={() => void grab(g)}>{busy() === g.id ? "Downloading…" : "Download to shelf"}</button>
                }>
                  <span class="hz-fit ready">On your shelf</span>
                </Show>
              </div>
            </div>
          )}</For>
          <Show when={!FREE_GAMES.length}><div class="hz-sheet-note">Nothing listed yet.</div></Show>
        </div>
        <button class="hz-srow hz-sheet-close" onClick={close}>
          <span><span class="t">Close</span></span><span class="s">○</span>
        </button>
      </aside>
    </Show>
  );
}
