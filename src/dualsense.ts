// DualSense enhanced features over WebHID — strictly OPT-IN. Nothing here
// runs until the user clicks "connect" (WebHID requires a gesture + a
// permission prompt). Once connected: the lightbar follows the console theme,
// rumble events also fire the real motors, and we read the battery level.
// Xbox pads are untouched — their rumble keeps using the Gamepad API
// (vibrationActuator) exactly as before.
//
// Report layout per the community-documented DualSense HID protocol
// (Linux hid-playstation / pydualsense / ds5ctl). USB: output report 0x02.
// Bluetooth: report 0x31 with a seeded CRC-32 over 0xA2 + payload.
import { createSignal } from "solid-js";

const SONY = 0x054c;
const DS_PRODUCTS = [0x0ce6, 0x0df2]; // DualSense, DualSense Edge

const [dsName, setDsName] = createSignal<string | null>(null);
const [dsBattery, setDsBattery] = createSignal<number | null>(null); // 0-100
export { dsName, dsBattery };
export const dsSupported = () => "hid" in navigator;

let device: any = null; // HIDDevice
let bt = false;         // connected over Bluetooth?

// —— CRC-32 (standard, reflected) for Bluetooth output reports ——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// —— adaptive triggers ————————————————————————————————————————————————————
// L2/R2 can push back. `mode` byte then up to 10 parameter bytes:
//   0x00 off · 0x01 constant resistance from `start` · 0x02 a "click" between
//   start and end · 0x26 vibrating resistance.
export type TriggerEffect =
  | { mode: "off" }
  | { mode: "resist"; start: number; force: number }        // 0-1 each
  | { mode: "click"; start: number; end: number; force: number };

