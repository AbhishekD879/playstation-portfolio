// YIN pitch detection, running on the audio thread.
//
// Two of these run during karaoke: one on the microphone (what you're singing)
// and one on a high-passed mid channel of the song (what the original singer
// sang). Comparing the two is the whole scoring mechanic, and it means any song
// works — no hand-authored note charts.
//
// This lives in public/ rather than src/ because an AudioWorklet module is
// fetched by URL at runtime, not bundled.
//
// ponytail: plain YIN, no FFT. Voice is 80–1000 Hz and we analyse ~20×/sec on a
// decimated buffer, so brute-force autocorrelation is ~400k ops per analysis —
// far cheaper than the FFT machinery it would take to avoid it.

const IN_RATE_WINDOW = 2048; // input samples gathered per analysis
const W = 1024;              // window after 2× decimation
const TAU_MIN = 24;          // ~500 Hz at 24 kHz  (upper voice limit)
const TAU_MAX = 400;         // ~60 Hz at 24 kHz   (lower voice limit)
const THRESHOLD = 0.15;      // YIN absolute threshold; lower = stricter

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(IN_RATE_WINDOW);
    this.fill = 0;
    this.dec = new Float32Array(W);
    this.diff = new Float32Array(TAU_MAX + 1);
    this.cmnd = new Float32Array(TAU_MAX + 1);
  }

  /** YIN steps 1-3: difference function, cumulative mean normalisation, threshold. */
  detect(x, rate) {
    const { diff, cmnd } = this;
    diff[0] = 0;
    for (let tau = 1; tau <= TAU_MAX; tau++) {
      let sum = 0;
      for (let i = 0; i < W - TAU_MAX; i++) {
        const d = x[i] - x[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }
    // cumulative mean normalised difference — this is what stops YIN from
    // locking onto tau=0 and octave-halving the way raw autocorrelation does
    cmnd[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= TAU_MAX; tau++) {
      run += diff[tau];
      cmnd[tau] = run === 0 ? 1 : (diff[tau] * tau) / run;
    }
    // first dip below the threshold, not the global min: the global min tends
    // to be an octave down
    let tau = -1;
    for (let t = TAU_MIN; t <= TAU_MAX; t++) {
      if (cmnd[t] < THRESHOLD) {
        while (t + 1 <= TAU_MAX && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return { hz: 0, clarity: 0 };

    // parabolic interpolation around the dip → sub-sample precision, which is
    // the difference between "in tune" and "sharp by 30 cents"
    const a = cmnd[tau - 1] ?? cmnd[tau];
    const b = cmnd[tau];
    const c = cmnd[tau + 1] ?? cmnd[tau];
    const denom = 2 * (2 * b - a - c);
    const shift = denom !== 0 ? (c - a) / denom : 0;
    const hz = rate / (tau + shift);
    return { hz: hz > 40 && hz < 1200 ? hz : 0, clarity: 1 - b };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.fill++] = ch[i];
      if (this.fill < IN_RATE_WINDOW) continue;
      this.fill = 0;

      // 2× decimate with a 2-tap average — cheap anti-alias, and it halves the
      // autocorrelation cost, which is the expensive part
      let rms = 0;
      for (let j = 0; j < W; j++) {
        const v = (this.buf[j * 2] + this.buf[j * 2 + 1]) * 0.5;
        this.dec[j] = v;
        rms += v * v;
      }
      rms = Math.sqrt(rms / W);
      // silence gate: below this it's room noise and YIN will happily
      // "detect" a confident pitch in it
      if (rms < 0.006) { this.port.postMessage({ hz: 0, clarity: 0, rms }); continue; }

      const { hz, clarity } = this.detect(this.dec, sampleRate / 2);
      this.port.postMessage({ hz, clarity, rms });
    }
    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
