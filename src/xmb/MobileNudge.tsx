// A one-time orientation card for phone visitors (the WhatsApp crowd lands
// here on mobile): what works here, what wants a computer. Shows only on a
// phone, once (dismissal persists), never for someone who installed the PWA.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { isIOS, isStandalone } from "../pwa";

const KEY = "asp.desknudge";

export default function MobileNudge() {
  const [show, setShow] = createSignal(false);

  onMount(() => {
    if (localStorage.getItem(KEY) === "1" || isStandalone()) return;
    const coarse = !!window.matchMedia?.("(pointer: coarse)")?.matches || navigator.maxTouchPoints > 0;
    const small = Math.min(innerWidth, innerHeight) < 640; // phones, not tablets/desktops
    if (!coarse || !small) return;
    const t = setTimeout(() => setShow(true), 1200); // let the boot settle first
    onCleanup(() => clearTimeout(t));
  });

  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } setShow(false); };

  return (
    <Show when={show()}>
      <div class="deskn-backdrop" onClick={dismiss}>
        <div class="deskn" onClick={(e) => e.stopPropagation()}>
          <div class="deskn-tag">HEADS UP</div>
          <h2 class="deskn-title">Phone-sized console</h2>
          <p class="deskn-body">
            Music, video, reading, the web tools and most games work right here — swipe the categories, tap to open.
            The heavy hitters (PS2, PSP, Dreamcast, 3D worlds, voice) want a <b>laptop or a controller</b>; each one
            tells you before it starts.
          </p>
          <button class="ps-act deskn-go" onClick={dismiss}><span class="btn-x" /> got it</button>
          <Show when={isIOS()}>
            <p class="deskn-note">On iPhone: Share → “Add to Home Screen” for a fuller-screen app.</p>
          </Show>
        </div>
      </div>
    </Show>
  );
}