function triggerBytes(fx: TriggerEffect): number[] {
  const B = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  if (fx.mode === "resist") return [0x01, B(fx.start), B(fx.force), 0, 0, 0, 0, 0, 0, 0, 0];
  if (fx.mode === "click") return [0x02, B(fx.start), B(fx.end), B(fx.force), 0, 0, 0, 0, 0, 0, 0];
  return [0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

let leftFx: TriggerEffect = { mode: "off" };
let rightFx: TriggerEffect = { mode: "off" };

/**
 * Set trigger resistance. Safe by construction: while both triggers are "off"
 * we never set the enable bits, so the bytes on the wire are byte-for-byte what
 * the (already shipped and working) lightbar/rumble path sends today. Turning
 * this on can therefore never regress those.
 */
export function dsTriggers(left: TriggerEffect, right: TriggerEffect) {
  leftFx = left; rightFx = right;
  if (!device?.opened) return;
  const { r, g, b } = themeRgb();
  sendState({ r, g, b });
}

// —— build + send an output state (rumble + lightbar + triggers) ——
async function sendState(o: { strong?: number; weak?: number; r?: number; g?: number; b?: number }) {
  if (!device?.opened) return;
  // common 47-byte payload (valid-flag bits: 0x03 = rumble, 0x04|0x08 in byte2 covers LEDs)
  const p = new Uint8Array(47);
  p[0] = 0x03; p[1] = 0x14 | 0x02 | 0x01; // enable rumble; audio haptics off
  p[2] = 0x04 | 0x08;                     // lightbar + player-LED control
  p[3] = Math.round((o.weak ?? 0) * 255);   // right/weak motor
  p[4] = Math.round((o.strong ?? 0) * 255); // left/strong motor
  // Trigger effect blocks sit at 10 (right) and 21 (left) in the common report,
  // with their enable bits in valid_flag0. Only written when an effect is
  // actually asked for — see dsTriggers().
  if (rightFx.mode !== "off") { p[0] |= 0x04; p.set(triggerBytes(rightFx), 10) }
  if (leftFx.mode !== "off") { p[0] |= 0x08; p.set(triggerBytes(leftFx), 21) }
  p[39] = 0x02;                            // lightbar setup: enable
  p[42] = 0x02;                            // brightness: medium
  p[43] = 0x04;                            // player LED: center
  p[44] = o.r ?? 0; p[45] = o.g ?? 0; p[46] = o.b ?? 0;
  try {
    if (!bt) {
      await device.sendReport(0x02, p);
    } else {
      // BT report 0x31: [seq<<4, 0x10, ...common payload, crc32(0xA2, 0x31, body)]
      const out = new Uint8Array(2 + p.length + 4);
      out[0] = 0x00; // sequence tag (0 is accepted)
      out[1] = 0x10;
      out.set(p, 2);
      const crcSrc = new Uint8Array(2 + 2 + p.length);
      crcSrc[0] = 0xa2; crcSrc[1] = 0x31;
      crcSrc.set(out.subarray(0, 2 + p.length), 2);
      const c = crc32(crcSrc);
      const at = 2 + p.length;
      out[at] = c & 0xff; out[at + 1] = (c >>> 8) & 0xff;
      out[at + 2] = (c >>> 16) & 0xff; out[at + 3] = (c >>> 24) & 0xff;
      await device.sendReport(0x31, out);
    }
  } catch { /* cable yanked mid-write — harmless */ }
}

const hexToRgb = (hex: string) => {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
/** Resolve the current theme tint to RGB (handles hex + hsl via a probe). */
function themeRgb(): { r: number; g: number; b: number } {
  const tint = getComputedStyle(document.documentElement).getPropertyValue("--xmb-tint").trim();
  const hex = hexToRgb(tint);
  if (hex) return hex;
  const el = document.createElement("div");
  el.style.color = tint; el.style.display = "none";
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color.match(/\d+/g)?.map(Number) ?? [111, 168, 255];
  el.remove();
  return { r: rgb[0], g: rgb[1], b: rgb[2] };
}

/** Push the console theme colour to the lightbar (call after theme changes). */
export function dsSyncLightbar() {
  if (!device?.opened) return;
  const { r, g, b } = themeRgb();
  sendState({ r, g, b });
}

/** Fire the real motors — called by input.ts rumble() alongside the Gamepad
 *  API path. No-op unless connected. */
export function dsRumble(strong: number, weak: number, duration: number) {
  if (!device?.opened) return;
  const { r, g, b } = themeRgb();
  sendState({ strong, weak, r, g, b });
  setTimeout(() => sendState({ strong: 0, weak: 0, r, g, b }), duration);
}

// —— the rest of the pad: motion, touchpad, and the Create button ————————
// The Gamepad API exposes none of these. Create in particular has no standard
// button index at all, which is why the console's SHARE button had to be a
// keyboard shortcut until now.
//
// Input report layout (hid-playstation `dualsense_input_report`), USB id 0x01.
// Bluetooth id 0x31 prefixes one extra byte, so every offset shifts by 1.
const OFF = { buttons: 7, gyro: 15, accel: 21, touch: 32 };

export interface DsMotion { gx: number; gy: number; gz: number; ax: number; ay: number; az: number }
export interface DsTouch { active: boolean; x: number; y: number } // x/y normalised 0-1

const [dsMotion, setDsMotion] = createSignal<DsMotion | null>(null);
const [dsTouch, setDsTouch] = createSignal<DsTouch>({ active: false, x: 0, y: 0 });
export { dsMotion, dsTouch };

// —— gyro aiming ——————————————————————————————————————————————————————————
// DOOM and Counter-Strike both aim from pointer-lock mouse deltas, so the
// cleanest way to add motion aim is to BE a mouse: turn the pad's yaw/pitch
// into synthetic mousemove events. `movementX`/`movementY` are settable through
// MouseEventInit even though they're read-only on the event, which is what
// makes this work without touching either game.
let gyroAim = false;
let gyroSens = 0.055;
/** Turn motion aiming on for the app that's open. Off by default everywhere. */
export function dsGyroAim(on: boolean, sensitivity = 0.055) { gyroAim = on; gyroSens = sensitivity }

// Small rotations are mostly hand tremor; without a deadzone the crosshair
// drifts constantly while you hold the pad still.
const DEADZONE = 90;
function feedGyroAim(gz: number, gx: number) {
  if (!gyroAim) return;
  const yaw = Math.abs(gz) > DEADZONE ? gz : 0;
  const pitch = Math.abs(gx) > DEADZONE ? gx : 0;
  if (!yaw && !pitch) return;
  const target = (document.pointerLockElement as HTMLElement) ?? document.activeElement ?? document.body;
  target.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    movementX: -yaw * gyroSens,   // yaw left should look left
    movementY: -pitch * gyroSens,
  }));
}

