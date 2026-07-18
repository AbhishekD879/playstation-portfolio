// A one-time "this is a desktop console" nudge for phone visitors (the WhatsApp
// crowd lands here on mobile). It STEERS to desktop — it doesn't try to improve
// the mobile experience. Shows only on a phone, once (dismissal persists), and
// never for someone who installed the PWA (they're already committed).
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
          <h2 class="deskn-title">Best on a computer</h2>
          <p class="deskn-body">
            AbhishekStation is a <b>desktop console</b> — built for a laptop with a keyboard, mouse, or a game
            controller. On a phone it's just a preview; open it on a computer to boot games, emulators and the
            visualizer with everything running.
          </p>
          <button class="ps-act deskn-go" onClick={dismiss}><span class="btn-x" /> explore anyway</button>
          <Show when={isIOS()}>
            <p class="deskn-note">On iPhone: Share → “Add to Home Screen” for a fuller-screen app.</p>
          </Show>
        </div>
      </div>
    </Show>
  );
}
