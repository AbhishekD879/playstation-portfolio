// On-device photo cutouts — two Labs tools, both through the model manager:
//  · cutout(blob)          — Cutout Cam: RMBG-1.4 background removal; the
//                            whole subject lifted onto transparency.
//  · isolate(blob, [x,y])  — Click-to-Mask: SlimSAM point-prompted
//                            segmentation; tap a thing, keep only that thing.
// Both return transparent PNGs that go back into the gallery. Nothing leaves
// the device. WebGPU when available, wasm fallback, single-shot (no tiling —
// these models resize internally).
import { acquireModel } from "./models";

export type CutProgress = { phase: "download" | "work"; pct: number };

let dlTick: ((pct: number) => void) | null = null; // wired while a job runs
const progressCb = (p: any) => {
  if (p?.status === "progress" && typeof p.progress === "number" && String(p.file ?? "").includes("onnx")) {
    dlTick?.(Math.min(99, Math.round(p.progress)));
  }
};

const loadRmbg = (device: "webgpu" | "wasm") =>
  acquireModel<any>(`rmbg-${device}`, "RMBG (Cutout Cam)", 45, async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return pipeline("background-removal", "briaai/RMBG-1.4", {
      device,
      session_options: { logSeverityLevel: 3 },
      progress_callback: progressCb,
    } as any);
  });

const loadSam = (device: "webgpu" | "wasm") =>
  acquireModel<any>(`slimsam-${device}`, "SlimSAM (Click-to-Mask)", 40, async () => {
    const { SamModel, AutoProcessor } = await import("@huggingface/transformers");
    const model = await SamModel.from_pretrained("Xenova/slimsam-77-uniform", {
      device,
      session_options: { logSeverityLevel: 3 },
      progress_callback: progressCb,
    } as any);
    const processor = await AutoProcessor.from_pretrained("Xenova/slimsam-77-uniform", {} as any);
    return { model, processor, dispose: () => (model as any).dispose?.() };
  });

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/png"));

/** Lift the subject off the background. Returns a transparent PNG. */
export async function cutout(blob: Blob, onProgress?: (p: CutProgress) => void): Promise<Blob> {
  dlTick = (pct) => onProgress?.({ phase: "download", pct });
  const url = URL.createObjectURL(blob);
  try {
    const gpu = typeof (navigator as any).gpu !== "undefined";
    let out: any;
    try {
      out = await (await loadRmbg(gpu ? "webgpu" : "wasm"))(url);
    } catch (e) {
      if (!gpu) throw e;
      out = await (await loadRmbg("wasm"))(url);
    }
    onProgress?.({ phase: "work", pct: 90 });
    const img = (Array.isArray(out) ? out[0] : out).rgba(); // RawImage, 4 channels
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    return await toPng(canvas);
  } finally {
    dlTick = null;
    URL.revokeObjectURL(url);
  }
}

/** Keep only what was clicked (image-space point). Returns a transparent PNG. */
export async function isolate(blob: Blob, point: [number, number], onProgress?: (p: CutProgress) => void): Promise<Blob> {
  dlTick = (pct) => onProgress?.({ phase: "download", pct });
  const url = URL.createObjectURL(blob);
  try {
    const { RawImage } = await import("@huggingface/transformers");
    const image = await RawImage.read(url);

    const run = async (device: "webgpu" | "wasm") => {
      const { model, processor } = await loadSam(device);
      const inputs = await processor(image, { input_points: [[[point[0], point[1]]]] });
      onProgress?.({ phase: "work", pct: 40 });
      const outputs = await model(inputs);
      return { outputs, masks: await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes) };
    };
    const gpu = typeof (navigator as any).gpu !== "undefined";
    let r: Awaited<ReturnType<typeof run>>;
    try { r = await run(gpu ? "webgpu" : "wasm"); }
    catch (e) { if (!gpu) throw e; r = await run("wasm"); }
    onProgress?.({ phase: "work", pct: 80 });

    // masks[0]: bool Tensor [1, 3, H, W]; iou_scores [1, 1, 3] — take the best
    const mask = r.masks[0];
    const [, , H, W] = mask.dims as number[];
    const scores = r.outputs.iou_scores.data as Float32Array;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const off = best * H * W;

    const rgba = image.rgba();
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const data = new Uint8ClampedArray(rgba.data);
    for (let i = 0; i < W * H; i++) if (!mask.data[off + i]) data[i * 4 + 3] = 0;
    ctx.putImageData(new ImageData(data, W, H), 0, 0);
    return await toPng(canvas);
  } finally {
    dlTick = null;
    URL.revokeObjectURL(url);
  }
}
