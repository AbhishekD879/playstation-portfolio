// Full-screen host for a web game (webgames.ts): a same-origin iframe and an
// EJECT. Removing the frame is the whole teardown, so nothing leaks into the
// console between plays.
import { createSignal, onCleanup, onMount } from "solid-js";
import ControlsCard from "./ControlsCard";
import { hasSeenControls } from "../controls";
import { setNavEnabled } from "../input";
import type { WebGame } from "../webgames";

export default function WebGameApp(props: { game: WebGame; onClose: () => void }) {
  let frame!: HTMLIFrameElement;
  const [help, setHelp] = createSignal(!hasSeenControls(props.game.id));
  onMount(() => { setNavEnabled(false); frame.focus(); onCleanup(() => setNavEnabled(true)); });
  return (
    <div class="palm-session frame-session">
      <iframe ref={frame} src={props.game.url} title={props.game.title} allow="gamepad; autoplay; fullscreen" />
      <button class="palm-help" onClick={() => setHelp(true)} title="How to play (?)">? controls</button>
      <button class="palm-eject" onClick={props.onClose}>⏏ EJECT</button>
      <ControlsCard id={props.game.id} title={props.game.title} open={help()} onClose={() => { setHelp(false); frame.focus(); }} onToggle={() => setHelp(!help())} />
    </div>
  );
}
