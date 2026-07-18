// Bring-your-own-game cabinet, JoiPlay-style. Drop a .zip of a game you own; the
// console detects the engine and routes to the right player. Two families share
// this component (separate apps, separate libraries): RPG Maker (MV/MZ native,
// 2000/2003 via EasyRPG, XP/VX/Ace detected-only) and Ren'Py (web builds play,
// desktop builds detected-only). Games live in OPFS, per profile, never
// uploaded — same ethos as the emulator ROM shelf.
import { For, Show, createSignal, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { Icon } from "./icons";
import {
  ENGINE_LABEL, engineFamily, engineKind, estimateRuntimeMB, importRpgZip, listRpgGames, looksHeavy, removeRpgGame,
  type ImportProgress, type RpgGame,
} from "../rpgm";
import RpgHtml5 from "./RpgHtml5";
import RpgEasyRpg from "./RpgEasyRpg";
import RpgRenPy from "./RpgRenPy";

export default function RpgMaker(props: { profile: { id: string }; family: "rpgmaker" | "renpy"; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [games, setGames] = createSignal<RpgGame[]>([]);
  const [sel, setSel] = createSignal(0); // 0..n-1 games, n = import tile
  const [playing, setPlaying] = createSignal<RpgGame | null>(null);
  const [importing, setImporting] = createSignal<ImportProgress | null>(null);
  const [error, setError] = createSignal("");
  const [armDelete, setArmDelete] = createSignal<string | null>(null);
  let fileInput!: HTMLInputElement;
  let hostNav: ((a: NavAction) => void) | undefined; // the active player's nav
  let disarm: ReturnType<typeof setTimeout> | null = null;

  const isRenpy = () => props.family === "renpy";
  const otherApp = () => (isRenpy() ? "RPG Maker" : "Ren'Py");
  // only this family's games (RPG Maker and Ren'Py are separate libraries)
  const refresh = () => listRpgGames(props.profile.id).then((gs) => setGames(gs.filter((g) => engineFamily(g.engine) === props.family)));
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
      // the detector, not the cabinet, decides the family — if you dropped the
      // wrong kind here, it's saved but lives in the other app, so say so.
      if (engineFamily(g.engine) !== props.family) {
        setError(`That's a ${ENGINE_LABEL[g.engine]} game — it's saved in the ${otherApp()} app.`);
        sfx.tickV();
      } else {
        setSel(games().findIndex((x) => x.id === g.id));
        sfx.confirm();
      }
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
        if (kind === "easyrpg") return <RpgEasyRpg game={g} onClose={close} bind={(f) => (hostNav = f)} />;
        if (kind === "renpy") return <RpgRenPy game={g} onClose={close} bind={(f) => (hostNav = f)} />;
        // Not playable — detected & saved, but honest about why:
        //  · Ren'Py DESKTOP build: engine ships as platform-native modules and
        //    .rpyc is version-locked, so no single runtime plays arbitrary
        //    games — the author must re-export it "for web".
        //  · XP/VX/VX Ace (mkxp): only web build is mruby, needs per-game script
        //    porting + a MIDI synth, so it can't run arbitrary games.
        const isRenpyDesktop = g.engine === "renpydesktop";
        return (
          <div class="rpgplay">
            <div class="rpgplay-bar">
              <div class="panel-tag">{g.title.toUpperCase()}</div>
              <button class="ps-act" onClick={close}><span class="btn-o" /> back</button>
            </div>
            <div class="rpgplay-msg">
              {isRenpyDesktop ? <>This is a Ren'Py <b>desktop</b> build — it can't run in a browser.</> : <>{ENGINE_LABEL[g.engine]} isn't supported yet.</>}<br />
              <span class="rpgplay-dim">
                {isRenpyDesktop
                  ? "Ren'Py's engine ships as platform-native code and its scripts are locked to one engine version, so no single in-browser runtime can play arbitrary desktop games. Open the game in the Ren'Py launcher and Build → Web, then import that zip — web builds play here."
                  : "XP/VX/VX Ace need a Ruby (RGSS) engine that can't run arbitrary games in a browser today. MV, MZ, 2000 & 2003 all play now. Your game is saved in the library."}
              </span>
            </div>
            <div class="rpgplay-hint"><span class="btn-o" /> back</div>
          </div>
        );
      })()}
    >
      <div class="rpgcab">
        <div class="guide-head">
          <div class="panel-tag">{isRenpy() ? "REN'PY — YOUR GAMES · EXPERIMENTAL" : "RPG MAKER — YOUR GAMES"}</div>
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
                  <span class="rpg-badge">{g.engine === "renpydesktop" ? "Ren'Py ⚠" : ENGINE_LABEL[g.engine].replace("RPG Maker ", "")}</span>
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
            <Show
              when={isRenpy()}
              fallback={<>
                Drop in a zip of an RPG Maker game you own. <b>MV, MZ, 2000 &amp; 2003 play now</b> — MV/MZ natively,
                2000/2003 through EasyRPG (free RTP bundled). XP/VX/Ace are detected and saved but not yet playable.
                Nothing is uploaded — the game stays in this browser.
              </>}
            >
              Drop in a Ren'Py <b>Web build</b> (open your game in the Ren'Py launcher and choose <b>Build → Web</b>,
              then zip &amp; import the result). Web builds play right here — engine and all. Desktop builds are
              detected and saved but can't run in a browser. Nothing is uploaded — the game stays in this browser.
            </Show>
          </p>
        </Show>

        <div class="panel-hint guide-hint">←→↑↓ browse · <span class="btn-x" /> play · △ delete · <span class="btn-o" /> back</div>
        <input type="file" ref={fileInput} hidden accept=".zip,application/zip" onChange={() => void pickAndImport()} />
      </div>
    </Show>
  );
}
