// On-device text-to-speech — Kokoro-82M via transformers.js on WebGPU. Lazy:
// the model (~80 MB, q8) only downloads the first time the user turns speech
// on. Gated to WebGPU (AiChat already requires it), so it's near real-time.
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
        dtype: "q8",
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
