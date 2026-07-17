// Controller diagnostic — shows the RAW gamepad state live so we can see
// exactly what a given pad reports: whether polling updates at all, which
// button indices fire, and where the sticks/d-pad live. Purely a readout.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

interface Snap {
  id: string;
  mapping: string;
  frames: number;
  buttons: number[]; // value per button
  axes: number[];
  lastBtn: number;
  none: boolean;
  slots: number;         // navigator.getGamepads() length
  present: number;       // how many non-null slots
  focused: boolean;      // does the document have focus?
  raw: (string | null)[]; // per-slot id (or null) — is the pad in the array AT ALL?
}

export default function GamepadTest(props: { onClose: () => void }) {
  const [snap, setSnap] = createSignal<Snap>({ id: "", mapping: "", frames: 0, buttons: [], axes: [], lastBtn: -1, none: true, slots: 0, present: 0, focused: true, raw: [] });
  let raf = 0;
  let frames = 0;
  let lastBtn = -1;
  let root!: HTMLDivElement;

  onMount(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose(); };
    addEventListener("keydown", esc);
    // grab focus — Chrome only feeds live gamepad data to the FOCUSED document
    try { window.focus(); root?.focus(); } catch { /* ignore */ }
    const loop = () => {
      raf = requestAnimationFrame(loop);
      frames++;
      const pads = [...(navigator.getGamepads?.() ?? [])];
      const present = pads.filter(Boolean).length;
      const focused = document.hasFocus();
      const raw = pads.map((g) => (g ? `${g.id.slice(0, 24)} [${g.connected === false ? "off" : "on"}]` : null));
      const p = pads.find((g) => g && g.connected !== false);
      if (!p) { setSnap((s) => ({ ...s, frames, slots: pads.length, present, focused, raw, none: true })); return; }
      const buttons = p.buttons.map((b) => b.value);
      p.buttons.forEach((b, i) => { if (b.pressed) lastBtn = i; });
      setSnap({ id: p.id, mapping: p.mapping || "(empty / non-standard)", frames, buttons, axes: [...p.axes], lastBtn, none: false, slots: pads.length, present, focused, raw });
    };
    raf = requestAnimationFrame(loop);
    onCleanup(() => { cancelAnimationFrame(raf); removeEventListener("keydown", esc); });
  });

  return (
    <div class="gptest" ref={root} tabindex="-1" onClick={() => { try { window.focus(); } catch { /* ignore */ } }}>
      <div class="gptest-head">
        <div class="panel-tag">CONTROLLER TEST — LIVE RAW STATE</div>
        <button class="ps-act" onClick={props.onClose}><span class="btn-o" /> back</button>
      </div>

      {/* always-visible raw readout — the ground truth */}
      <div class="gptest-raw" classList={{ warn: !snap().focused }}>
        polling: <b>frame {snap().frames}</b> · tab focused: <b>{snap().focused ? "yes" : "NO — click this page!"}</b> · gamepad slots seen: <b>{snap().present}</b> / {snap().slots}
        <Show when={snap().raw.some(Boolean)}>
          <div class="gptest-slots">
            <For each={snap().raw}>{(r, i) => <span>slot {i()}: {r ?? "—"}</span>}</For>
          </div>
        </Show>
      </div>

      <Show
        when={!snap().none}
        fallback={
          <div class="gptest-empty">
            <div class="gptest-big">No controller seen yet.</div>
            <p>Press any button on the pad <b>now</b>, with this tab focused.<br />
              frames polled: <b>{snap().frames}</b> · gamepad slots: <b>{snap().slots}</b> · non-empty: <b>{snap().present}</b> · tab focused: <b>{snap().focused ? "yes" : "NO — click the page!"}</b></p>
            <p style={{ "max-width": "600px", "font-size": "13px" }}>
              Counter rising but slots stay 0 even as you press → the browser isn't exposing the pad to this page. Almost always one of: <b>Safari</b> (use Chrome/Edge), the tab <b>isn't focused</b>, or another app (<b>Steam</b>, a game, macOS Game Controller) is capturing the controller — quit those. Quick sanity check: open <b>gamepad-tester.com</b> in the same browser; if it also shows nothing, it's your browser/OS, not this app.
            </p>
          </div>
        }
      >
        <div class="gptest-id">{snap().id}</div>
        <div class="gptest-meta">mapping: <b>{snap().mapping}</b> · frames polled: {snap().frames} · last button index pressed: <b>{snap().lastBtn}</b></div>

        <div class="gptest-section">BUTTONS (highlight = pressed)</div>
        <div class="gptest-btns">
          <For each={snap().buttons}>
            {(v, i) => <div class="gptest-btn" classList={{ on: v > 0.5 }}>{i()}<span>{v > 0.5 ? "●" : ""}</span></div>}
          </For>
        </div>

        <div class="gptest-section">AXES (sticks &amp; triggers)</div>
        <div class="gptest-axes">
          <For each={snap().axes}>
            {(v, i) => (
              <div class="gptest-axis">
                <span class="gptest-axis-label">axis {i()}: {v.toFixed(2)}</span>
                <div class="gptest-axis-bar"><div class="gptest-axis-fill" style={{ left: `${(v + 1) * 50}%` }} /></div>
              </div>
            )}
          </For>
        </div>

        <div class="gptest-note">
          Tell me: does pressing the <b>d-pad</b> and <b>A</b> button light up the boxes above, and which numbers? If nothing lights up when you press, the pad state isn't updating (browser issue). If numbers light up but the console still won't navigate, I'll remap to those exact indices.
        </div>
      </Show>
    </div>
  );
}
