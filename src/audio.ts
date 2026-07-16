// All sound is synthesized with WebAudio — no samples, no assets.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem("asp.muted") === "1";

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem("asp.muted", muted ? "1" : "0");
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export const isMuted = () => muted;

// —— visualizer tap: an analyser on the master bus (radio, sfx — everything) ——
let analyser: AnalyserNode | null = null;
export function getAnalyser(): AnalyserNode {
  const c = ac();
  if (!analyser) {
    analyser = c.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    master!.connect(analyser); // a tap — no onward connection needed to analyze
  }
  return analyser;
}
export function audioContext(): AudioContext { return ac(); }

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number } = {}) {
  const c = ac();
  const t = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// —— XMB navigation ——
export const tickH = () => tone(1250, 0.06, { gain: 0.12 });                       // left/right
export const tickV = () => tone(950, 0.055, { gain: 0.1 });                        // up/down
export const confirm = () => { tone(880, 0.09, { gain: 0.16 }); tone(1320, 0.14, { gain: 0.12, at: 0.05 }); };
export const back = () => { tone(1320, 0.07, { gain: 0.12 }); tone(780, 0.12, { gain: 0.12, at: 0.045 }); };
export const deny = () => tone(190, 0.16, { type: "square", gain: 0.07 });

// —— trophy ding: bright triad sparkle ——
export function trophy() {
  tone(1568, 0.5, { gain: 0.14 });
  tone(1976, 0.55, { gain: 0.12, at: 0.06 });
  tone(2637, 0.7, { gain: 0.1, at: 0.12 });
}

// —— boot: deep swell + airy shimmer, an original homage ——
export function bootChime() {
  const c = ac();
  const t = c.currentTime;
  // sub swell
  const o1 = c.createOscillator(), g1 = c.createGain();
  o1.type = "sine"; o1.frequency.setValueAtTime(52, t); o1.frequency.linearRampToValueAtTime(66, t + 3.2);
  g1.gain.setValueAtTime(0, t); g1.gain.linearRampToValueAtTime(0.34, t + 1.6); g1.gain.linearRampToValueAtTime(0, t + 4.4);
  o1.connect(g1).connect(master!); o1.start(t); o1.stop(t + 4.6);
  // fifth above
  const o2 = c.createOscillator(), g2 = c.createGain();
  o2.type = "sine"; o2.frequency.setValueAtTime(156, t); o2.frequency.linearRampToValueAtTime(198, t + 3.2);
  g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.12, t + 2.0); g2.gain.linearRampToValueAtTime(0, t + 4.4);
  o2.connect(g2).connect(master!); o2.start(t); o2.stop(t + 4.6);
  // shimmer partials drifting in
  [1046, 1318, 1568, 2093].forEach((f, i) =>
    tone(f, 2.6, { gain: 0.035, at: 1.1 + i * 0.35 }));
  // the arrival hit
  tone(523, 1.8, { gain: 0.14, at: 3.1 });
  tone(784, 2.2, { gain: 0.1, at: 3.15 });
}

// —— console radio: generative lo-fi loop ——
let radioTimer: ReturnType<typeof setInterval> | null = null;
const SCALE = [220, 246.9, 293.7, 329.6, 392, 440, 493.9, 587.3];
export function radioToggle(): boolean {
  if (radioTimer) { clearInterval(radioTimer); radioTimer = null; return false; }
  ac();
  let step = 0;
  radioTimer = setInterval(() => {
    const s = step++;
    // pad chord every 8 steps
    if (s % 8 === 0) {
      const root = SCALE[(s / 8) % 4 === 3 ? 3 : (s / 8) % 3];
      tone(root / 2, 1.9, { type: "triangle", gain: 0.09 });
      tone(root * 1.5, 1.9, { type: "sine", gain: 0.05 });
    }
    // sparse melody
    if (s % 2 === 0 && Math.random() < 0.55) {
      tone(SCALE[Math.floor(Math.random() * SCALE.length)] * 2, 0.35, { type: "triangle", gain: 0.05 });
    }
    // hat
    if (s % 2 === 1) tone(6000 + Math.random() * 1500, 0.03, { type: "square", gain: 0.012 });
  }, 250);
  return true;
}
export const radioPlaying = () => !!radioTimer;
