// RPG Maker cabinet — a bring-your-own-game player, JoiPlay-style. Drop a .zip
// of a game you own; the console detects which RPG Maker engine built it and
// routes to the right player: MV/MZ run natively (HTML5), 2000/2003 through
// EasyRPG, XP/VX/VX Ace through mkxp. Games live in OPFS, per profile, never
// uploaded — same bring-your-own ethos as the emulator ROM shelf.
import { For, Show, createSignal, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { Icon } from "./icons";
import {
  ENGINE_LABEL, engineKind, estimateRuntimeMB, importRpgZip, listRpgGames, looksHeavy, removeRpgGame,
  type ImportProgress, type RpgGame,
} from "../rpgm";
import RpgHtml5 from "./RpgHtml5";

export default function RpgMaker(props: { profile: { id: string }; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [games, setGames] = createSignal<RpgGame[]>([]);
  const [sel, setSel] = createSignal(0); // 0..n-1 games, n = import tile
  const [playing, setPlaying] = createSignal<RpgGame | null>(null);
  const [importing, setImporting] = createSignal<ImportProgress | null>(null);
  const [error, setError] = createSignal("");
  const [armDelete, setArmDelete] = createSignal<string | null>(null);
  let fileInput!: HTMLInputElement;
  let hostNav: ((a: NavAction) => void) | undefined; // the active player's nav
  let disarm: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => listRpgGames(props.profile.id).then(setGames);
  onMount(refresh);

  const cells = () => games().length + 1; // +1 import tile
  const importIdx = () => games().length;

  async function pickAndImport() {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    setError("");
    setImporting({ phase: "reading", pct: 0 });
    try {
      const g = await importRpgZip(f, props.profile.id, setImporting);
      await refresh();
      setSel(games().findIndex((x) => x.id === g.id));
      sfx.confirm();
    } catch (e: any) {
      setError(e?.message || "Couldn't import that zip");
      sfx.deny();
    } finally {
      setImporting(null);
    }
  }

  function launch(g: RpgGame) {
    if (engineKind(g.engine) === "none") { setError("This game's engine isn't supported."); sfx.deny(); return; }
    sfx.confirm();
    setPlaying(g);
  }

  async function del(g: RpgGame) {
    if (armDelete() !== g.id) {
      setArmDelete(g.id);
      sfx.tickV();
      if (disarm) clearTimeout(disarm);
      disarm = setTimeout(() => setArmDelete(null), 3000);
      return;
    }
    if (disarm) clearTimeout(disarm);
    setArmDelete(null);
    await removeRpgGame(g.id);
    await refresh();
    setSel((s) => Math.min(s, Math.max(0, cells() - 1)));
    sfx.back();
  }

  const cols = () => Math.min(4, Math.max(1, cells())); // grid is 4-wide (CSS), pad nav mirrors it

  props.bind((a) => {
    if (playing()) {
      if (hostNav) { hostNav(a); return; }      // a real player owns the pad
      if (a === "back") { setPlaying(null); sfx.back(); } // inline notice → back closes it
      return;
    }
    const n = cells();
    if (a === "left") { setSel((s) => Math.max(0, s - 1)); sfx.tickH(); }
    else if (a === "right") { setSel((s) => Math.min(n - 1, s + 1)); sfx.tickH(); }
    else if (a === "up") { setSel((s) => Math.max(0, s - cols())); sfx.tickV(); }
    else if (a === "down") { setSel((s) => Math.min(n - 1, s + cols())); sfx.tickV(); }
    else if (a === "confirm") {
      if (sel() === importIdx()) fileInput.click();
      else { const g = games()[sel()]; if (g) launch(g); }
    }
    else if (a === "options") { const g = games()[sel()]; if (g) void del(g); }
    else if (a === "back") { sfx.back(); props.onClose(); }
    setTimeout(() => document.querySelector(".rpg-cell.sel")?.scrollIntoView({ block: "nearest" }), 0);
  });

  return (
    <Show
      when={!playing()}
      fallback={(() => {
        const g = playing()!;
        const kind = engineKind(g.engine);
        const close = () => { setPlaying(null); hostNav = undefined; };
        if (kind === "html5") return <RpgHtml5 game={g} onClose={close} bind={(f) => (hostNav = f)} />;
        // 2000/2003 (EasyRPG) and XP/VX/VX Ace (mkxp) — detected & saved, but the
        // WASM engines need a self-hosted build to run in-browser; honest state.
        const engineName = kind === "easyrpg" ? "EasyRPG" : "mkxp";
        return (
          <div class="rpgplay">
            <div class="rpgplay-bar">
              <div class="panel-tag">{g.title.toUpperCase()}</div>
              <button class="ps-act" onClick={close}><span class="btn-o" /> back</button>
            </div>
            <div class="rpgplay-msg">
              {ENGINE_LABEL[g.engine]} runs on the <b>{engineName}</b> engine — not wired in yet.<br />
              <span class="rpgplay-dim">MV &amp; MZ games play now; the older engines are next. Your game is saved in the library and will play once its engine lands.</span>
            </div>
            <div class="rpgplay-hint"><span class="btn-o" /> back</div>
          </div>
        );
      })()}
    >
      <div class="rpgcab">
        <div class="guide-head">
          <div class="panel-tag">RPG MAKER — YOUR GAMES</div>
          <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
        </div>

        <Show when={importing()}>
          <div class="rpg-import">
            {importing()!.phase === "reading" ? "Reading the zip…"
              : importing()!.phase === "detecting" ? "Detecting the engine…"
              : `Installing… ${importing()!.pct}%`}
          </div>
        </Show>
        <Show when={error()}><div class="rpg-error">⚠ {error()}</div></Show>

        <div class="rpg-grid">
          <For each={games()}>
            {(g, i) => (
              <div class="rpg-cell" classList={{ sel: sel() === i() }} role="button" tabindex={0}
                onClick={() => { setSel(i()); launch(g); }}>
                <div class="rpg-cover">
                  <Show when={g.cover} fallback={<span class="rpg-cover-glyph"><Icon name="gamepad" /></span>}>
                    <img src={g.cover} alt="" />
                  </Show>
                  <span class="rpg-badge">{ENGINE_LABEL[g.engine].replace("RPG Maker ", "")}</span>
                </div>
                <div class="rpg-title">{g.title}</div>
                <button class="rpg-del" classList={{ armed: armDelete() === g.id }}
                  onClick={(e) => { e.stopPropagation(); setSel(i()); void del(g); }}>
                  {armDelete() === g.id ? "sure?" : "△ delete"}
                </button>
              </div>
            )}
          </For>
          {/* import tile */}
          <div class="rpg-cell rpg-import-tile" classList={{ sel: sel() === importIdx() }} role="button" tabindex={0}
            onClick={() => fileInput.click()}>
            <div class="rpg-cover rpg-cover-add"><span class="rpg-cover-glyph"><Icon name="plus" /></span></div>
            <div class="rpg-title">Add a game (.zip)</div>
          </div>
        </div>

        {/* advisory memory readout for the selected game — informs, never blocks */}
        <Show when={games()[sel()]}>
          {(g) => (
            <div class="rpg-meminfo" classList={{ heavy: looksHeavy(g()) }}>
              ≈ {estimateRuntimeMB(g())} MB to run · {(g().bytes / 1048576).toFixed(0)} MB on disk · saves kept on this device
              <Show when={looksHeavy(g())}> · ⚠ may be heavy on this device — still your call</Show>
            </div>
          )}
        </Show>

        <Show when={!games().length && !importing()}>
          <p class="rpg-empty-note">
            Drop in a zip of an RPG Maker game you own. <b>MV &amp; MZ play now</b>, natively in the console;
            2000/2003 and XP/VX/Ace are detected and saved, with their engines coming next.
            Nothing is uploaded — the game stays in this browser.
          </p>
        </Show>

        <div class="panel-hint guide-hint">←→↑↓ browse · <span class="btn-x" /> play · △ delete · <span class="btn-o" /> back</div>
        <input type="file" ref={fileInput} hidden accept=".zip,application/zip" onChange={() => void pickAndImport()} />
      </div>
    </Show>
  );
}
