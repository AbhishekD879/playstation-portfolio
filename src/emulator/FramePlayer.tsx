// A player for engines that live in their own same-origin page (TIC-80, WASM-4,
// Java ME…): the page says "ready", we post the game's bytes, it boots. Killing
// the iframe is a clean eject — no reload, no leaked emulator globals — which is
// the whole reason these engines get a frame instead of a mount point.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { bumpPlays, resolveGameFile, type GameRecord } from "../gamesdb";
import { setNavEnabled } from "../input";
import { SYSTEMS } from "../systems";
import ControlsCard from "./ControlsCard";
import { hasSeenControls } from "../controls";

export default function FramePlayer(props: { game: GameRecord; onClose: () => void }) {
  const [state, setState] = createSignal<"loading" | "running" | "error">("loading");
  const [detail, setDetail] = createSignal("");
  let frame!: HTMLIFrameElement;
  const src = () => SYSTEMS[props.game.core]?.frame ?? "";
  const [help, setHelp] = createSignal(!hasSeenControls(props.game.core));

  onMount(() => {
    setNavEnabled(false);
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
      if (e.data?.type === "exit") { props.onClose(); return; }
      if (e.data?.type === "ready") {
        try {
          const bytes = await (await resolveGameFile(props.game)).arrayBuffer();
          frame.contentWindow!.postMessage({ type: "cart", name: props.game.name, bytes }, location.origin, [bytes]);
          setState("running");
          void bumpPlays(props.game.id);
          frame.focus();
        } catch (err: any) {
          setDetail(String(err?.message ?? err).slice(0, 160));
          setState("error");
        }
      }
    };
    addEventListener("message", onMsg);
    onCleanup(() => { removeEventListener("message", onMsg); setNavEnabled(true); });
  });

  return (
    <div class="palm-session frame-session">
      <iframe ref={frame} src={src()} title={props.game.name} allow="gamepad; autoplay; fullscreen" />
      <Show when={state() !== "running"}>
        <div class="palm-veil">
          <Show when={state() === "loading"}><div class="palm-msg">POWERING ON<span>loading…</span></div></Show>
          <Show when={state() === "error"}><div class="palm-msg">COULDN'T START<span>{detail()}</span></div></Show>
        </div>
      </Show>
      <button class="palm-help" onClick={() => setHelp(true)} title="How to play (?)">? controls</button>
      <button class="palm-eject" onClick={props.onClose}>⏏ EJECT</button>
      <ControlsCard id={props.game.core} title={SYSTEMS[props.game.core]?.name ?? props.game.core} family={SYSTEMS[props.game.core]?.family} open={help()} onClose={() => { setHelp(false); frame.focus(); }} onToggle={() => setHelp(!help())} />
    </div>
  );
}
