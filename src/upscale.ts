// WebGPU upscaling for every screen the console draws.
//
// Eight surfaces feed pixels through here — NES/SNES/GBA/MD, PS2, Counter-Strike,
// DOOM, Flash, RPG Maker, the video player, and the WebRTC <video> a spectator
// is watching. They're all just a canvas or a video, so one shader chain lifts
// all of them and no app has to know this exists.
//
// ★ Why a hand-rolled renderer instead of anime4k-webgpu's own `render()`:
// theirs is hard-wired to HTMLVideoElement and drives itself off
// requestVideoFrameCallback, which a <canvas> doesn't have. The PIPELINES are
// the valuable part (real trained CNN weights); the render loop around them is
// twenty lines, so we own that and feed it either source.
//
// The library is ~3.5 MB of inlined WGSL weights, so it is ALWAYS lazy-imported
// — a visitor who never turns this on never downloads it.
import { hasWebGPU } from "./gpu";
import { createFsr, type UpscalePipeline } from "./fsr";
import { outputSize } from "./capture";
import { createFrameGen, type FrameGen } from "./framegen";

export type UpscaleMode = "off" | "fsr" | "fast" | "quality" | "restore";

export const UPSCALE_MODES: { id: UpscaleMode; name: string; desc: string }[] = [
  { id: "off", name: "Off", desc: "Native output, nearest-neighbour as the browser scales it" },
  { id: "fsr", name: "FSR", desc: "AMD FidelityFX Super Resolution 1 — 2× edge-aware upscale with no neural net. The light choice for a phone GPU" },
  { id: "fast", name: "Sharp", desc: "2× CNN upscale. Cheap enough for a laptop iGPU" },
  { id: "quality", name: "Sharp+", desc: "Heavier 2× CNN. Best on a discrete GPU" },
  { id: "restore", name: "Restore", desc: "Deblur and clean up first, then upscale. Best for blurry 3D-era games" },
];

export interface UpscaleHandle {
  /** the canvas showing the upscaled result — caller positions it */
  output: HTMLCanvasElement;
  stop(): void;
}

type Src = HTMLCanvasElement | HTMLVideoElement;
const srcSize = (s: Src) =>
  s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : { w: s.width, h: s.height };

/** Blit the last pipeline's texture to the canvas. */
const BLIT_WGSL = `
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  // one oversized triangle beats a quad: no diagonal seam, fewer verts
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f((p[i].x + 1.0) * 0.5, 1.0 - (p[i].y + 1.0) * 0.5);
  return o;
}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}`;

export function upscaleSupported() {
  return hasWebGPU();
}

/**
 * Start upscaling `src` into a fresh canvas. Returns null if WebGPU is missing,
 * the mode is off, or the source hasn't sized itself yet — every caller treats
 * null as "just show the original", so this can never break a game.
 */
export interface UpscaleOpts {
  /** Motion smoothing: synthesise the frame between consecutive source frames.
   *  Composes with any mode, including "off" (smoothing at native size). */
  frameGen?: boolean;
}

