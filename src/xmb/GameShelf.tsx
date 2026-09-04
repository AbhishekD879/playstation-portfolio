// GameShelf — the library shown INSIDE the PS2, PSP and retro homes. A cover-art
// grid of YOUR games (linked from disk / copied into the console). ✕ plays;
// DEL removes an entry; R re-links a moved file. Bring-your-own (copy) and
// link-from-disk are the action buttons up top. Games come from your own local
// files only — nothing is fetched from the internet.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import SystemsSheet from "./SystemsSheet";
import { SYSTEMS } from "../systems";
import { CORE_NAMES, coverCandidates, fsAccessSupported, isLinked, relinkGame, removeGame, saveCover, type GameRecord, type GameSystem } from "../gamesdb";
import type { NavAction } from "../input";
import { generateCover } from "../covers";
import * as sfx from "../audio";

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
  const [opts, setOpts] = createSignal(false);
  const [confirmRm, setConfirmRm] = createSignal(false);
  const closeOpts = () => { setOpts(false); setConfirmRm(false); };

  const inSystems = (s: string) => props.systems.includes(s as GameSystem);
  const rows = () => props.owned.filter((g) => inSystems(g.sys ?? g.core));

  const resolveCover = (g: GameRecord) => {
    if (g.cover) { setCovers((c) => ({ ...c, [g.id]: g.cover! })); return; }
    const urls = coverCandidates(g);
    const tryNext = (list: string[]) => {
      if (!list.length) {
        // no real boxart exists for this dump — draw one from the title so the
        // shelf never shows a blank tile (deterministic, offline, instant)
        const art = generateCover(g.name, CORE_NAMES[g.sys ?? g.core] ?? "");
        setCovers((c) => ({ ...c, [g.id]: art }));
        saveCover(g.id, art);
        return;
      }
      const img = new Image();
      img.onload = () => { setCovers((c) => ({ ...c, [g.id]: list[0] })); saveCover(g.id, list[0]); };
      img.onerror = () => tryNext(list.slice(1));
      img.src = list[0];
    };
    tryNext(urls);
  };

  // The library is fetched by the parent AFTER first paint, so a mount-time
  // pass resolves nothing. Follow rows() and fill in art as records arrive.
  createEffect(() => { for (const g of rows()) if (!covers()[g.id]) resolveCover(g); });

  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && opts()) { e.preventDefault(); e.stopPropagation(); closeOpts(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      else if (e.key.toLowerCase() === "r") relink();
      else if (e.key.toLowerCase() === "i") props.onInsert();
      else if (e.key.toLowerCase() === "l") props.onLink?.();
    };
    addEventListener("keydown", keys);
    onCleanup(() => removeEventListener("keydown", keys));
  });

  let railEl: HTMLDivElement | undefined;
  const move = (d: number) => {
    const n = rows().length; if (!n) return;
    setSel(Math.max(0, Math.min(n - 1, sel() + d))); sfx.tickV();
    // the shelf scrolls once it outgrows the screen — walking off the edge with
    // a pad has to drag the rail along, or focus vanishes
    railEl?.children[sel()]?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  async function remove() {
    const g = rows()[sel()];
    if (!g) return;
    await removeGame(g.id);
    sfx.back();
    setNote(`Removed ${g.name}${isLinked(g) && g.origin !== "download" ? " — the file on your disk is untouched" : ""}`);
    setSel(Math.max(0, sel() - 1));
    closeOpts();
    props.onChanged();
  }

  async function relink() {
    const g = rows()[sel()];
    if (!g || !isLinked(g) || g.origin === "download" || !fsAccessSupported()) return;
    try {
      const [h] = await (window as any).showOpenFilePicker({ multiple: false });
      const f = await h.getFile();
      await relinkGame(g.id, h, f.size);
      sfx.confirm(); setNote(`${g.name} → re-linked`); closeOpts(); props.onChanged();
    } catch { /* dismissed */ }
  }

  const badge = (g: GameRecord) => (g.origin === "download" ? "DOWNLOADED" : isLinked(g) ? "LINKED" : "INSTALLED");

  props.bind((a) => {
    if (a === "left") move(-1);
    else if (a === "right") move(1);
    // Horizon lays the shelf out as one rail, so there is no row above or
    // below — up/down page along it rather than jumping by a grid width.
    else if (a === "up") move(-5);
    else if (a === "down") move(5);
    else if (a === "confirm") { if (opts()) return; if (rows()[sel()]) { sfx.tickH(); setConfirmRm(false); setOpts(true); } }
    else if (a === "back") { sfx.back(); if (opts()) closeOpts(); else props.onClose(); }
  });

  const cur = () => rows()[sel()];
  const clean = (n: string) => n.replace(/\.[^.]+$/, "");

  // The backdrop is the focused game's own cover, blurred — real boxart where
  // one exists, the console's generated art where it doesn't. Moving along the
  // rail repaints the room.
  const backdrop = () => (cur() ? covers()[cur()!.id] ?? "" : "");

  // The Control Center bar is the system row from the approved design. Every
  // icon here is wired to something the console really does — Home closes the
  // app, and the console's own documented shortcuts open Search (/) and the
  // full Control Center overlay (`). No decorative buttons.
  // "Bring your own" (copy the file in) and "Link from disk" (keep it on your
  // drive) are two storage mechanisms, not two user intentions — both are "add
  // a game". One button, and the console picks: link where the browser
  // supports it (nothing duplicated, no quota), copy where it doesn't. The
  // I / L keys still reach either one explicitly.
  const canLink = () => fsAccessSupported() && !!props.onLink;
  const addGame = () => (canLink() ? props.onLink!() : props.onInsert());

  const tap = (key: string) => dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

  return (
    <div class="hz gameshelf">
      <img class="hz-bd" classList={{ on: !!backdrop() }} src={backdrop()} alt="" aria-hidden="true" />
      <div class="hz-scrim" />
      <div class="hz-lay">

        <div class="hz-top">
          <span class="who"><span class="av" />{props.title.split("—")[0].trim()}</span>
          <span>· {rows().length} game{rows().length === 1 ? "" : "s"}</span>
          <Show when={note()}><span>· {note()}</span></Show>
          <span class="sp">nothing here leaves this device</span>
        </div>

        <Show
          when={cur()}
          fallback={
            <div class="hz-hero">
              <div class="hz-kick">{props.title}</div>
              <h2 class="hz-title">Your library is empty.<br />That takes one file to fix.</h2>
              <div class="hz-meta"><span>Games stay on this device — nothing is uploaded, ever</span></div>
              <div class="hz-acts">
                <button class="hz-btn pri" onClick={addGame}><span class="g">✕</span> Add a game</button>
                {props.extra?.()}
                <SystemsSheet systems={props.systems} />
              </div>
            </div>
          }
        >
          <div class="hz-hero">
            <div class="hz-kick">{props.title}</div>
            <h2 class="hz-title">{clean(cur()!.name)}</h2>
            <div class="hz-meta">
              <span>{sysLabel(cur()!.sys ?? cur()!.core)}</span>
              <Show when={mb(cur()!.size)}><span class="d" /><span>{mb(cur()!.size)}</span></Show>
              <span class="d" /><span>{badge(cur()!).toLowerCase()}</span>
              <Show when={SYSTEMS[cur()!.sys ?? cur()!.core]?.fit?.note}><span class="d" /><span class="hz-fitnote">{SYSTEMS[cur()!.sys ?? cur()!.core]!.fit!.note}</span></Show>
            </div>
            <div class="hz-acts">
              <button class="hz-btn" onClick={addGame}><span class="g">△</span> Add a game</button>
              {props.extra?.()}
              <SystemsSheet systems={props.systems} />
            </div>
          </div>
        </Show>

        <div class="hz-rail" ref={railEl}>
          <For each={rows()}>
            {(g, i) => (
              <button
                class="hz-tile" classList={{ on: i() === sel() }}
                onClick={() => { setSel(i()); sfx.tickH(); setConfirmRm(false); setOpts(true); }}
                onPointerEnter={() => setSel(i())}
                aria-label={clean(g.name)}
              >
                <Show
                  when={covers()[g.id]}
                  fallback={<span class="cap"><b>{clean(g.name)}</b><i>{sysLabel(g.sys ?? g.core)}</i></span>}
                >
                  <img src={covers()[g.id]} alt="" />
                </Show>
              </button>
            )}
          </For>
          {/* adding a game lives where you are already looking, not in a toolbar */}
          <button class="hz-tile ghost" onClick={addGame}><span>+ add<br />a game</span></button>
          <Show when={!rows().length}>
            <button class="hz-tile ghost" style="opacity:.42" onClick={addGame}><span>your games<br />appear here</span></button>
          </Show>
        </div>

        <Show when={cur()}>
          <aside class="hz-sheet" hidden={!opts()} aria-label="Game options">
            <div class="hz-sheet-head">
              <Show when={covers()[cur()!.id]}><img src={covers()[cur()!.id]} alt="" /></Show>
              <div>
                <div class="t">{clean(cur()!.name)}</div>
                <div class="s">{sysLabel(cur()!.sys ?? cur()!.core)}{mb(cur()!.size) ? ` · ${mb(cur()!.size)}` : ""} · {badge(cur()!).toLowerCase()}</div>
              </div>
            </div>
            <button class="hz-srow pri" onClick={() => { closeOpts(); props.onPlay(cur()!); }}>
              <span><span class="t">Play</span><span class="s">start the game</span></span>
            </button>
            <button
              class="hz-srow" disabled={!(isLinked(cur()!) && cur()!.origin !== "download" && fsAccessSupported())}
              onClick={relink}
            >
              <span>
                <span class="t">Re-link the file…</span>
                <span class="s">
                  {isLinked(cur()!) && cur()!.origin !== "download"
                    ? "point the console at it again if you moved it"
                    : "only for games linked from your drive"}
                </span>
              </span>
            </button>
            <button class="hz-srow warn" onClick={() => (confirmRm() ? remove() : setConfirmRm(true))}>
              <span>
                <span class="t">{confirmRm() ? "Remove — tap again to confirm" : "Remove from library"}</span>
                <span class="s">
                  {isLinked(cur()!) && cur()!.origin !== "download"
                    ? "the file on your disk is untouched"
                    : "deletes the copy stored in the console"}
                </span>
              </span>
            </button>
            <button class="hz-srow" onClick={closeOpts} style="margin-top:auto">
              <span><span class="t">Close</span></span><span class="s">○</span>
            </button>
          </aside>
        </Show>

        <div class="hz-cc">
          <button class="hz-cc-i on" title="Home" onClick={() => { sfx.back(); props.onClose(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 10.5 12 4l8 6.5V20H4z" /></svg>
          </button>
          <button class="hz-cc-i" title="Search" onClick={() => { props.onClose(); setTimeout(() => tap("/"), 60); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
          </button>
          <button class="hz-cc-i" title="Control Center" onClick={() => tap("`")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3.1" /><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" /></svg>
          </button>
          <div class="hz-cc-lbl">
            <b>{opts() ? "✕ choose · ○ close" : cur() ? "✕ open a game · △ add a game · ○ back" : "✕ add a game · ○ back"}</b>
            {canLink() ? "plays from your drive · I copies instead" : "copied into the console"}
          </div>
        </div>
      </div>
    </div>
  );
}
