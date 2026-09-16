// Full-screen host for a web game (webgames.ts): a same-origin iframe and an
// EJECT. Removing the frame is the whole teardown, so nothing leaks into the
// console between plays.
import { createSignal, onCleanup, onMount } from "solid-js";
import ControlsCard from "./ControlsCard";
import { hasSeenControls } from "../controls";
import { setNavEnabled } from "../input";
import type { WebGame } from "../webgames";

/** Games whose page draws its own on-screen pad decide when to show it from the
 *  pointer type, which is right on a phone and wrong on a laptop with a
 *  touchscreen — and wrong again for anyone who simply wants the pad. So the
 *  choice is offered here, next to EJECT, and remembered per game.
 *
 *  The frame is same-origin, but this talks to it by postMessage rather than
 *  reaching into contentWindow: the page owns how it draws the pad, this only
 *  says whether it is wanted. */
const touchKey = (id: string) => `asp.touchpad.${id}`;

export default function WebGameApp(props: { game: WebGame; onClose: () => void }) {
  let frame!: HTMLIFrameElement;
  const [help, setHelp] = createSignal(!hasSeenControls(props.game.id));

  const saved = (): boolean | undefined => {
    try {
      const raw = localStorage.getItem(touchKey(props.game.id));
      return raw === null ? undefined : raw === "1";
    } catch { return undefined; }
  };
  // No saved answer means "let the page decide", which is its pointer sniff.
  const [pad, setPad] = createSignal(saved() ?? matchMedia("(pointer: coarse)").matches);

  const tell = () => {
    frame?.contentWindow?.postMessage({ type: "touch-controls", on: pad() }, location.origin);
  };
  const toggle = () => {
    const next = !pad();
    setPad(next);
    try { localStorage.setItem(touchKey(props.game.id), next ? "1" : "0"); } catch { /* private mode */ }
    tell();
    frame.focus();
  };

  onMount(() => {
    setNavEnabled(false);
    frame.focus();
    onCleanup(() => setNavEnabled(true));
  });

  return (
    <div class="palm-session frame-session">
      {/* onLoad, not onMount: the page has to exist before it can be told anything. */}
      <iframe ref={frame} src={props.game.url} title={props.game.title} allow="gamepad; autoplay; fullscreen" onLoad={tell} />
      <button class="palm-help" onClick={() => setHelp(true)} title="How to play (?)">? controls</button>
      {props.game.touchControls && (
        <button class="palm-touch" aria-pressed={pad()} onClick={toggle}
          title="Show or hide the on-screen controls">
          {pad() ? "◉ TOUCH" : "○ TOUCH"}
        </button>
      )}
      <button class="palm-eject" onClick={props.onClose}>⏏ EJECT</button>
      <ControlsCard id={props.game.id} title={props.game.title} open={help()} onClose={() => { setHelp(false); frame.focus(); }} onToggle={() => setHelp(!help())} />
    </div>
  );
}
