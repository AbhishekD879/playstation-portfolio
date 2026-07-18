// EasyRPG host — RPG Maker 2000/2003. We self-host the EasyRPG Player
// (Emscripten/WASM) under /rpgm/easyrpg/, so its game fetches resolve to
// /rpgm/easyrpg/games/<id>/* — which our service worker serves out of OPFS
// (the game's files + a generated index.json manifest, with the bundled
// CC-BY RTP filling any gaps). The engine runs in a sandboxed iframe.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { holdWakeLock } from "../wakelock";
import { ensureRpgSw, type RpgGame } from "../rpgm";

export default function RpgEasyRpg(props: { game: RpgGame; onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [status, setStatus] = createSignal<"booting" | "ready" | "failed">("booting");
  let frame!: HTMLIFrameElement;

  onMount(() => {
    const release = holdWakeLock();
    ensureRpgSw()
      .then(() => { frame.src = `/rpgm/easyrpg/play.html?game=${props.game.id}`; setStatus("ready"); })
      .catch(() => setStatus("failed"));
    // memory: tear the engine + its ~9MB wasm instance down on close/switch
    onCleanup(() => {
      release();
      try { frame.src = "about:blank"; frame.removeAttribute("src"); } catch { /* gone */ }
    });
  });

  props.bind((a) => { if (a === "back") { sfx.back(); props.onClose(); } });

  return (
    <div class="rpgplay">
      <div class="rpgplay-bar">
        <div class="panel-tag">{props.game.title.toUpperCase()} · EASYRPG</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <Show when={status() === "failed"}>
        <div class="rpgplay-msg">Couldn't start the EasyRPG engine.<br /><span class="rpgplay-dim">Your browser may block service workers in this context.</span></div>
      </Show>
      <iframe
        ref={frame}
        class="rpgplay-frame"
        classList={{ hidden: status() !== "ready" }}
        title={props.game.title}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
        allow="gamepad; fullscreen; autoplay"
      />
      <Show when={status() === "booting"}>
        <div class="rpgplay-msg">Starting {props.game.title}…<br /><span class="rpgplay-dim">first run downloads the ~9 MB engine</span></div>
      </Show>
      <div class="rpgplay-hint"><span class="btn-o" /> back</div>
    </div>
  );
}
