// On-device monocular depth — Depth Anything V2 (small) via transformers.js,
// WebGPU when available (wasm otherwise). Powers the "Live Photos (3D)" Labs
// feature: a photo's depth map drives a parallax shader so stills gain real
// dimensionality. Everything is progressive: while the model thinks (or if the
// image blocks CORS) the photo just stays a photo.
let loading: Promise<any> | null = null;
const cache = new Map<string, Promise<ImageBitmap | null>>();

function loadModel(): Promise<any> {
  if (!loading) {
    loading = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const device = typeof (navigator as any).gpu !== "undefined" ? "webgpu" : "wasm";
      // q8 keeps the wasm path tolerable; webgpu takes the default dtype
      const opts: any = { device };
      if (device === "wasm") opts.dtype = "q8";
      return pipeline("depth-estimation", "onnx-community/depth-anything-v2-small", opts);
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** Depth map for an image URL as a grayscale bitmap (bright = near), or null. */
export function depthMap(url: string): Promise<ImageBitmap | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const pipe = await loadModel();
        const out = await pipe(url);
        const raw = out.depth; // RawImage, 1 channel, sized to the input
        const { width, height, data } = raw;
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          const v = data[i];
          rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
        }
        return await createImageBitmap(new ImageData(rgba, width, height));
      } catch {
        return null; // CORS-blocked image, model failure… the photo stays 2D
      }
    })();
    cache.set(url, p);
    // keep the cache bounded — depth bitmaps are big
    if (cache.size > 24) { const k = cache.keys().next().value!; cache.delete(k); }
  }
  return p;
}
