// DOOM (1993, shareware episode — legally redistributable) via js-dos v8 WASM.
// The js-dos runtime loads from its CDN; the bundle is the official shareware WAD.
import { createSignal, onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";
import { startBridge, stopBridge, DOOM_CONFIG } from "../gamepadBridge";

const JSDOS = "https://v8.js-dos.com/latest/";
const BUNDLE = "https://v8.js-dos.com/bundles/doom.jsdos";

declare global {
  interface Window { Dos?: (el: HTMLElement, opts: Record<string, unknown>) => { stop: () => Promise<void> } }
}

export default function Doom(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal("Loading DOS…");
  let mount!: HTMLDivElement;
  let instance: { stop: () => Promise<void> } | null = null;

  onMount(() => {
    setNavEnabled(false); // WASD belongs to the marine now
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = JSDOS + "js-dos.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = JSDOS + "js-dos.js";
    script.onload = () => {
      setStatus("");
      instance = window.Dos!(mount, {
        url: BUNDLE,
        theme: "dark",
        renderAspect: "4/3",
        autoStart: true,
        kiosk: true,
      });
      // route a physical controller into the marine with a DOOM-tuned mapping
      startBridge(mount, props.onClose, DOOM_CONFIG);
    };
    script.onerror = () => setStatus("Couldn't reach the js-dos CDN.");
    document.body.appendChild(script);

    onCleanup(() => {
      setNavEnabled(true);
      stopBridge();
      instance?.stop().catch(() => {});
      script.remove();
      css.remove();
    });
  });

  return (
    <div class="fullapp">
      <div class="fullapp-mount" ref={mount} />
      {status() && <div class="fullapp-status">{status()}</div>}
      <div class="doom-controls">
        🎮 L-stick move · R-stick turn · RT/A fire · X/B open · LB/RB strafe · always-run · Start menu · Back quit
      </div>
      <button class="session-eject" onClick={props.onClose}>⏏ QUIT DOOM</button>
    </div>
  );
}
