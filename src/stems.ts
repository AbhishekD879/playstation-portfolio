// Real vocal separation — the karaoke cut that actually works.
//
// Karaoke already had the classic L−R trick, which cancels anything panned dead
// centre. That's free and instant, but it also guts the bass and snare, and it
// does nothing at all to a mono or wide-mixed vocal. This is the real thing: a
// Spleeter 2-stems U-Net that predicts the vocal's magnitude spectrogram, so the
// band survives intact.
//
// ★ Only the VOCALS model is downloaded (~39 MB), not both stems. The
// accompaniment is the original minus the vocals in the time domain, which is
// exactly what karaoke wants and halves the download.
//
// The model is a spectrogram model, so this file is mostly DSP: STFT in, masked
// complex spectrogram out, ISTFT back to audio.
import type { InferenceSession } from "onnxruntime-web";

// Spleeter's own parameters. These are not free choices — the network was
// trained on exactly this framing and silently produces mush if they change.
const N_FFT = 4096;
const HOP = 1024;
const BINS = N_FFT / 2 + 1;   // 2049 from a real FFT
const MODEL_BINS = 1024;      // Spleeter only models the lower 1024
const FRAMES = 512;           // frames per inference chunk (~11.9 s at 44.1 kHz)
const MODEL_URL =
  "https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems/resolve/main/vocals.onnx";

// —— FFT ————————————————————————————————————————————————————————————————
/** In-place iterative radix-2 complex FFT. N must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Inverse FFT, via conjugation — no second twiddle table needed. */
export function ifft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n }
}

/** Periodic Hann window — the one that satisfies COLA at hop = N/4. */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

export interface Stft { re: Float32Array[]; im: Float32Array[]; frames: number }

/** Frame, window, and transform. Centre-padded so frame f is centred at f*HOP. */
export function stft(x: Float32Array, win: Float32Array): Stft {
  const pad = N_FFT / 2;
  const frames = Math.ceil(x.length / HOP) + 1;
  const re: Float32Array[] = [], im: Float32Array[] = [];
  const br = new Float32Array(N_FFT), bi = new Float32Array(N_FFT);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - pad;
    br.fill(0); bi.fill(0);
    for (let i = 0; i < N_FFT; i++) {
      const s = start + i;
      br[i] = s >= 0 && s < x.length ? x[s] * win[i] : 0;
    }
    fft(br, bi);
    // keep only the non-redundant half
    const fr = new Float32Array(BINS), fi = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) { fr[b] = br[b]; fi[b] = bi[b] }
    re.push(fr); im.push(fi);
  }
  return { re, im, frames };
}

/** Weighted overlap-add back to samples, undoing the window's squared sum. */
export function istft(s: Stft, win: Float32Array, length: number): Float32Array {
  const pad = N_FFT / 2;
  const out = new Float32Array(length);
  const wsum = new Float32Array(length);
  const br = new Float32Array(N_FFT), bi = new Float32Array(N_FFT);
  for (let f = 0; f < s.frames; f++) {
    // rebuild the full hermitian spectrum from the half we kept
    for (let b = 0; b < BINS; b++) { br[b] = s.re[f][b]; bi[b] = s.im[f][b] }
    for (let b = BINS; b < N_FFT; b++) {
      br[b] = s.re[f][N_FFT - b]; bi[b] = -s.im[f][N_FFT - b];
    }
    ifft(br, bi);
    const start = f * HOP - pad;
    for (let i = 0; i < N_FFT; i++) {
      const t = start + i;
      if (t < 0 || t >= length) continue;
      out[t] += br[i] * win[i];
      wsum[t] += win[i] * win[i];
    }
  }
  // divide out the window overlap; the guard keeps the padded edges from blowing up
  for (let i = 0; i < length; i++) out[i] = wsum[i] > 1e-8 ? out[i] / wsum[i] : 0;
  return out;
}

// —— the model ————————————————————————————————————————————————————————————
let sessionPromise: Promise<InferenceSession> | null = null;

export interface StemProgress { stage: "model" | "analyse" | "separate" | "rebuild"; pct: number }

/** ~39 MB, cached by the browser after the first run. */
async function loadSession(onProgress?: (p: StemProgress) => void): Promise<InferenceSession> {
  sessionPromise ??= (async () => {
    onProgress?.({ stage: "model", pct: 0 });
    const ort = await import("onnxruntime-web");
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`model download failed (${res.status})`);
    // stream so the UI can show real progress on a 39 MB file
    const total = Number(res.headers.get("content-length")) || 0;
    const chunks: Uint8Array[] = [];
    let got = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress?.({ stage: "model", pct: Math.round((got / total) * 100) });
    }
    const bytes = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length }
    return ort.InferenceSession.create(bytes, {
      // wasm rather than webgpu: this graph hits ops the WebGPU EP still falls
      // back on, and the fallback is slower than staying on wasm throughout
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  })().catch((e) => { sessionPromise = null; throw e });
  return sessionPromise;
}

