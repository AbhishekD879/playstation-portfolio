// Phone-as-controller (console side). The phone opens ?pad=CODE and joins the
// same WebRTC room machinery PS2 multiplayer uses (data channel only, no
// video). Its input state materializes here as a VIRTUAL GAMEPAD appended to
// navigator.getGamepads() — so the XMB, every game bridge, the OSK and PS2
// multiplayer all read it through their existing primaryPad() logic with zero
// changes. When no phone is connected the wrapper is a pure passthrough.
import { createSignal } from "solid-js";
import { startHost, type HostHandle } from "./ps2mp/webrtc";
import type { PadState } from "./ps2mp/input";

// ps2mp wire action names → standard-mapping button indices (inverse of
// ps2mp/input.ts GP_BUTTON — keep in sync)
const ACTION_INDEX: Record<string, number> = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  select: 8, start: 9, l3: 10, r3: 11,
  dpad_up: 12, dpad_down: 13, dpad_left: 14, dpad_right: 15,
};

// a Gamepad-shaped object; all our readers use buttons[i].pressed + axes[i]
// and filter on `connected !== false` + prefer mapping "standard"
const virtual = {
  id: "AbhishekStation Phone Controller",
  index: 9, // out of the way of real pads (0-3)
  connected: true,
  mapping: "standard" as GamepadMappingType,
  timestamp: 0,
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  axes: [0, 0, 0, 0] as number[],
  vibrationActuator: undefined,
};

const [phoneOn, setPhoneOn] = createSignal(false);
const [phoneRoom, setPhoneRoom] = createSignal("");
export { phoneOn, phoneRoom };

let patched = false;
function ensurePatch() {
  if (patched) return;
  patched = true;
  const orig = navigator.getGamepads.bind(navigator);
  // passthrough unless a phone is live — real pads keep their exact slots
  (navigator as any).getGamepads = () => {
    const real = orig();
    if (!phoneOn()) return real;
    return [...real, virtual as unknown as Gamepad];
  };
}

function applyState(s: PadState) {
  for (const b of virtual.buttons) { b.pressed = false; b.value = 0; }
  for (const a of s.down ?? []) {
    const i = ACTION_INDEX[a];
    if (i != null) { virtual.buttons[i].pressed = true; virtual.buttons[i].value = 1; }
  }
  const ax = s.axes ?? { lx: 0, ly: 0, rx: 0, ry: 0 };
  virtual.axes[0] = ax.lx ?? 0; virtual.axes[1] = ax.ly ?? 0;
  virtual.axes[2] = ax.rx ?? 0; virtual.axes[3] = ax.ry ?? 0;
  virtual.timestamp = performance.now();
}

const release = () => applyState({ down: [], axes: { lx: 0, ly: 0, rx: 0, ry: 0 } } as PadState);

let host: HostHandle | null = null;

const genCode = () => {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
};

/** Start (or return the running) phone-pad room. Idempotent. */
export function startPhonePad(onStatus?: (s: string) => void): string {
  if (host) return phoneRoom();
  ensurePatch();
  const code = genCode();
  setPhoneRoom(code);
  host = startHost({
    room: code,
    max: 1,
    onJoinerInput: (_id, data: any) => {
      if (data?.t === "input") { setPhoneOn(true); applyState(data as PadState); }
    },
    onJoinerChange: (ids) => {
      if (ids.length === 0) { setPhoneOn(false); release(); }
      onStatus?.(ids.length ? "phone connected" : "waiting for phone");
    },
    onStatus,
  });
  return code;
}

export function stopPhonePad() {
  host?.stop();
  host = null;
  setPhoneOn(false);
  setPhoneRoom("");
  release();
}

/** The URL the phone should open (rendered as a QR). */
export const phonePadUrl = (code: string) => `${location.origin}/?pad=${code}`;
