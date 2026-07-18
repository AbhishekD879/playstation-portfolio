// Photo Mode capture plumbing. The Wave scene renders without
// preserveDrawingBuffer, so a snapshot must render one fresh frame and read
// the canvas back in the same task — Wave registers that closure here.
let cap: (() => string | null) | null = null;

export function registerWaveCapture(fn: (() => string | null) | null) { cap = fn; }

/** One PNG data-URL frame of the living background (null if unavailable). */
export function captureWave(): string | null {
  try { return cap?.() ?? null; } catch { return null; }
}
