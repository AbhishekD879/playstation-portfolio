// The phone side of phone-as-controller. Opened via ?pad=CODE (usually by
// scanning the QR in the console's Control Center). Renders a DualShock-style
// touch controller and streams input state to the console over the same
// WebRTC data channel PS2 multiplayer uses. Multi-touch, drag-anywhere sticks,
// optional gyro steering. Nothing else of the console loads on this route.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { startJoiner, type JoinerHandle } from "../ps2mp/webrtc";

type Axes = { lx: number; ly: number; rx: number; ry: number };
const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 100) / 100));

export default function PhonePad(props: { room: string }) {
  const [status, setStatus] = createSignal("connecting…");
  const [live, setLive] = createSignal(false);
  const [gyro, setGyro] = createSignal(false);
  let joiner: JoinerHandle | null = null;

  // —— input state, pushed on change + heartbeat ——
  const down = new Set<string>();
  const axes: Axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
  let dirty = true;
  const press = (a: string, on: boolean) => {
    if (on) down.add(a); else down.delete(a);
    dirty = true;
    if (on && navigator.vibrate) navigator.vibrate(8); // tactile tick
  };
  const setAxis = (k: keyof Axes, v: number) => { const c = clamp(v); if (axes[k] !== c) { axes[k] = c; dirty = true; } };

  onMount(() => {
    joiner = startJoiner({
      room: props.room,
      onStream: () => {}, // data-only — the console sends no video to a pad
      onStatus: (s) => {
        setStatus(s);
        if (s === "connected") setLive(true);
        if (["failed", "closed", "disconnected", "host left"].includes(s)) setLive(false);
      },
    });
    let last = 0;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (dirty || now - last > 500) {
        dirty = false; last = now;
        joiner?.sendInput({ t: "input", down: [...down], axes: { ...axes } });
      }
    };
    raf = requestAnimationFrame(loop);
    // keep the screen awake while playing (best-effort)
    (navigator as any).wakeLock?.request?.("screen").catch(() => {});
    onCleanup(() => { cancelAnimationFrame(raf); joiner?.stop(); });
  });

  // —— gyro: tilt the phone = left stick ——
  let gyroHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  async function toggleGyro() {
    if (gyro()) {
      if (gyroHandler) removeEventListener("deviceorientation", gyroHandler);
      gyroHandler = null; setGyro(false); setAxis("lx", 0); setAxis("ly", 0);
      return;
    }
    try {
      const D = DeviceOrientationEvent as any;
      if (typeof D?.requestPermission === "function" && (await D.requestPermission()) !== "granted") return;
      gyroHandler = (e) => {
        // landscape hold: beta = lean fwd/back, gamma = tilt left/right
        setAxis("lx", ((e.gamma ?? 0) / 35));
        setAxis("ly", ((e.beta ?? 0) - 20) / 35);
      };
      addEventListener("deviceorientation", gyroHandler);
      setGyro(true);
    } catch { /* unsupported */ }
  }

  // capture is best-effort — if it throws (headless synthetic pointers, odd
  // browsers) the press must still register
  const capture = (el: Element, id: number) => { try { (el as any).setPointerCapture(id); } catch { /* fine */ } };

  // —— a draggable analog stick (pointer capture per stick) ——
  const Stick = (p: { x: keyof Axes; y: keyof Axes }) => {
    let zone!: HTMLDivElement;
    let active = false;
    const [knob, setKnob] = createSignal({ x: 0, y: 0 });
    const move = (e: PointerEvent) => {
      const r = zone.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(dx, dy) || 1;
      const s = m > 1 ? 1 / m : 1;
      setKnob({ x: dx * s, y: dy * s });
      setAxis(p.x, dx * s); setAxis(p.y, dy * s);
    };
    const end = () => { active = false; setKnob({ x: 0, y: 0 }); setAxis(p.x, 0); setAxis(p.y, 0); };
    return (
      <div
        ref={zone} class="pp-stick"
        onPointerDown={(e) => { active = true; capture(zone, e.pointerId); move(e); }}
        onPointerMove={(e) => { if (active) move(e); }}
        onPointerUp={end} onPointerCancel={end}
      >
        <div class="pp-knob" style={{ transform: `translate(${knob().x * 34}px, ${knob().y * 34}px)` }} />
      </div>
    );
  };

  // —— a hold-to-press button ——
  const Btn = (p: { a: string; label: any; cls?: string }) => (
    <button
      class={`pp-btn ${p.cls ?? ""}`}
      onPointerDown={(e) => { capture(e.currentTarget as HTMLElement, e.pointerId); press(p.a, true); }}
      onPointerUp={() => press(p.a, false)}
      onPointerLeave={(e) => { if (e.buttons) press(p.a, false); }}
      onPointerCancel={() => press(p.a, false)}
      onContextMenu={(e) => e.preventDefault()}
    >{p.label}</button>
  );

  return (
    <div class="phonepad">
      <div class="pp-status" classList={{ live: live() }}>
        {live() ? "● CONNECTED" : `○ ${status()}`} · room {props.room}
        <button class="pp-gyro" classList={{ on: gyro() }} onClick={toggleGyro}>GYRO {gyro() ? "ON" : "OFF"}</button>
      </div>

      <div class="pp-shoulders">
        <div><Btn a="l2" label="L2" cls="shoulder" /><Btn a="l1" label="L1" cls="shoulder" /></div>
        <div><Btn a="r1" label="R1" cls="shoulder" /><Btn a="r2" label="R2" cls="shoulder" /></div>
      </div>

      <div class="pp-main">
        <div class="pp-cluster">
          <div class="pp-dpad">
            <Btn a="dpad_up" label="▲" cls="d up" />
            <Btn a="dpad_left" label="◀" cls="d left" />
            <Btn a="dpad_right" label="▶" cls="d right" />
            <Btn a="dpad_down" label="▼" cls="d down" />
          </div>
          <Stick x="lx" y="ly" />
        </div>

        <div class="pp-middle">
          <Btn a="select" label="SELECT" cls="mid" />
          <Btn a="start" label="START" cls="mid" />
        </div>

        <div class="pp-cluster">
          <div class="pp-faces">
            <Btn a="triangle" label={<span class="pp-g t">△</span>} cls="f up" />
            <Btn a="square" label={<span class="pp-g s">□</span>} cls="f left" />
            <Btn a="circle" label={<span class="pp-g o">○</span>} cls="f right" />
            <Btn a="cross" label={<span class="pp-g x">✕</span>} cls="f down" />
          </div>
          <Stick x="rx" y="ry" />
        </div>
      </div>

      <Show when={!live()}>
        <div class="pp-hint">Keep this page open — connecting to the console{status().startsWith("error") ? ` (${status()})` : "…"}</div>
      </Show>
    </div>
  );
}
