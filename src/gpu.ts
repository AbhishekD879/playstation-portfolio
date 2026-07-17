// GPU capability probes, resolved once at boot. Everything WebGPU-powered
// (fluid background, particle juice, DOOM RTX) gates on hasWebGPU(); the CRT
// console mode additionally needs the experimental HTML-in-Canvas API.
import { createSignal } from "solid-js";

const [hasWebGPU, setWebGPU] = createSignal(false);
const [gpuReady, setGpuReady] = createSignal(false);
export { hasWebGPU, gpuReady };

let adapterPromise: Promise<GPUAdapter | null> | null = null;
/** The shared adapter probe — request once, share the answer. */
export function gpuAdapter(): Promise<GPUAdapter | null> {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      try { return (await (navigator as any).gpu?.requestAdapter()) ?? null; }
      catch { return null; }
    })();
  }
  return adapterPromise;
}

gpuAdapter().then((a) => { setWebGPU(!!a); setGpuReady(true); });

// —— HTML-in-Canvas (Chrome origin trial): can we draw live DOM into WebGL? ——
// Detects the API surface: a canvas that accepts layoutsubtree + a WebGL
// context that can upload an element as a texture.
export function hasHtmlInCanvas(): boolean {
  try {
    const c = document.createElement("canvas");
    c.setAttribute("layoutsubtree", "");
    const gl = c.getContext("webgl2");
    return !!gl && typeof (gl as any).texElementImage2D === "function";
  } catch { return false; }
}
