// On-device speech-to-text — Whisper (transformers.js, WebGPU/WASM). Records
// the mic, resamples to the 16 kHz mono Float32 Whisper wants, and transcribes
// locally. Nothing is sent anywhere (unlike the Web Speech API, which streams
// audio to the browser vendor's servers). Lazy: model downloads on first use.
import { acquireModel } from "./models";

export function asrSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

const loadASR = () =>
  acquireModel<any>("whisper", "Whisper (voice commands)", 90, async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const device = typeof (navigator as any).gpu !== "undefined" ? "webgpu" : "wasm";
    return pipeline("automatic-speech-recognition", "onnx-community/whisper-base.en", { device, session_options: { logSeverityLevel: 3 } } as any);
  });

/** Records until stop() is called, then resolves with the transcript. */
export function record(): { stop: () => void; done: Promise<string> } {
  let stopRec: () => void = () => {};
  const done = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const buffers: Float32Array[] = [];
    proc.onaudioprocess = (e) => buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc);
    proc.connect(ctx.destination);

    await new Promise<void>((res) => { stopRec = res; });

    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const inRate = ctx.sampleRate;
    await ctx.close();

    // flatten + resample to 16 kHz mono (linear interpolation is plenty for speech)
    let len = 0;
    for (const b of buffers) len += b.length;
    const flat = new Float32Array(len);
    let off = 0;
    for (const b of buffers) { flat.set(b, off); off += b.length; }
    const ratio = inRate / 16000;
    const outLen = Math.floor(flat.length / ratio);
    const audio = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx), hi = Math.min(lo + 1, flat.length - 1);
      audio[i] = flat[lo] + (flat[hi] - flat[lo]) * (idx - lo);
    }
    if (audio.length < 1600) return ""; // < 0.1s → nothing said

    const asr = await loadASR();
    const out = await asr(audio);
    return (out?.text ?? "").trim();
  })();
  return { stop: () => stopRec(), done };
}
