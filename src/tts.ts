// On-device text-to-speech — Kokoro-82M via transformers.js on WebGPU. Lazy:
// the model downloads the first time the user turns speech on. Gated to WebGPU
// (AiChat already requires it), so it's near real-time.
// dtype is fp32, NOT q8: an int8-quantized decoder on the WebGPU backend
// produces GARBLED / wrong-language audio (a known transformers.js issue —
// github.com/huggingface/transformers.js/issues/1317 & 1320). fp32 is correct
// on WebGPU; the trade is a larger (~330 MB) one-time cached download.
let ttsPromise: Promise<any> | null = null;
let current: HTMLAudioElement | null = null;

export function ttsSupported(): boolean {
  return typeof (navigator as any).gpu !== "undefined";
}

/** Kick off (or reuse) the model load. Returns the KokoroTTS instance. */
export function loadTTS(onProgress?: (pct: number) => void): Promise<any> {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "fp32", // NOT q8 — q8+WebGPU = garbled audio (see note above)
        device: "webgpu",
        progress_callback: (p: any) => {
          if (p?.status === "progress" && p.total) onProgress?.(Math.round((p.loaded / p.total) * 100));
        },
      });
    })();
  }
  return ttsPromise;
}

/** Synthesize and play. Cuts off any speech already playing. */
export async function speak(text: string): Promise<void> {
  const clean = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  const tts = await loadTTS();
  const audio = await tts.generate(clean, { voice: "am_michael" }); // warm male voice
  stopSpeaking();
  const url = URL.createObjectURL(audio.toBlob());
  current = new Audio(url);
  current.onended = () => URL.revokeObjectURL(url);
  await current.play().catch(() => {});
}

export function stopSpeaking(): void {
  if (current) { current.pause(); current = null; }
}

/**
 * Like speak(), but routes playback through an AnalyserNode and calls onLevel
 * with a 0..1 loudness each frame — for driving an avatar's mouth (lip-sync).
 * Resolves when playback ends OR is cut (barge-in via stopSpeaking).
 */
export async function speakWithLipSync(text: string, onLevel: (v: number) => void): Promise<void> {
  const clean = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  const tts = await loadTTS();
  const audio = await tts.generate(clean, { voice: "am_michael" });
  stopSpeaking();
  const url = URL.createObjectURL(audio.toBlob());
  const el = new Audio(url);
  current = el; // so stopSpeaking() (barge-in) cuts it
  const ac = new AudioContext();
  let raf = 0;
  try {
    const srcNode = ac.createMediaElementSource(el);
    const analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    srcNode.connect(analyser);
    analyser.connect(ac.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const n = (v - 128) / 128; sum += n * n; }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    await el.play().catch(() => {});
    await new Promise<void>((res) => { el.onended = () => res(); el.onpause = () => res(); });
  } finally {
    cancelAnimationFrame(raf);
    onLevel(0);
    URL.revokeObjectURL(url);
    try { await ac.close(); } catch { /* already closed */ }
    if (current === el) current = null;
  }
}
