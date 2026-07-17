// Control Center — the PS5-style quick overlay. Summoned from ANYWHERE with
// the controller's PS/Guide button (index 16) or ` (backquote): a bottom sheet
// of quick tiles — Home, Phone Controller (QR), volume, mute, theme, DualSense.
// It owns its keyboard in the CAPTURE phase while open, so keys never leak
// into the game/app underneath. Pad input arrives two ways: via XMB nav
// routing (crossbar contexts) and via synthesized arrow keys (inside apps).
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { renderSVG } from "uqr";
import { phoneOn, phonePadUrl, phoneRoom, startPhonePad, stopPhonePad } from "../phonePad";
import { dsBattery, dsConnect, dsDisconnect, dsName, dsSupported, dsSyncLightbar } from "../dualsense";
import { setRumbleHook } from "../input";
import { dsRumble } from "../dualsense";
import { tint } from "../theme";
import * as sfx from "../audio";
import type { NavAction } from "../input";

export default function ControlCenter(props: {
  open: boolean;
  appOpen: boolean;
  onClose: () => void;
  onHome: () => void;
  onTheme: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [sel, setSel] = createSignal(0);
  const [qr, setQr] = createSignal(false);
  const [tick, setTick] = createSignal(0); // re-render pulse for volume/mute
  const bump = () => setTick(tick() + 1);

  // wire the DualSense into the console: rumble routing + lightbar follows theme
  onMount(() => {
    setRumbleHook(dsRumble);
    onCleanup(() => setRumbleHook(null));
  });
  createEffect(() => { tint(); dsSyncLightbar(); });

  interface Tile { id: string; icon: string; label: string; sub?: () => string; show?: () => boolean; act: () => void; adjust?: (d: number) => void }
  const tiles = (): Tile[] => [
    { id: "home", icon: "⌂", label: "Home", show: () => props.appOpen, act: () => { sfx.back(); props.onHome(); props.onClose(); } },
    {
      id: "phone", icon: "📱", label: "Phone Controller",
      sub: () => (phoneOn() ? "connected" : phoneRoom() ? `room ${phoneRoom()}` : "scan to connect"),
      act: () => { sfx.confirm(); if (!phoneRoom()) startPhonePad(); setQr(!qr()); },
    },
    {
      id: "vol", icon: "♪", label: "Volume",
      sub: () => (tick(), `${Math.round(sfx.getVolume() * 100)}%  ↑↓`),
      act: () => {},
      adjust: (d: number) => { sfx.setVolume(sfx.getVolume() + d * 0.05); sfx.tickH(); bump(); },
    },
    {
      id: "mute", icon: "🔇", label: "Mute",
      sub: () => (tick(), sfx.isMuted() ? "muted" : "sound on"),
      act: () => { sfx.toggleMute(); bump(); },
    },
    { id: "theme", icon: "◐", label: "Theme", act: () => { props.onClose(); props.onTheme(); } },
    {
      id: "ds", icon: "🎮", label: "DualSense",
      show: () => dsSupported(),
      sub: () => (dsName() ? `${dsName()}${dsBattery() != null ? ` · ${dsBattery()}%` : ""} — lightbar synced` : "connect via USB/BT"),
      act: async () => { if (dsName()) { dsDisconnect(); sfx.back(); } else { (await dsConnect()) ? sfx.confirm() : sfx.deny(); } bump(); },
    },
  ].filter((t) => t.show?.() ?? true);

  const move = (d: number) => { const n = tiles().length; if (!n) return; setSel((sel() + d + n) % n); sfx.tickH(); };
  // Clean, unambiguous wiring: ←→ (d-pad or left stick) browse tiles; ↕ adjusts
  // the focused tile's value (volume louder/softer); ✕ selects; ◯ closes.
  const nav = (a: NavAction) => {
    if (qr()) { if (a === "confirm" || a === "back") setQr(false); return; }
    const t = tiles()[sel()];
    if (a === "left") move(-1);
    else if (a === "right") move(1);
    else if (a === "up") t?.adjust?.(1);
    else if (a === "down") t?.adjust?.(-1);
    else if (a === "confirm") t?.act();
    else if (a === "back") { sfx.back(); props.onClose(); }
  };
  props.bind(nav);

  // capture-phase keyboard while open — nothing leaks to the app/game below.
  // Accepts synthetic events too (that's how the pad speaks inside apps).
  onMount(() => {
    const keys = (e: KeyboardEvent) => {
      if (!props.open) return;
      const map: Record<string, NavAction> = {
        ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
        Enter: "confirm", Escape: "back",
      };
      const a = map[e.key];
      if (!a) return; // ` (open/close toggle) is owned by XMB, not here
      e.stopPropagation(); e.preventDefault();
      nav(a);
    };
    document.addEventListener("keydown", keys, true);
    onCleanup(() => document.removeEventListener("keydown", keys, true));
  });

  // volume adjustment needs a focused tile even on plain wheel users — mouse
  // just clicks; ←→ handled above. Reset transient state each open.
  createEffect(() => { if (props.open) { setSel(0); setQr(false); } });

  return (
    <Show when={props.open}>
      <div class="cc-backdrop" onClick={() => props.onClose()} />
      <div class="cc">
        <Show when={qr() && phoneRoom()}>
          <div class="cc-qr">
            <div class="cc-qr-code" innerHTML={renderSVG(phonePadUrl(phoneRoom()), { border: 1 })} />
            <div class="cc-qr-text">
              <div class="cc-qr-title">{phoneOn() ? "Phone connected — it's controller #1" : "Scan with your phone"}</div>
              <div class="cc-qr-sub">{phonePadUrl(phoneRoom())}</div>
              <div class="cc-qr-sub">The phone becomes a touch DualShock — d-pad, sticks, gyro. Same Wi-Fi is fastest; works remotely too.</div>
              <button class="ghost-btn" onClick={() => { stopPhonePad(); setQr(false); bump(); }}>Stop phone controller</button>
            </div>
          </div>
        </Show>
        <div class="cc-tiles">
          <For each={tiles()}>
            {(t, i) => (
              <button class="cc-tile" classList={{ focus: sel() === i() && !qr() }}
                onClick={() => { setSel(i()); t.act(); }}>
                <span class="cc-tile-icon">{t.icon}</span>
                <span class="cc-tile-label">{t.label}</span>
                <Show when={t.sub}><span class="cc-tile-sub">{t.sub!()}</span></Show>
              </button>
            )}
          </For>
        </div>
        <div class="cc-legend">
          <span>←→ browse</span>
          <span>↑↓ adjust</span>
          <span><span class="btn-x" /> select</span>
          <span><span class="btn-o" /> close</span>
          <span class="cc-legend-dim">double-tap OPTIONS · ` · PS button — opens anywhere</span>
        </div>
      </div>
    </Show>
  );
}