let createCb: (() => void) | null = null;
/** Fires on a Create ("share") button PRESS. One listener; last one wins. */
export function onDsCreate(cb: (() => void) | null) { createCb = cb }

let micCb: (() => void) | null = null;
export function onDsMute(cb: (() => void) | null) { micCb = cb }

let prevCreate = false, prevMute = false;

export interface DsParsed {
  battery: number | null;
  create: boolean;
  mute: boolean;
  motion: DsMotion | null;
  touch: DsTouch | null;
}

/**
 * Pure decode of a DualSense input report — exported so the bit-twiddling can
 * be tested without a physical pad (see dualsense.test.ts). Bluetooth (0x31)
 * prefixes one byte, so every offset shifts.
 */
export function parseInputReport(reportId: number, d: DataView): DsParsed {
  const shift = reportId === 0x31 ? 1 : 0;
  const out: DsParsed = { battery: null, create: false, mute: false, motion: null, touch: null };

  const battOff = reportId === 0x31 ? 53 : 52;
  if (d.byteLength > battOff) out.battery = Math.min(100, (d.getUint8(battOff) & 0x0f) * 10 + 5);

  // buttons — only the two the Gamepad API can't see
  const b1 = OFF.buttons + shift + 1, b2 = OFF.buttons + shift + 2;
  if (d.byteLength > b2) {
    out.create = (d.getUint8(b1) & 0x10) !== 0;
    out.mute = (d.getUint8(b2) & 0x04) !== 0;
  }

  // motion — signed 16-bit little-endian triples
  const g = OFF.gyro + shift;
  if (d.byteLength >= g + 12) {
    out.motion = {
      gx: d.getInt16(g, true), gy: d.getInt16(g + 2, true), gz: d.getInt16(g + 4, true),
      ax: d.getInt16(g + 6, true), ay: d.getInt16(g + 8, true), az: d.getInt16(g + 10, true),
    };
  }

  // touchpad, first contact only. Bit 7 of byte 0 SET means not touching, and
  // x/y are 12-bit values packed across three bytes sharing a middle nibble.
  const t = OFF.touch + shift;
  if (d.byteLength >= t + 4) {
    const b = [d.getUint8(t + 1), d.getUint8(t + 2), d.getUint8(t + 3)];
    out.touch = {
      active: (d.getUint8(t) & 0x80) === 0,
      x: Math.min(1, (b[0] | ((b[1] & 0x0f) << 8)) / 1920),
      y: Math.min(1, ((b[1] >> 4) | (b[2] << 4)) / 1080),
    };
  }
  return out;
}

function onInputReport(e: any) {
  const p = parseInputReport(e.reportId, e.data as DataView);
  if (p.battery !== null) setDsBattery(p.battery);
  if (p.create && !prevCreate) createCb?.();   // edge only — a held button is one press
  if (p.mute && !prevMute) micCb?.();
  prevCreate = p.create; prevMute = p.mute;
  if (p.motion) { setDsMotion(p.motion); feedGyroAim(p.motion.gz, p.motion.gx) }
  if (p.touch) setDsTouch(p.touch);
}

/** User-gesture-only: prompt for a DualSense and light it up. */
export async function dsConnect(): Promise<boolean> {
  if (!dsSupported()) return false;
  try {
    const devices = await (navigator as any).hid.requestDevice({
      filters: DS_PRODUCTS.map((productId) => ({ vendorId: SONY, productId })),
    });
    if (!devices.length) return false;
    device = devices[0];
    if (!device.opened) await device.open();
    // USB exposes output report 0x02; Bluetooth only 0x31
    bt = !device.collections?.some((c: any) => c.outputReports?.some((r: any) => r.reportId === 0x02));
    setDsName(device.productName || "DualSense");
    device.addEventListener("inputreport", onInputReport);
    (navigator as any).hid.addEventListener?.("disconnect", (ev: any) => { if (ev.device === device) dsDisconnect(); });
    dsSyncLightbar();
    return true;
  } catch {
    device = null;
    setDsName(null);
    return false;
  }
}

export function dsDisconnect() {
  try { device?.removeEventListener?.("inputreport", onInputReport); device?.close?.(); } catch { /* already gone */ }
  device = null;
  setDsName(null);
  setDsBattery(null);
}
