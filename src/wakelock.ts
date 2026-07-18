// Never-Dim Console — a screen Wake Lock while something is actually playing
// (emulator session, PS2 disc, DOOM, karaoke, video), released the moment it
// ends. Reference-counted so overlapping apps can't release each other's lock,
// and re-acquired automatically when a hidden tab becomes visible again.
import { labEnabled } from "./labs";

let sentinel: any = null;
let holders = 0;

async function acquire() {
  if (!labEnabled("wakelock") || !(navigator as any).wakeLock) return;
  try { sentinel = await (navigator as any).wakeLock.request("screen"); } catch { /* denied — battery saver etc. */ }
}

function release() {
  try { sentinel?.release(); } catch { /* already gone */ }
  sentinel = null;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && holders > 0 && !sentinel) void acquire();
});

/** Call when play starts; call the returned function when it ends. */
export function holdWakeLock(): () => void {
  holders++;
  if (holders === 1) void acquire();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) release();
  };
}
