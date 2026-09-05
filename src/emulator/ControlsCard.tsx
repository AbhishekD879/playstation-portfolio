// "How to play" — the one card that ends button-mashing. Shows the scheme from
// src/controls.ts for a system, app or web game: what a phone shows and how to
// hold it, the keyboard map, the mouse, the controller, where to rebind. Opens
// by itself the first time a system boots (remembered per system), and any
// time from the "controls" button or the ? key.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { isTouchDevice, markControlsSeen, schemeFor } from "../controls";

export default function ControlsCard(props: { id: string; title: string; family?: string; open: boolean; onClose: () => void; onToggle: () => void }) {
  const scheme = () => schemeFor(props.id, props.family);
  const touchFirst = isTouchDevice();
  const [remember, setRemember] = createSignal(true);
  let ok!: HTMLButtonElement;

  const close = () => { if (remember()) markControlsSeen(props.id); props.onClose(); };

  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "?" || e.key === "F1") { e.preventDefault(); e.stopPropagation(); props.onToggle(); return; }
      if (!props.open) return;
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    addEventListener("keydown", keys, true);
    onCleanup(() => removeEventListener("keydown", keys, true));
  });

  const orientation = () => (scheme().orientation === "landscape" ? "Hold the phone sideways — the picture and the on-screen pad need the width." : "Upright or sideways, both work.");

  const Touch = () => (
    <section class="ctl-sec">
      <h4>On a phone or tablet</h4>
      <p>{scheme().touch}</p>
      <p class="ctl-orient">{orientation()}</p>
    </section>
  );
  const Desktop = () => (
    <>
      <Show when={scheme().keys.length}>
        <section class="ctl-sec">
          <h4>Keyboard</h4>
          <dl class="ctl-keys"><For each={scheme().keys}>{([k, what]) => <><dt><kbd>{k}</kbd></dt><dd>{what}</dd></>}</For></dl>
        </section>
      </Show>
      <Show when={scheme().mouse}><section class="ctl-sec"><h4>Mouse</h4><p>{scheme().mouse}</p></section></Show>
    </>
  );

  return (
    <Show when={props.open}>
      <div class="ctl-card" role="dialog" aria-modal="true" aria-label={`How to play ${props.title}`} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div class="ctl-panel">
          <div class="ctl-head">
            <span class="ctl-eyebrow">HOW TO PLAY</span>
            <h3>{props.title}</h3>
          </div>
          <div class="ctl-body">
            <Show when={touchFirst} fallback={<><Desktop /><Touch /></>}><Touch /><Desktop /></Show>
            <section class="ctl-sec"><h4>Controller</h4><p>{scheme().pad}</p></section>
            <Show when={scheme().tip}><p class="ctl-tip">{scheme().tip}</p></Show>
            <Show when={scheme().rebind}><p class="ctl-rebind">Change the bindings: {scheme().rebind}</p></Show>
          </div>
          <div class="ctl-foot">
            <label class="ctl-remember"><input type="checkbox" checked={remember()} onChange={(e) => setRemember(e.currentTarget.checked)} /> Don't show this again for {props.title}</label>
            <button class="ctl-ok" ref={ok} onClick={close} autofocus>Got it</button>
          </div>
          <div class="ctl-hint">Press <kbd>?</kbd> any time to see this again</div>
        </div>
      </div>
    </Show>
  );
}
