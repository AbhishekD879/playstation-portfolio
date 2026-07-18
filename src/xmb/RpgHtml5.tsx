// MV / MZ player — RPG Maker's modern HTML5 output runs natively (PixiJS), so
// this is not emulation. The extracted game lives in OPFS; the scoped
// /rpgm-fs/ service worker serves it at a real same-origin URL, which we point
// a sandboxed iframe at. PixiJS's XHR/fetch resource loading then Just Works.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { holdWakeLock } from "../wakelock";
import { ensureRpgSw, type RpgGame } from "../rpgm";

export default function RpgHtml5(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [status, setStatus] = createSignal<"booting" | "ready" | "failed">("booting");
  let frame!: HTMLIFrameElement;

  onMount(() => {
    const release = holdWakeLock();
    ensureRpgSw()
      .then(() => {
        const entry = props.game.entry || "index.html";
        frame.src = `/rpgm-fs/${props.game.id}/${entry}`;
        setStatus("ready");
      })
      .catch(() => setStatus("failed"));
    // memory priority: when this game closes/switches, tear it down completely
    // (about:blank drops the JS heap, WebGL context and audio at once) so no
    // game is ever left resident behind the next one.
    onCleanup(() => {
      release();
      try { frame.src = "about:blank"; frame.removeAttribute("src"); } catch { /* gone */ }
    });
  });

  // the game owns the keyboard/gamepad while it's focused; ◯ from the pad exits
  props.bind((a) => { if (a === "back") { sfx.back(); props.onClose(); } });

  return (
    <div class="rpgplay">
      <div class="rpgplay-bar">
        <div class="panel-tag">{props.game.title.toUpperCase()}</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <Show when={status() === "failed"}>
        <div class="rpgplay-msg">Couldn't start the local file server for this game.<br />Your browser may block service workers in this context.</div>
      </Show>
      {/* allow-same-origin so the game reads its own OPFS-served files; sandboxed
          otherwise. It's the user's own game on their own device. */}
      <iframe
        ref={frame}
        class="rpgplay-frame"
        classList={{ hidden: status() !== "ready" }}
        title={props.game.title}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        allow="gamepad; fullscreen; autoplay"
      />
      <Show when={status() === "booting"}>
        <div class="rpgplay-msg">Starting {props.game.title}…</div>
      </Show>
    </div>
  );
}
