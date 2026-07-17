// On-device photo enhancement — Swin2SR ×2 super-resolution via transformers.js.
// The photo is processed as overlapping TILES rather than one giant tensor:
//  · real progress (a tick per tile) instead of a silent minute
//  · far lower peak GPU/wasm memory → reliable on modest hardware
//  · if the WebGPU path dies mid-flight, the job restarts cleanly on wasm
// Seams are avoided by shaving the tile overlap on write. Nothing is uploaded;
// the enhanced copy goes back into the gallery.
import { acquireModel } from "./models";

export type EnhanceProgress = { phase: "download" | "upscale"; pct: number };

const MODEL = "Xenova/swin2SR-classical-sr-x2-64";
const TILE = 224, OV = 16, SCALE = 2, MAX = 1024;

let dlTick: ((pct: number) => void) | null = null; // wired while a job runs

const loadPipe = (device: "webgpu" | "wasm") =>
  acquireModel<any>(`swin2sr-${device}`, `Swin2SR ×2 (Photo Enhance)`, 70, async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return pipeline("image-to-image", MODEL, {
      device,
      session_options: { logSeverityLevel: 3 }, // ORT warnings are console noise
      progress_callback: (p: any) => {
        if (p?.status === "progress" && typeof p.progress === "number" && String(p.file ?? "").includes("onnx")) {
          dlTick?.(Math.min(99, Math.round(p.progress)));
        }
      },
    } as any);
  });

/** ×2 upscale a photo blob with live progress. Returns a PNG blob. */
export async function upscale(blob: Blob, onProgress?: (p: EnhanceProgress) => void): Promise<Blob> {
  dlTick = (pct) => onProgress?.({ phase: "download", pct });
  try {
    // cap the input — output is up to 2048px on the long side
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const src = document.createElement("canvas");
    src.width = w; src.height = h;
    src.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const out = document.createElement("canvas");
    out.width = w * SCALE; out.height = h * SCALE;
    const octx = out.getContext("2d")!;

    // tile origins (clamped so edge tiles stay full-size when possible)
    const step = TILE - OV * 2;
    const origins = (len: number) => {
      const o: number[] = [];
      for (let v = 0; ; v += step) {
        o.push(Math.max(0, Math.min(v, len - TILE)));
        if (v + TILE >= len) break;
      }
      return [...new Set(o)];
    };
    const xs = origins(w), ys = origins(h);
    const total = xs.length * ys.length;

    const run = async (pipe: any) => {
      let done = 0;
      for (const ty of ys) {
        for (const tx of xs) {
          const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
          const tile = document.createElement("canvas");
          tile.width = tw; tile.height = th;
          tile.getContext("2d")!.drawImage(src, tx, ty, tw, th, 0, 0, tw, th);
          const r = await pipe(tile.toDataURL("image/png"));
          const { width: rw, height: rh, data, channels } = r;
          const rgba = new Uint8ClampedArray(rw * rh * 4);
          for (let i = 0; i < rw * rh; i++) {
            rgba[i * 4] = data[i * channels];
            rgba[i * 4 + 1] = data[i * channels + 1];
            rgba[i * 4 + 2] = data[i * channels + 2];
            rgba[i * 4 + 3] = 255;
          }
          // shave the overlap so tile borders never show (keep true image edges)
          const sx = tx === 0 ? 0 : OV * SCALE;
          const sy = ty === 0 ? 0 : OV * SCALE;
          const ex = tx + tw >= w ? rw : rw - OV * SCALE;
          const ey = ty + th >= h ? rh : rh - OV * SCALE;
          octx.putImageData(new ImageData(rgba, rw, rh), tx * SCALE, ty * SCALE, sx, sy, ex - sx, ey - sy);
          done++;
          onProgress?.({ phase: "upscale", pct: Math.round((done / total) * 100) });
        }
      }
    };

    const gpu = typeof (navigator as any).gpu !== "undefined";
    try {
      await run(await loadPipe(gpu ? "webgpu" : "wasm"));
    } catch (e) {
      if (!gpu) throw e;
      // the GPU path failed (op gaps / memory) — start over on wasm
      onProgress?.({ phase: "upscale", pct: 0 });
      octx.clearRect(0, 0, out.width, out.height);
      await run(await loadPipe("wasm"));
    }

    return await new Promise<Blob>((res, rej) =>
      out.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/png"));
  } finally {
    dlTick = null;
  }
}