export async function startUpscale(src: Src, mode: UpscaleMode, opts: UpscaleOpts = {}): Promise<UpscaleHandle | null> {
  const smooth = !!opts.frameGen;
  if ((mode === "off" && !smooth) || !upscaleSupported()) return null;
  const first = srcSize(src);
  if (!first.w || !first.h) return null;

  let device: GPUDevice;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    device = await adapter.requestDevice();
  } catch { return null }

  // The CNN library is ~3.5MB of weights; only fetched when a CNN mode is chosen.
  const needsCnn = mode === "fast" || mode === "quality" || mode === "restore";
  const a4k = needsCnn ? await import("anime4k-webgpu").catch(() => null) : null;
  if (needsCnn && !a4k) { device.destroy(); return null }

  const output = document.createElement("canvas");
  const ctx = output.getContext("webgpu");
  if (!ctx) { device.destroy(); return null }
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  // The source texture must match the source's CURRENT size; emulators resize
  // when a game switches video mode, so everything below is rebuilt on change.
  let W = 0, H = 0;
  let TW = 0, TH = 0, settle = 0;
  let inputTex: GPUTexture | null = null;
  let chain: { pass(enc: GPUCommandEncoder): void; getOutputTexture(): GPUTexture; destroy?(): void }[] = [];
  let fg: FrameGen | null = null;
  let bind: GPUBindGroup | null = null;
  let stopped = false;

  const blit = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: "vs" },
    fragment: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  function build(w: number, h: number, tw: number, th: number) {
    for (const p of chain) p.destroy?.();
    fg?.destroy(); fg = null;
    inputTex?.destroy();
    W = w; H = h;
    inputTex = device.createTexture({
      size: [w, h], format: "rgba8unorm",
      // COPY_SRC: motion smoothing rotates this capture into its frame history
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Smoothing runs at SOURCE resolution, before any upscale: the flow search is
    // 4× cheaper there and the upscaler then sharpens the synthesised frame like
    // any other. Its output becomes the chain's input.
    if (smooth) fg = createFrameGen(device, inputTex, w, h);
    const chainInput = fg ? fg.output : inputTex;

    const d = { device, inputTexture: chainInput };
    // Retro output is small, so a 2× CNN already lands at a sane size; the
    // preset modes (which deblur/denoise first) are what actually help the
    // blurry 3D-era stuff. Targets are capped so a 4K panel can't ask for a
    // 16× chain and hang the GPU.
    TW = tw; TH = th; // sized by outputSize(): the overlay box in device pixels
    const target = { targetDimensions: { width: tw, height: th } };
    chain =
      mode === "off" ? []                                   // smoothing only: present at native size
      : mode === "fsr" ? [createFsr(device, chainInput, tw, th) as UpscalePipeline]
      : mode === "fast" ? [new a4k!.CNNx2M(d)]
      : mode === "quality" ? [new a4k!.CNNx2VL(d)]
      : [new a4k!.ModeA({ ...d, nativeDimensions: { width: w, height: h }, ...target })];

    const last = chain.length ? chain[chain.length - 1].getOutputTexture() : chainInput;
    output.width = last.width; output.height = last.height;
    bind = device.createBindGroup({
      layout: blit.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: last.createView() }],
    });
  }

  let raf = 0;
  const frame = () => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const { w, h } = srcSize(src);
    if (!w || !h) return;
    // Render at the device pixels the overlay occupies so the browser never
    // resamples the sharpened result (see outputSize). A source size change
    // rebuilds at once — the capture copy must match the input texture — while
    // an output-only change waits for the box to hold still for a few frames.
    const box = output.getBoundingClientRect();
    const want = outputSize(w, h, box.width, box.height, devicePixelRatio);
    const outDirty = want.w !== TW || want.h !== TH;
    settle = outDirty ? settle + 1 : 0;
    if (w !== W || h !== H || (outDirty && settle >= 8)) {
      try { build(w, h, want.w, want.h) } catch { stopped = true; return } // an unbuildable chain = fall back to native
    }
    if (!inputTex || !bind) return;
    try {
      device.queue.copyExternalImageToTexture({ source: src }, { texture: inputTex }, [w, h]);
    } catch {
      return; // source not paintable this frame (video between frames, tainted canvas)
    }
    const enc = device.createCommandEncoder();
    fg?.pass(enc);
    for (const p of chain) p.pass(enc);
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store",
      }],
    });
    pass.setPipeline(blit);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
    fg?.afterSubmit();
  };

  // 2× until the overlay has been laid out; frame() re-sizes to device pixels
  const start = outputSize(first.w, first.h, 0, 0, devicePixelRatio);
  try { build(first.w, first.h, start.w, start.h) } catch { device.destroy(); return null }
  raf = requestAnimationFrame(frame);

  return {
    output,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      for (const p of chain) p.destroy?.();
      fg?.destroy();
      inputTex?.destroy();
      try { device.destroy() } catch { /* already gone */ }
    },
  };
}
