// Other OS — the PS3's most famous feature, resurrected: a full x86 PC
// (v86, wasm) booting KolibriOS inside the console. Self-hosted at /pc/.
import { onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

export default function PcApp(props: { onClose: () => void }) {
  let frame!: HTMLIFrameElement;

  onMount(() => {
    setNavEnabled(false); // the PC owns the keyboard now
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); });
    setTimeout(() => frame?.contentWindow?.focus(), 400);
  });

  return (
    <div class="pcapp">
      <div class="pcapp-bar">
        <div class="panel-tag">OTHER OS — x86 PC · KOLIBRIOS ON v86 · RUNS ON THIS CONSOLE</div>
        <span class="pcapp-hint">click the screen for mouse & keys · try the games in the bottom row — SNAKE, PONG, DOOM-ish</span>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>⏏ shut down</button>
      </div>
      <iframe ref={frame} class="pcapp-frame" src="/pc/index.html" title="Other OS" />
    </div>
  );
}
