// Bring-your-own-game cabinet, JoiPlay-style. Drop a .zip of a game you own; the
// console detects the engine and routes to the right player. Two families share
// this component (separate apps, separate libraries): RPG Maker (MV/MZ native,
// 2000/2003 via EasyRPG, XP/VX/Ace detected-only) and Ren'Py (web builds play,
// desktop builds detected-only). Games live in OPFS, per profile, never
// uploaded — same ethos as the emulator ROM shelf.
import { For, Match, Show, Switch, createSignal, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { Icon } from "./icons";
import {
  ENGINE_LABEL, engineFamily, engineKind, estimateRuntimeMB, importRpgZip, listRpgGames, looksHeavy, reimportRpgZip, removeRpgGame,
  type ImportProgress, type RpgGame,
} from "../rpgm";
import RpgHtml5 from "./RpgHtml5";
import RpgEasyRpg from "./RpgEasyRpg";
import RpgRenPy from "./RpgRenPy";
import RpgWeb from "./RpgWeb";

type Family = "rpgmaker" | "renpy" | "web";
const FAMILY_NAME: Record<Family, string> = { rpgmaker: "RPG Maker", renpy: "Ren'Py", web: "Web Games" };

export default function RpgMaker(props: { profile: { id: string }; family: Family; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [games, setGames] = createSignal<RpgGame[]>([]);
  const [sel, setSel] = createSignal(0); // 0..n-1 games, n = import tile
  const [playing, setPlaying] = createSignal<RpgGame | null>(null);
  const [importing, setImporting] = createSignal<ImportProgress | null>(null);
  const [error, setError] = createSignal("");
  const [armDelete, setArmDelete] = createSignal<string | null>(null);
  // lite install: skip music & sounds — for phones that can't fit/handle the
  // full game. Applies to Add-a-game AND ↻ re-import while switched on.
  const [lite, setLite] = createSignal(false);
  let fileInput!: HTMLInputElement;
  let reimportInput!: HTMLInputElement;
  let reimportGame: RpgGame | null = null; // which game the re-import picker targets
  let hostNav: ((a: NavAction) => void) | undefined; // the active player's nav
  let disarm: ReturnType<typeof setTimeout> | null = null;
  let picking = false; // a file picker is open — re-entry lock (see openPicker)
  let pickCleanup: (() => void) | null = null;

  // Open a file picker ONCE. fileInput.click() fires from several paths (the
  // tile tap, pad "confirm", and synth-mode focused-button click); without a
  // lock a flickering controller button, a double-fire, or the mobile picker's
  // focus churn re-opens it in a tight loop ("file manager opening & closing
  // infinitely"). Lock on open; release when the window wakes (picker closed —
  // select OR cancel) or a hard timeout, whichever first.
  function openPicker(input: HTMLInputElement) {
    if (picking || importing()) return;
    // A file picker can only open with genuine user activation. A gamepad
    // "confirm" (or any synthetic click) has NONE — the browser rejects the
    // picker the instant it opens, and if the trigger repeats you get the
    // open/close blink. So on the pad path, bail when there's no activation
    // (real taps go through the <label> and never reach here).
    const ua = (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) { setError("Tap “Add a game” to pick a file (the on-screen tile, not the controller)."); sfx.tickV(); return; }
    pickCleanup?.(); // drop any stale listeners from a previous session
    picking = true;
    let done = false;
    const cleanup = () => { removeEventListener("focus", onWake); document.removeEventListener("visibilitychange", onVis); pickCleanup = null; };
    const clear = () => { if (done) return; done = true; picking = false; cleanup(); };
    const onWake = () => setTimeout(clear, 350);
    const onVis = () => { if (document.visibilityState === "visible") setTimeout(clear, 350); };
    pickCleanup = cleanup;
    addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onVis);
    setTimeout(clear, 10000); // hard backup if neither event fires
    input.click();
  }

  const isRenpy = () => props.family === "renpy";
  const isWeb = () => props.family === "web";
  // only this family's games (RPG Maker / Ren'Py / Web are separate libraries)
  const refresh = () => listRpgGames(props.profile.id).then((gs) => setGames(gs.filter((g) => engineFamily(g.engine) === props.family)));
  onMount(refresh);

  const cells = () => games().length + 1; // +1 import tile
  const importIdx = () => games().length;

  async function pickAndImport() {
    picking = false; // a change landed → picker closed
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    setError("");
    setImporting({ phase: "reading", pct: 0 });
    try {
      const g = await importRpgZip(f, props.profile.id, setImporting, { skipAudio: lite(), compressImages: lite() });
      await refresh();
      // the detector, not the cabinet, decides the family — if you dropped the
      // wrong kind here, it's saved but lives in the other app, so say so.
      if (engineFamily(g.engine) !== props.family) {
        setError(`That's a ${ENGINE_LABEL[g.engine]} game — it's saved in the ${FAMILY_NAME[engineFamily(g.engine)]} app.`);
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

  // replace a game's FILES in place (same id → saves survive) — the repair
  // path for zips imported before an importer fix, or updated game versions
  async function pickAndReimport() {
    picking = false; // a change landed → picker closed
    const f = reimportInput.files?.[0];
    const g = reimportGame;
    reimportInput.value = "";
    reimportGame = null;
    if (!f || !g) return;
    setError("");
    setImporting({ phase: "reading", pct: 0 });
    try {
      await reimportRpgZip(f, g, setImporting, { skipAudio: lite(), compressImages: lite() });
      await refresh();
      sfx.confirm();
    } catch (e: any) {
      setError(e?.message || "Couldn't re-import that zip");
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
      if (sel() === importIdx()) openPicker(fileInput);
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
        if (kind === "web") return <RpgWeb game={g} onClose={close} bind={(f) => (hostNav = f)} />;
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
          <div class="panel-tag">{isRenpy() ? "REN'PY — YOUR GAMES · EXPERIMENTAL" : isWeb() ? "WEB GAMES — YOUR GAMES" : "RPG MAKER — YOUR GAMES"}</div>
          <div class="rpg-headacts">
            <button class="ps-act" classList={{ on: lite() }} onClick={() => { setLite((v) => !v); sfx.tickV(); }}
              title="For phones that can't fit the full game: skips music & sounds and recompresses images (smaller, near-identical). Videos untouched. The game plays silent.">
              ♪ lite install: {lite() ? "on" : "off"}
            </button>
            <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
          </div>
        </div>
        <Show when={lite()}>
          <div class="rpg-lite-note">Lite install is on — music &amp; sounds are skipped and images are recompressed (much smaller, near-identical; videos untouched). The game plays silent. Applies to “Add a game” and “↻ re-import”. Import takes a little longer while images convert.</div>
        </Show>

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
                <div class="rpg-cellacts">
                  {/* label opens the picker natively; onClick just records which
                      game this re-import targets (runs before the native open) */}
                  <label for="rpg-reimport-file" class="rpg-del rpg-reimp" title="Replace the game files with a new zip — saves are kept"
                    onClick={(e) => { e.stopPropagation(); reimportGame = g; }}>
                    ↻ re-import
                  </label>
                  <button class="rpg-del" classList={{ armed: armDelete() === g.id }}
                    onClick={(e) => { e.stopPropagation(); setSel(i()); void del(g); }}>
                    {armDelete() === g.id ? "sure?" : "△ delete"}
                  </button>
                </div>
              </div>
            )}
          </For>
          {/* import tile — a real <label> so the tap natively opens the picker */}
          <label for="rpg-add-file" class="rpg-cell rpg-import-tile" classList={{ sel: sel() === importIdx() }}>
            <div class="rpg-cover rpg-cover-add"><span class="rpg-cover-glyph"><Icon name="plus" /></span></div>
            <div class="rpg-title">Add a game (.zip · .rar · .7z)</div>
          </label>
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
            <Switch>
              <Match when={isWeb()}>
                Drop in a zip of a game <b>already exported for the web</b> — a <b>Godot</b> HTML5 export, a
                <b> Unity</b> WebGL build, a <b>Wolf RPG</b> "Browser-Woditor" build, or any plain HTML5/WebGL
                game (a folder with an <code>index.html</code>). These run <b>natively</b> in the browser — no
                emulation. Desktop binaries (.exe) can't run here; export the game for web first. Nothing is
                uploaded — the game stays in this browser.
              </Match>
              <Match when={isRenpy()}>
                Drop in a Ren'Py <b>Web build</b> (open your game in the Ren'Py launcher and choose <b>Build → Web</b>,
                then zip &amp; import the result). Web builds play right here — engine and all. Desktop builds are
                detected and saved but can't run in a browser. Nothing is uploaded — the game stays in this browser.
              </Match>
              <Match when={true}>
                Drop in a <b>.zip, .rar or .7z</b> of an RPG Maker game you own. <b>MV, MZ, 2000 &amp; 2003 play now</b> —
                MV/MZ natively, 2000/2003 through EasyRPG (free RTP bundled). XP/VX/Ace are detected and saved but not
                yet playable. Nothing is uploaded — the game stays in this browser. (Very large .rar/.7z can be heavy on
                a phone — those formats unpack in memory; a .zip or a computer handles the biggest games best.)
              </Match>
            </Switch>
          </p>
        </Show>

        <div class="panel-hint guide-hint">←→↑↓ browse · <span class="btn-x" /> play · △ delete · <span class="btn-o" /> back</div>
        {/* Off-screen (NOT hidden — some Android browsers ignore .click() on a
            display:none input, which is what made the picker blink open/closed).
            A <label for> opens each natively on a real tap — no programmatic
            click, so nothing can loop it. */}
        <input id="rpg-add-file" class="rpg-file-input" type="file" ref={fileInput} accept=".zip,.rar,.7z,application/zip" onChange={() => void pickAndImport()} />
        <input id="rpg-reimport-file" class="rpg-file-input" type="file" ref={reimportInput} accept=".zip,.rar,.7z,application/zip" onChange={() => void pickAndReimport()} />
      </div>
    </Show>
  );
}
