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

// —— build + send an output state (rumble + lightbar) ——
async function sendState(o: { strong?: number; weak?: number; r?: number; g?: number; b?: number }) {
  if (!device?.opened) return;
  // common 47-byte payload (valid-flag bits: 0x03 = rumble, 0x04|0x08 in byte2 covers LEDs)
  const p = new Uint8Array(47);
  p[0] = 0x03; p[1] = 0x14 | 0x02 | 0x01; // enable rumble; audio haptics off
  p[2] = 0x04 | 0x08;                     // lightbar + player-LED control
  p[3] = Math.round((o.weak ?? 0) * 255);   // right/weak motor
  p[4] = Math.round((o.strong ?? 0) * 255); // left/strong motor
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

// battery lives in input report 0x01 (USB, byte 53) / 0x31 (BT, byte 54)
function onInputReport(e: any) {
  const d: DataView = e.data;
  const off = e.reportId === 0x31 ? 53 : 52;
  if (d.byteLength <= off) return;
  const raw = d.getUint8(off);
  const pct = Math.min(100, (raw & 0x0f) * 10 + 5);
  setDsBattery(pct);
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
