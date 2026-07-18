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

type Snap = {
  source: string; up: number; scene: string; spinner: boolean; booted: boolean; canvas: boolean;
  pending: { path: string; age: number }[];
  recent: { path: string; status: unknown }[];
  counts: { ok: number; fail: number };
  errors: { msg: string; at: string }[];
};

export default function RpgPlayer(props: {
  game: RpgGame; src: string; sublabel?: string; bootNote?: string;
  onClose: () => void; bind: (nav: (a: NavAction) => void) => void;
}) {
  const [phase, setPhase] = createSignal<"prelaunch" | "booting" | "ready" | "failed">("prelaunch");
  const [diag, setDiag] = createSignal<Snap | null>(null);
  const [showDiag, setShowDiag] = createSignal(false);
  const [barShown, setBarShown] = createSignal(true);
  let frame!: HTMLIFrameElement;
  let container!: HTMLDivElement;
  let release: (() => void) | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let autoRevealed = false;

  const mem = estimateRuntimeMB(props.game);
  const heavy = looksHeavy(props.game);

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

  onMount(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const d = e.data as Snap;
      if (d && d.source === "rpgm-diag") setDiag(d);
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
      release?.();
      exitFullscreen();
      // teardown: about:blank drops the JS heap, WebGL context and audio at once
      try { frame.src = "about:blank"; frame.removeAttribute("src"); } catch { /* gone */ }
    });
  });

  // auto-reveal diagnostics when something's clearly wrong (an error, or boot
  // never completes) — once only, so we never fight a user who closed it.
  createEffect(() => {
    const d = diag();
    if (!d || autoRevealed) return;
    if (d.errors.length > 0 || (!d.booted && d.up > 10000)) { autoRevealed = true; setShowDiag(true); }
  });

  props.bind((a) => {
    if (phase() === "prelaunch") { if (a === "confirm") launch(); else if (a === "back") { sfx.back(); props.onClose(); } return; }
    if (a === "back") quit();
    else if (a === "options") { setShowDiag((v) => !v); flashBar(); }
  });

  const stuck = () => (diag()?.pending ?? []).filter((p) => p.age > 4000);
  const clean = () => { const d = diag(); return d && d.errors.length === 0 && stuck().length === 0 && d.recent.length === 0; };

  return (
    <div class="rpgplay" ref={container}>
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
      <iframe
        ref={frame}
        class="rpgplay-frame"
        classList={{ hidden: phase() !== "ready" }}
        title={props.game.title}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        allow="gamepad; fullscreen; autoplay"
      />

      <Show when={phase() === "ready"}>
        <div class="rpgplay-reveal" onPointerDown={flashBar} />
        <div class="rpgplay-bar" classList={{ show: barShown() }}>
          <div class="panel-tag">{props.game.title.toUpperCase()}{props.sublabel ? ` · ${props.sublabel}` : ""}</div>
          <div class="rpgplay-actions">
            <button class="ps-act" onClick={() => { setShowDiag((v) => !v); flashBar(); }}>diagnostics</button>
            <button class="ps-act" onClick={goFullscreen}>full screen</button>
            <button class="ps-act" onClick={quit}><span class="btn-o" /> quit</button>
          </div>
        </div>
      </Show>

      <Show when={showDiag() && phase() !== "prelaunch"}>
        <div class="rpg-diag">
          <div class="rpg-diag-head">
            <span>DIAGNOSTICS</span>
            <button class="ps-act" onClick={() => setShowDiag(false)}>close</button>
          </div>
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
            <div class="rpg-diag-sec">Failed to load</div>
            <For each={diag()!.recent}>{(r) => <div class="rpg-diag-row dim">{r.path} · {String(r.status)}</div>}</For>
          </Show>
          <Show when={clean()}>
            <div class="rpg-diag-row dim">No errors or failed assets reported.</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
