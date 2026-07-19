// Shared RPG Maker player host (MV/MZ iframe · EasyRPG iframe). Flow:
//   pre-launch card → [Play gesture] → fullscreen + boot → in-game → quit.
// The Play tap is deliberate: fullscreen and audio both need a user gesture,
// and it doubles as the "review before starting" screen (engine + memory).
// A diagnostics overlay listens for the diag shim the service worker injects
// into the game (errors + stuck/failed asset loads) so a hang is legible even
// on mobile where there's no console.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { holdWakeLock } from "../wakelock";
import { ENGINE_LABEL, ensureRpgSw, estimateRuntimeMB, looksHeavy, type RpgGame } from "../rpgm";
import { installable, isIOS, isStandalone, promptInstall } from "../pwa";
import TouchControls, { type KeyDef } from "./TouchControls";

type Snap = {
  source: string; up: number; scene: string; spinner: boolean; booted: boolean; canvas: boolean;
  pending: { path: string; age: number }[];
  recent: { path: string; status: unknown }[];
  counts: { ok: number; fail: number };
  errors: { msg: string; at: string }[];
  activity?: { path: string; ok: boolean; reason: string; t: number }[];
};

export default function RpgPlayer(props: {
  game: RpgGame; src: string; sublabel?: string; bootNote?: string;
  onClose: () => void; bind: (nav: (a: NavAction) => void) => void;
}) {
  const [phase, setPhase] = createSignal<"prelaunch" | "booting" | "ready" | "failed">("prelaunch");
  const [diag, setDiag] = createSignal<Snap | null>(null);
  const [showDiag, setShowDiag] = createSignal(false);
  const [showPad, setShowPad] = createSignal(false);
  const [barShown, setBarShown] = createSignal(true);
  // media probe: "" = fine · "gesture" = needs one real tap in the game frame
  // (autoplay blocked — synthetic pad keys carry no user activation) · else an
  // error string to show (e.g. Safari can't decode .webm movies)
  const [mediaHint, setMediaHint] = createSignal("");
  let mediaHintTimer: ReturnType<typeof setTimeout> | undefined;
  let frame!: HTMLIFrameElement;
  let container!: HTMLDivElement;
  let release: (() => void) | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let autoRevealed = false;

  const mem = estimateRuntimeMB(props.game);
  const heavy = looksHeavy(props.game);
  // "Has touch?" by actual capability — NOT @media (pointer: coarse), which is
  // false when the PRIMARY pointer is fine (a connected controller/mouse, or a
  // hybrid/stylus phone), and would leave the game eating touches so the
  // on-screen controls never fire. maxTouchPoints + any-pointer:coarse both stay
  // true when a touchscreen exists, regardless of what else is plugged in.
  const touch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    (typeof matchMedia === "function" && matchMedia("(any-pointer: coarse)").matches);

  const goFullscreen = () => {
    const el = container as unknown as { requestFullscreen?: (o?: object) => Promise<void>; webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement) return;
    const p = el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.() as unknown as Promise<void>;
    // Once fullscreen, lock to landscape — RPG Maker/Ren'Py render 16:9, so a
    // portrait phone otherwise letterboxes to a thin strip ("not full screen").
    // Android honours this; iOS Safari has no Fullscreen/orientation API for
    // elements, so it's a no-op there (add-to-home-screen PWA is the fix there).
    Promise.resolve(p)
      .then(() => { try { void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape"); } catch { /* unsupported */ } })
      .catch(() => {});
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement) (document.exitFullscreen?.() ?? (document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen?.() as unknown as Promise<void>)?.catch?.(() => {});
  };

  // the bar auto-hides for immersion; any tap on the top strip flashes it back
  function flashBar() {
    setBarShown(true);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (phase() === "ready" && !showDiag()) setBarShown(false); }, 4000);
  }

  function launch() {
    if (phase() !== "prelaunch") return;
    sfx.confirm();
    setPhase("booting");
    release = holdWakeLock();
    goFullscreen(); // must be inside the Play gesture
    ensureRpgSw()
      .then(() => { frame.src = props.src; setPhase("ready"); flashBar(); })
      .catch(() => setPhase("failed"));
  }

  function quit() {
    sfx.back();
    exitFullscreen();
    props.onClose();
  }

  // Send a real key event INTO the same-origin game iframe — its own key
  // listeners fire on synthetic events. Built with the IFRAME's KeyboardEvent
  // (so engines that check `instanceof` still match); keyCode/which are set for
  // engines that read them. Dispatched on the iframe's DOCUMENT only: a bubbling
  // event on document also reaches window-level listeners, so a game that listens
  // on either fires EXACTLY ONCE — dispatching to both document AND window makes
  // window listeners fire twice (double-input; masked in RPG Maker by its
  // per-frame input poll, but real for raw web/HTML5 games).
  const fireKey = (def: KeyDef, down: boolean) => {
    const win = frame?.contentWindow as (Window & { KeyboardEvent?: typeof KeyboardEvent }) | null;
    const doc = frame?.contentDocument;
    if (!win || !doc) return;
    const Ctor = win.KeyboardEvent ?? KeyboardEvent;
    const ev = new Ctor(down ? "keydown" : "keyup", { key: def.key, code: def.code, location: def.loc ?? 0, bubbles: true, cancelable: true, composed: true });
    try { Object.defineProperty(ev, "keyCode", { get: () => def.keyCode }); Object.defineProperty(ev, "which", { get: () => def.keyCode }); } catch { /* older engines */ }
    doc.dispatchEvent(ev);
  };

  onMount(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const d = e.data as Snap & { kind?: string; msg?: string };
      if (d && d.source === "rpgm-diag") setDiag(d as Snap);
      if (d && (d as { source?: string }).source === "rpgm-media") {
        clearTimeout(mediaHintTimer);
        if (d.kind === "gesture") setMediaHint("gesture");
        else if (d.kind === "unlocked") setMediaHint("");
        else if (d.kind === "error") {
          const m = d.msg ?? "";
          setMediaHint(/webm|code 4/i.test(m)
            ? `A cutscene video couldn't be decoded (${m}). This browser can't play .webm movies — Safari doesn't support them.`
            : `A cutscene video failed: ${m}`);
          mediaHintTimer = setTimeout(() => setMediaHint(""), 10000);
        }
      }
    };
    addEventListener("message", onMsg);
    // Esc: on desktop it exits browser fullscreen natively (fullscreenchange
    // reveals the bar so quitting is one tap away); on the pre-launch card it
    // backs out entirely.
    const onFs = () => { if (!document.fullscreenElement) flashBar(); };
    document.addEventListener("fullscreenchange", onFs);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase() === "prelaunch") props.onClose(); };
    addEventListener("keydown", onKey);
    onCleanup(() => {
      removeEventListener("message", onMsg);
      document.removeEventListener("fullscreenchange", onFs);
      removeEventListener("keydown", onKey);
      clearTimeout(hideTimer);
      clearTimeout(mediaHintTimer);
      release?.();
      exitFullscreen();
      // teardown: about:blank drops the JS heap, WebGL context and audio at once
      try { frame.src = "about:blank"; frame.removeAttribute("src"); } catch { /* gone */ }
    });
  });

  // auto-reveal diagnostics when something's wrong: a boot stall (once), OR a
  // NEW failure appears (so a broken cutscene surfaces the panel the moment it
  // fails) — throttled + only when closed, so we don't fight the user.
  let lastFailTotal = 0;
  let lastAutoOpen = -1e9;
  createEffect(() => {
    const d = diag();
    if (!d) return;
    if (!autoRevealed && !d.booted && d.up > 10000) { autoRevealed = true; setShowDiag(true); }
    const failTotal = d.errors.length + d.recent.length;
    if (failTotal > lastFailTotal && !showDiag() && d.up - lastAutoOpen > 8000) {
      lastAutoOpen = d.up; setShowDiag(true);
    }
    lastFailTotal = failTotal;
  });

  props.bind((a) => {
    if (phase() === "prelaunch") { if (a === "confirm") launch(); else if (a === "back") { sfx.back(); props.onClose(); } return; }
    if (a === "back") quit();
    else if (a === "options") { setShowDiag((v) => !v); flashBar(); }
  });

  const stuck = () => (diag()?.pending ?? []).filter((p) => p.age > 4000);
  const clean = () => { const d = diag(); return d && d.errors.length === 0 && stuck().length === 0 && d.recent.length === 0; };
  // debugger: wipe the in-game trace buffers so the next thing you do (trigger
  // the cutscene) shows a clean sequence of exactly what the engine did.
  const clearDiag = () => {
    try { (frame?.contentWindow as Window | null)?.postMessage({ __rpgmDiagClear: true }, "*"); } catch { /* frame gone */ }
    setDiag(null);
  };

  return (
    <div class="rpgplay" ref={container} classList={{ touch }}>
      <Show when={phase() === "prelaunch"}>
        <div class="rpg-launch">
          <div class="rpg-launch-tag">{(props.sublabel || ENGINE_LABEL[props.game.engine]).toUpperCase()}</div>
          <h2 class="rpg-launch-title">{props.game.title}</h2>
          <div class="rpg-launch-meta">
            ≈{mem} MB to run
            <Show when={heavy}><span class="rpg-launch-warn"> · may be heavy on this device</span></Show>
          </div>
          <button class="ps-act rpg-launch-play" onClick={launch}><span class="btn-x" /> play</button>
          <div class="rpg-launch-note">plays full screen · <span class="btn-o" /> or Esc to quit</div>
          {/* True device fullscreen on a phone needs the console installed to the
              home screen (no browser chrome). Offer it here, where it matters. */}
          <Show when={!isStandalone()}>
            <Show
              when={installable()}
              fallback={
                <div class="rpg-launch-install">
                  For real fullscreen on a phone, add this console to your Home Screen
                  {isIOS() ? " — tap Share, then “Add to Home Screen”." : " from your browser menu."}
                </div>
              }
            >
              <button class="ps-act rpg-launch-install-btn" onClick={() => void promptInstall()}>install as app</button>
            </Show>
          </Show>
        </div>
      </Show>

      <Show when={phase() === "booting"}>
        <div class="rpgplay-msg">Starting {props.game.title}…
          <Show when={props.bootNote}><br /><span class="rpgplay-dim">{props.bootNote}</span></Show>
        </div>
      </Show>

      <Show when={phase() === "failed"}>
        <div class="rpgplay-msg">Couldn't start this game.<br /><span class="rpgplay-dim">Your browser may block service workers in this context.</span></div>
      </Show>

      {/* allow-same-origin so the game reads its own OPFS-served files */}
      {/* ONE input owner at a time (user's model): controls HIDDEN → the game
          gets direct touch (RPG Maker's native tap-to-move etc. works);
          controls SHOWN → the iframe ignores touch so the overlay buttons are
          reliable (mobile WebKit otherwise bleeds touches through into the
          iframe) and taps can't collide with the game. Keys still reach the
          game either way (dispatched, not hit-tested). Desktop mouse unaffected. */}
      <iframe
        ref={frame}
        class="rpgplay-frame"
        classList={{ hidden: phase() !== "ready", "pad-open": showPad() && mediaHint() !== "gesture" }}
        title={props.game.title}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        allow="gamepad; fullscreen; autoplay"
      />

      {/* media probe verdicts — a needed tap, or the real reason a video died */}
      <Show when={phase() === "ready" && mediaHint() !== ""}>
        <div class="rpg-mediahint" classList={{ err: mediaHint() !== "gesture" }}
          onClick={() => { if (mediaHint() !== "gesture") setMediaHint(""); }}>
          {mediaHint() === "gesture"
            ? "▶ tap the game once to start video / sound"
            : mediaHint()}
        </div>
      </Show>

      <Show when={phase() === "ready"}>
        <div class="rpgplay-reveal" onPointerDown={flashBar} />
        <div class="rpgplay-bar" classList={{ show: barShown() }}>
          <div class="panel-tag">{props.game.title.toUpperCase()}{props.sublabel ? ` · ${props.sublabel}` : ""}</div>
          <div class="rpgplay-actions">
            <button class="ps-act" classList={{ on: showPad() }} onClick={() => { setShowPad((v) => !v); flashBar(); }}>⌨ controls</button>
            <button class="ps-act" onClick={() => { setShowDiag((v) => !v); flashBar(); }}>diagnostics</button>
            <button class="ps-act" onClick={goFullscreen}>full screen</button>
            <button class="ps-act" onClick={quit}><span class="btn-o" /> quit</button>
          </div>
        </div>
      </Show>

      {/* touch: a clear, always-there floating toggle for the on-screen controls
          (one tap, over a full-screen game — no reserved bar, no tiny handle).
          Hidden on desktop via CSS, where the bar's ⌨ button is used instead. */}
      <Show when={phase() === "ready"}>
        <button class="rpgplay-padfab" classList={{ on: showPad() }}
          onClick={() => { setShowPad((v) => !v); sfx.tickV(); }}
          aria-label="Show or hide the on-screen controls">
          <span class="padfab-ico">🎮</span>{showPad() ? "hide" : "controls"}
        </button>
      </Show>

      {/* on-screen controls — send keys into games that expect a keyboard */}
      <Show when={showPad() && phase() === "ready"}>
        <TouchControls send={fireKey} onClose={() => setShowPad(false)} />
      </Show>

      <Show when={showDiag() && phase() !== "prelaunch"}>
        <div class="rpg-diag">
          <div class="rpg-diag-head">
            <span>DIAGNOSTICS · engine trace</span>
            <span class="rpg-diag-btns">
              <button class="ps-act" onClick={clearDiag}>clear</button>
              <button class="ps-act" onClick={() => setShowDiag(false)}>close</button>
            </span>
          </div>
          <div class="rpg-diag-tip">Tap <b>clear</b>, then trigger the scene in-game — the list below is everything the engine did, newest first.</div>
          <div class="rpg-diag-state">
            {(() => {
              const d = diag();
              if (!d) return "waiting for the game to report…";
              const st = d.booted ? "running" : d.spinner ? "loading" : "starting";
              return `${st}${d.scene ? " · " + d.scene : ""} · ${Math.round(d.up / 1000)}s · ${d.counts.ok} ok / ${d.counts.fail} failed`;
            })()}
          </div>
          <Show when={(diag()?.errors.length ?? 0) > 0}>
            <div class="rpg-diag-sec">Errors</div>
            <For each={diag()!.errors}>{(e) => <div class="rpg-diag-row err">{e.msg}{e.at ? ` (${e.at})` : ""}</div>}</For>
          </Show>
          <Show when={stuck().length > 0}>
            <div class="rpg-diag-sec">Stuck loading (&gt;4s)</div>
            <For each={stuck()}>{(p) => <div class="rpg-diag-row warn">{p.path} · {Math.round(p.age / 1000)}s</div>}</For>
          </Show>
          <Show when={(diag()?.recent.length ?? 0) > 0}>
            <div class="rpg-diag-sec">Failed to load (likely the broken cutscene/asset)</div>
            <For each={diag()!.recent}>{(r) => <div class="rpg-diag-row err">{r.path} · {String(r.status)}</div>}</For>
          </Show>
          <Show when={(diag()?.activity?.length ?? 0) > 0}>
            <div class="rpg-diag-sec">Recent asset activity (newest first)</div>
            <For each={diag()!.activity}>{(a) => (
              <div class="rpg-diag-row" classList={{ err: !a.ok, dim: a.ok }}>{a.ok ? "✓" : "✗"} {a.path}{a.reason ? ` · ${a.reason}` : ""}</div>
            )}</For>
          </Show>
          <Show when={clean() && !(diag()?.activity?.length)}>
            <div class="rpg-diag-row dim">No errors or failed assets reported yet — trigger the cutscene, then check here.</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