export interface Stems { vocals: AudioBuffer; accompaniment: AudioBuffer }

/**
 * Split `buffer` into vocals and everything else. Progress is reported so a
 * multi-minute job on a long track doesn't look like a hang.
 */
export async function separateStems(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  onProgress?: (p: StemProgress) => void,
): Promise<Stems> {
  const ort = await import("onnxruntime-web");
  const session = await loadSession(onProgress);

  const len = buffer.length;
  const win = hann(N_FFT);
  onProgress?.({ stage: "analyse", pct: 0 });

  // Spleeter is a stereo model; a mono file is handled by duplicating the channel
  const chans: Float32Array[] = buffer.numberOfChannels >= 2
    ? [buffer.getChannelData(0), buffer.getChannelData(1)]
    : [buffer.getChannelData(0), buffer.getChannelData(0)];
  const specs = chans.map((c) => stft(c, win));
  const frames = specs[0].frames;
  const splits = Math.ceil(frames / FRAMES);

  // the vocal magnitude the model predicts, per channel/frame/bin
  const est: Float32Array[][] = [new Array(frames), new Array(frames)];
  for (let f = 0; f < frames; f++) { est[0][f] = new Float32Array(BINS); est[1][f] = new Float32Array(BINS) }

  for (let s = 0; s < splits; s++) {
    // one split at a time: the whole song at once is a 2x N x 512 x 1024 float
    // tensor, which for a 4-minute track is well over a gigabyte
    const data = new Float32Array(2 * FRAMES * MODEL_BINS);
    for (let ch = 0; ch < 2; ch++) {
      for (let t = 0; t < FRAMES; t++) {
        const f = s * FRAMES + t;
        if (f >= frames) break;
        const re = specs[ch].re[f], im = specs[ch].im[f];
        const base = ch * FRAMES * MODEL_BINS + t * MODEL_BINS;
        for (let b = 0; b < MODEL_BINS; b++) data[base + b] = Math.hypot(re[b], im[b]);
      }
    }
    const out = await session.run({
      x: new ort.Tensor("float32", data, [2, 1, FRAMES, MODEL_BINS]),
    });
    const y = out[session.outputNames[0]].data as Float32Array;
    for (let ch = 0; ch < 2; ch++) {
      for (let t = 0; t < FRAMES; t++) {
        const f = s * FRAMES + t;
        if (f >= frames) break;
        const base = ch * FRAMES * MODEL_BINS + t * MODEL_BINS;
        for (let b = 0; b < MODEL_BINS; b++) est[ch][f][b] = y[base + b];
      }
    }
    onProgress?.({ stage: "separate", pct: Math.round(((s + 1) / splits) * 100) });
  }

  // —— soft mask ——
  // A ratio mask (estimate / original) rather than using the estimate directly:
  // it keeps the original PHASE, and phase is most of what makes separated audio
  // sound natural instead of watery.
  onProgress?.({ stage: "rebuild", pct: 0 });
  const vocalCh: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const vre: Float32Array[] = [], vim: Float32Array[] = [];
    for (let f = 0; f < frames; f++) {
      const re = specs[ch].re[f], im = specs[ch].im[f];
      const nr = new Float32Array(BINS), ni = new Float32Array(BINS);
      for (let b = 0; b < MODEL_BINS; b++) {
        const mag = Math.hypot(re[b], im[b]);
        const m = mag > 1e-9 ? Math.min(1, est[ch][f][b] / mag) : 0;
        nr[b] = re[b] * m; ni[b] = im[b] * m;
      }
      // bins above the model's range are left out of the vocal entirely, so
      // they stay in the accompaniment rather than leaking hiss into both
      vre.push(nr); vim.push(ni);
    }
    vocalCh.push(istft({ re: vre, im: vim, frames }, win, len));
    onProgress?.({ stage: "rebuild", pct: Math.round(((ch + 1) / 2) * 100) });
  }

  const vocals = ctx.createBuffer(2, len, buffer.sampleRate);
  const accompaniment = ctx.createBuffer(2, len, buffer.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const v = vocals.getChannelData(ch), a = accompaniment.getChannelData(ch);
    const src = chans[ch], est2 = vocalCh[ch];
    for (let i = 0; i < len; i++) {
      const vv = est2[i];
      v[i] = vv;
      a[i] = src[i] - vv;   // exact complement: the two stems sum to the original
    }
  }
  return { vocals, accompaniment };
}

export const stemsSupported = () => typeof WebAssembly !== "undefined";
