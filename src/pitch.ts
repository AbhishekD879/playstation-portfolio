// Pitch tracking for karaoke scoring.
//
// Wraps the YIN worklet in something the UI can use: attach it to a node, get a
// stream of notes. The scoring model compares the singer against the ORIGINAL
// VOCAL extracted from the song itself, so every song works with no note chart
// — which is the only way this could apply to "any file you drop in".

/** MIDI note number from a frequency. Fractional: 60.5 is a quarter-tone sharp. */
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (midi: number) => {
  const r = Math.round(midi);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
};

/**
 * Distance in cents, folded into a single octave.
 * Singing the right note an octave down is correct — SingStar has always scored
 * it that way, and without this every man singing a female vocal reads as wrong.
 */
export function centsOff(sung: number, target: number): number {
  let d = (sung - target) % 12;
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return d * 100 || 0; // `|| 0` folds -0 to 0, so callers can compare normally
}

export interface PitchReading { hz: number; clarity: number; rms: number }

export interface PitchTap {
  /** most recent reading, or null if nothing has arrived yet */
  latest(): PitchReading | null;
  stop(): void;
}

// ★ Keyed by CONTEXT, not global. A worklet module is registered into one
// AudioContext's global scope, so a single shared promise would make every
// context after the first construct an AudioWorkletNode that doesn't exist.
// The app's context is a singleton today, but it survives being recreated.
const loaded = new WeakMap<AudioContext, Promise<void>>();
function loadWorklet(ctx: AudioContext) {
  let p = loaded.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule("/pitch-worklet.js"); loaded.set(ctx, p) }
  return p;
}

/** Attach a pitch tracker to `source`. It does not alter the audio path. */
export async function trackPitch(ctx: AudioContext, source: AudioNode): Promise<PitchTap | null> {
  try {
    await loadWorklet(ctx);
  } catch {
    loaded.delete(ctx); // a failed fetch shouldn't poison this context forever
    return null;
  }
  const node = new AudioWorkletNode(ctx, "pitch-processor", { numberOfOutputs: 0 });
  let last: PitchReading | null = null;
  node.port.onmessage = (e) => { last = e.data as PitchReading };
  source.connect(node);
  return {
    latest: () => last,
    stop: () => { try { source.disconnect(node) } catch { /* already gone */ } node.port.onmessage = null; },
  };
}

// —— scoring ————————————————————————————————————————————————————————————
/** A hit is within a semitone; the score curve is linear from there to perfect. */
export const HIT_CENTS = 100;

export function scoreFor(cents: number): number {
  const off = Math.abs(cents);
  return off >= HIT_CENTS ? 0 : 1 - off / HIT_CENTS;
}

export class SingScore {
  private total = 0;
  private hits = 0;
  private frames = 0;
  private streak = 0;
  best = 0;

  /** Feed one frame. `null` target = the original isn't singing, so nothing counts. */
  push(sungMidi: number | null, targetMidi: number | null) {
    if (targetMidi === null) return;         // no vocal to match right now
    this.frames++;
    if (sungMidi === null) { this.streak = 0; return }
    const s = scoreFor(centsOff(sungMidi, targetMidi));
    this.total += s;
    if (s > 0) { this.hits++; this.streak++; this.best = Math.max(this.best, this.streak) }
    else this.streak = 0;
  }

  /** 0-100. Frames where the original wasn't singing never count against you. */
  get percent(): number {
    return this.frames ? Math.round((this.total / this.frames) * 100) : 0;
  }
  get accuracy(): number {
    return this.frames ? Math.round((this.hits / this.frames) * 100) : 0;
  }
  get sungFrames(): number { return this.frames }
  get currentStreak(): number { return this.streak }

  reset() { this.total = this.hits = this.frames = this.streak = this.best = 0 }
}

/** The rank banner at the end of a song. */
export function rankFor(pct: number): string {
  if (pct >= 90) return "PERFECT";
  if (pct >= 75) return "GREAT";
  if (pct >= 55) return "GOOD";
  if (pct >= 35) return "OK";
  return "KEEP PRACTISING";
}
