// Controller test — a real 3D controller (DualSense or Xbox) that lights up its
// controls live as you press, with audio + rumble. Auto-picks the model from
// the detected pad; toggle manually if you like. A compact diagnostics strip
// stays for the "is the browser even seeing my pad?" case.
import { Show, Suspense, createSignal, lazy, onCleanup, onMount } from "solid-js";
import type { PadModel } from "./Controller3D";
import * as sfx from "../audio";

const Controller3D = lazy(() => import("./Controller3D"));

const detectModel = (id: string): PadModel => (/xbox|xinput|microsoft/i.test(id) ? "xbox" : "dualsense");

export default function GamepadTest(props: { onClose: () => void }) {
  const [connected, setConnected] = createSignal(false);
  const [focused, setFocused] = createSignal(true);
  const [padId, setPadId] = createSignal("");
  const [model, setModel] = createSignal<PadModel>("dualsense");
  const [active, setActive] = createSignal<string | null>(null);
  const [userPicked, setUserPicked] = createSignal(false);
  let root!: HTMLDivElement;

  onMount(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    addEventListener("keydown", esc);
    try { window.focus(); root?.focus(); } catch { /* ignore */ } // Chrome only feeds the focused doc
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      setFocused(document.hasFocus());
      const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected !== false);
      const std = pads.filter((p) => p.mapping === "standard");
      const p = std[std.length - 1] ?? pads[0] ?? null;
      setConnected(!!p);
      if (p && p.id !== padId()) {
        setPadId(p.id);
        if (!userPicked()) setModel(detectModel(p.id)); // auto-pick until the user overrides
      }
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => { cancelAnimationFrame(raf); removeEventListener("keydown", esc); });
  });

  const pick = (m: PadModel) => { setModel(m); setUserPicked(true); sfx.tickH(); };

  return (
    <div class="gptest" ref={root} tabindex="-1" onClick={() => { try { window.focus(); } catch { /* ignore */ } }}>
      <div class="gptest-head">
        <div class="panel-tag">CONTROLLER TEST</div>
        <div class="ctl3d-toggle">
          <button classList={{ on: model() === "dualsense" }} onClick={() => pick("dualsense")}>DualSense</button>
          <button classList={{ on: model() === "xbox" }} onClick={() => pick("xbox")}>Xbox</button>
        </div>
        <button class="ps-act" onClick={props.onClose}><span class="btn-o" /> back</button>
      </div>

      <Show
        when={connected()}
        fallback={
          <div class="gptest-empty">
            <div class="gptest-big">No controller detected.</div>
            <p>Connect a controller and press any button on it <b>now</b>, with this tab focused
              {focused() ? "" : " — the tab isn't focused, click the page"}.</p>
            <p style={{ "max-width": "580px", "font-size": "13px" }}>
              Nothing showing up? It's almost always <b>Safari</b> (use Chrome/Edge), an unfocused tab, or
              another app (<b>Steam</b>, a game, macOS Game Controller) grabbing the pad — quit those. The 3D
              controller below will light up its buttons the moment your pad comes through.
            </p>
          </div>
        }
      >
        <div class="ctl3d-wrap">
          <Suspense fallback={<div class="ctl3d-status">Loading 3D controller…</div>}>
            <Controller3D model={model()} onActive={(l) => { if (l !== active()) setActive(l); }} />
          </Suspense>
          <div class="ctl3d-active" classList={{ lit: !!active() }}>
            {active() ? active() : "press anything on your controller"}
          </div>
        </div>
        <div class="gptest-foot" classList={{ warn: !focused() }}>
          <span class="gptest-dot" classList={{ on: connected() }} />
          {padId() ? padId().slice(0, 48) : "detecting…"} · tab focused: <b>{focused() ? "yes" : "NO — click the page"}</b>
          <span class="gptest-credit">3D models via Sketchfab · CC-BY</span>
        </div>
      </Show>
    </div>
  );
}
