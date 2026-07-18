// Rest Mode — the console's PS4/PS5-style suspend. After extended idle the
// screen fades to near-black with a breathing power light, the master audio
// context suspends and the living background stops rendering. Nothing is
// torn down: every signal, app and scroll position stays in memory, so any
// input resumes the exact prior state instantly.
import { createSignal } from "solid-js";
import { audioContext } from "./audio";

const [resting, setResting] = createSignal(false);
export { resting };

export function enterRest() {
  if (resting()) return;
  setResting(true);
  try { void audioContext().suspend(); } catch { /* no audio yet */ }
}

export function exitRest() {
  if (!resting()) return;
  setResting(false);
  try { void audioContext().resume(); } catch { /* no audio yet */ }
}
