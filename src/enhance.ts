// On-device photo enhancement — Swin2SR ×2 super-resolution via transformers.js
// (WebGPU when the console has it, wasm otherwise). The photo never leaves the
// browser; the enhanced copy is saved back into the gallery. Big inputs are
// capped so the transformer doesn't chew the tab: anything over 1024px on the
// long side is scaled down first (output is still up to 2048px).
import { acquireModel } from "./models";

const loadModel = () =>
  acquireModel<any>("swin2sr", "Swin2SR ×2 (Photo Enhance)", 70, async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const device = typeof (navigator as any).gpu !== "undefined" ? "webgpu" : "wasm";
    try {
      return await pipeline("image-to-image", "Xenova/swin2SR-classical-sr-x2-64", { device } as any);
    } catch {
      // webgpu op gaps → wasm still works, just slower
      return await pipeline("image-to-image", "Xenova/swin2SR-classical-sr-x2-64", { device: "wasm" } as any);
    }
  });

/** ×2 upscale a photo blob. Returns a PNG blob (up to ~2048px long side). */
export async function upscale(blob: Blob): Promise<Blob> {
  const pipe = await loadModel();

  // cap the input — SR transformers scale badly with pixel count
  const bmp = await createImageBitmap(blob);
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const inCanvas = document.createElement("canvas");
  inCanvas.width = w; inCanvas.height = h;
  inCanvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const inUrl = inCanvas.toDataURL("image/png");

  const out = await pipe(inUrl); // RawImage (RGB)
  const { width, height, data, channels } = out;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = data[i * channels];
    rgba[i * 4 + 1] = data[i * channels + 1];
    rgba[i * 4 + 2] = data[i * channels + 2];
    rgba[i * 4 + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/png"));
}
