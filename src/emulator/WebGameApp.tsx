// Full-screen host for a web game (webgames.ts): a same-origin iframe and an
// EJECT. Removing the frame is the whole teardown, so nothing leaks into the
// console between plays.
import { onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import type { WebGame } from "../webgames";

export default function WebGameApp(props: { game: WebGame; onClose: () => void }) {
  let frame!: HTMLIFrameElement;
  onMount(() => { setNavEnabled(false); frame.focus(); onCleanup(() => setNavEnabled(true)); });
  return (
    <div class="palm-session frame-session">
      <iframe ref={frame} src={props.game.url} title={props.game.title} allow="gamepad; autoplay; fullscreen" />
      <button class="palm-eject" onClick={props.onClose}>⏏ EJECT</button>
    </div>
  );
}
