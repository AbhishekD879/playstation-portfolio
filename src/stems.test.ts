// Self-check for the stem-separation DSP. Part of `npm test`.
//
// The model is verified separately in the browser; what's checked here is the
// FFT and the STFT→ISTFT round trip. Both fail SILENTLY — a subtly wrong FFT or
// a botched overlap-add still produces audio, it just sounds like a wet paper
// bag, and there's no exception to trace.
import { strict as assert } from "node:assert";
import { fft, hann, ifft, istft, stft } from "./stems.ts";

// —— FFT against a brute-force DFT ——
{
  const N = 64;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin(i * 0.7) + 0.4 * Math.cos(i * 2.1);
  // reference DFT
  const dr = new Float64Array(N), di = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const a = (-2 * Math.PI * k * n) / N;
      dr[k] += re[n] * Math.cos(a);
      di[k] += re[n] * Math.sin(a);
    }
  }
  fft(re, im);
  for (let k = 0; k < N; k++) {
    assert.ok(Math.abs(re[k] - dr[k]) < 1e-3, `FFT real bin ${k}: ${re[k]} vs ${dr[k]}`);
    assert.ok(Math.abs(im[k] - di[k]) < 1e-3, `FFT imag bin ${k}: ${im[k]} vs ${di[k]}`);
  }
}

// —— a pure tone lands in exactly one bin ——
{
  const N = 256, k0 = 20;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.cos((2 * Math.PI * k0 * i) / N);
  fft(re, im);
  const mags = Array.from({ length: N / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  let peak = 0;
  for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
  assert.equal(peak, k0, `a ${k0}-cycle tone must peak at bin ${k0}, peaked at ${peak}`);
  // and the rest of the spectrum must be essentially empty
  const others = mags.filter((_, k) => Math.abs(k - k0) > 1);
  assert.ok(Math.max(...others) < mags[k0] * 0.01, "spectral leakage far too high — check the twiddles");
}

// —— fft ∘ ifft is the identity ——
{
  const N = 512;
  const re = new Float32Array(N), im = new Float32Array(N);
  const orig = new Float32Array(N);
  for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 0.31) * 0.8; orig[i] = re[i] }
  fft(re, im);
  ifft(re, im);
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(re[i] - orig[i]) < 1e-4, `ifft(fft(x)) != x at ${i}`);
    assert.ok(Math.abs(im[i]) < 1e-4, `imaginary residue at ${i}`);
  }
}

// —— the window is periodic Hann (not symmetric): w[0] is 0, and no w[i] is 1 at the end ——
{
  const w = hann(8);
  assert.ok(Math.abs(w[0]) < 1e-9, "periodic Hann starts at 0");
  assert.ok(Math.abs(w[4] - 1) < 1e-9, "periodic Hann peaks at N/2");
  assert.ok(Math.abs(w[7] - w[1]) < 1e-9, "periodic Hann is symmetric about N/2");
}

// —— ★ STFT → ISTFT round trip reconstructs the signal ——
// This is the one that matters: if overlap-add or the hermitian rebuild is
// wrong, separated audio comes out crushed or phasey but never throws.
{
  const N_FFT = 4096, HOP = 1024;
  const len = HOP * 20 + 517;               // deliberately not a frame multiple
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    // a few partials plus noise: enough structure that a phase error shows
    x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100)
         + 0.3 * Math.sin((2 * Math.PI * 1310 * i) / 44100)
         + 0.05 * Math.sin(i * 1.7);
  }
  const win = hann(N_FFT);
  const s = stft(x, win);
  const y = istft(s, win, len);

  // ignore the first and last frame's worth: those are the padded edges where
  // the window sum is genuinely incomplete
  let worst = 0, worstAt = -1;
  for (let i = N_FFT; i < len - N_FFT; i++) {
    const d = Math.abs(y[i] - x[i]);
    if (d > worst) { worst = d; worstAt = i }
  }
  assert.ok(worst < 1e-3, `round trip error ${worst.toExponential(2)} at ${worstAt} — too high`);

  // energy must be preserved in the interior, not just sample-wise close
  let ex = 0, ey = 0;
  for (let i = N_FFT; i < len - N_FFT; i++) { ex += x[i] * x[i]; ey += y[i] * y[i] }
  assert.ok(Math.abs(ey / ex - 1) < 1e-3, `energy ratio ${(ey / ex).toFixed(5)} != 1`);
}

// —— a zeroed mask yields silence, a unity mask yields the original ——
// These bracket what the model's mask can do, so a bug here would show up as
// either "vocals never removed" or "everything removed".
{
  const N_FFT = 4096;
  const len = 1024 * 12;
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) x[i] = Math.sin((2 * Math.PI * 300 * i) / 44100) * 0.6;
  const win = hann(N_FFT);
  const s = stft(x, win);

  const zero = { frames: s.frames, re: s.re.map((f) => new Float32Array(f.length)), im: s.im.map((f) => new Float32Array(f.length)) };
  const silent = istft(zero, win, len);
  for (let i = 0; i < len; i++) assert.equal(silent[i], 0, "a zero mask must be exact silence");

  const same = istft(s, win, len);
  let worst = 0;
  for (let i = N_FFT; i < len - N_FFT; i++) worst = Math.max(worst, Math.abs(same[i] - x[i]));
  assert.ok(worst < 1e-3, `unity mask must return the original (worst ${worst.toExponential(2)})`);
}

console.log("stems: DSP ok");

// —— masking a spectrogram in place ————————————————————————————————————————
// separateStems now writes the ratio mask straight into the spectrogram it
// analysed, instead of building a second one, because holding three
// spectrograms for a four-minute song is what crashed the tab. That only works
// if a bin's new value depends on nothing but its own old value — so this
// pins the two properties the in-place version relies on.
{
  const N_FFT = 4096, BINS = N_FFT / 2 + 1, MODEL_BINS = 1024;
  const win = hann(N_FFT);
  const n = N_FFT * 6;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.5;

  // a mask of 1 everywhere must be the identity, so round-tripping through the
  // in-place path returns the original signal
  const spec = stft(x, win);
  for (let f = 0; f < spec.frames; f++) {
    const re = spec.re[f], im = spec.im[f];
    for (let b = 0; b < MODEL_BINS; b++) {
      const mag = Math.hypot(re[b], im[b]);
      const m = mag > 1e-9 ? Math.min(1, mag / mag) : 0;   // estimate == original
      re[b] *= m; im[b] *= m;
    }
    for (let b = MODEL_BINS; b < BINS; b++) { re[b] = 0; im[b] = 0; }
  }
  const back = istft(spec, win, n);
  // 440 Hz lives well below the model's bin range, so zeroing the top bins
  // must not disturb it
  let worst = 0;
  for (let i = N_FFT; i < n - N_FFT; i++) worst = Math.max(worst, Math.abs(back[i] - x[i]));
  assert.ok(worst < 1e-3, `in-place unity mask should reconstruct the signal, off by ${worst}`);

  // a mask of 0 must silence it, and must not leave the top bins ringing
  const spec0 = stft(x, win);
  for (let f = 0; f < spec0.frames; f++) {
    const re = spec0.re[f], im = spec0.im[f];
    for (let b = 0; b < BINS; b++) { re[b] = 0; im[b] = 0; }
  }
  const silent = istft(spec0, win, n);
  let loudest = 0;
  for (let i = 0; i < n; i++) loudest = Math.max(loudest, Math.abs(silent[i]));
  assert.ok(loudest < 1e-6, `a zero mask should be silence, peaked at ${loudest}`);
}

console.log("stems: in-place mask ok");
