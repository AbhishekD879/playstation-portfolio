// DOOM RTX — the original 1993 shareware E1M1 rebuilt as triangles and lit by
// real-time path tracing, entirely in WebGPU compute. Powered by James
// Randall's MIT-licensed <path-tracer> web component (vendored at
// /rtx/path-tracer.js, license alongside); the shareware WAD ships at
// /wads/DOOM1.WAD. This is a renderer study you can walk around in — physically
// correct light transport at ~30fps — not a playable shooter.
import { createSignal, onCleanup, onMount } from "solid-js";
import { setNavEnabled } from "../input";

export default function DoomRtx(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal("Building the BVH…");
  let host!: HTMLDivElement;

  onMount(() => {
    setNavEnabled(false); // WASD belongs to the ray-traced marine
    let el: HTMLElement | null = null;
    const boot = () => {
      el = document.createElement("path-tracer");
      el.setAttribute("scene", "doom");
      el.setAttribute("controls", "");
      host.appendChild(el);
      setStatus("");
    };
    // vendored module script (vite: /public JS loads via <script src>, not import)
    if (customElements.get("path-tracer")) boot();
    else {
      const s = document.createElement("script");
      s.type = "module";
      s.src = "/rtx/path-tracer.js";
      s.onload = () => customElements.whenDefined("path-tracer").then(boot);
      s.onerror = () => setStatus("Couldn't load the path tracer.");
      document.head.appendChild(s);
    }
    onCleanup(() => { setNavEnabled(true); el?.remove(); });
  });

  return (
    <div class="fullapp doomrtx">
      <div class="fullapp-mount doomrtx-mount" ref={host} />
      {status() && <div class="fullapp-status">{status()}</div>}
      <div class="doom-controls">
        ☢ E1M1, path-traced — click the canvas, then WASD + mouse · a light-transport study, not a shooter
      </div>
      <button class="session-eject" onClick={props.onClose}>⏏ EJECT</button>
    </div>
  );
}
