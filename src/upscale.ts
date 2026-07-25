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

export type UpscaleMode = "off" | "fast" | "quality" | "restore";

export const UPSCALE_MODES: { id: UpscaleMode; name: string; desc: string }[] = [
  { id: "off", name: "Off", desc: "Native output, nearest-neighbour as the browser scales it" },
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
export async function startUpscale(src: Src, mode: UpscaleMode): Promise<UpscaleHandle | null> {
  if (mode === "off" || !upscaleSupported()) return null;
  const first = srcSize(src);
  if (!first.w || !first.h) return null;

  let device: GPUDevice;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    device = await adapter.requestDevice();
  } catch { return null }

  const a4k = await import("anime4k-webgpu").catch(() => null);
  if (!a4k) { device.destroy(); return null }

  const output = document.createElement("canvas");
  const ctx = output.getContext("webgpu");
  if (!ctx) { device.destroy(); return null }
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  // The source texture must match the source's CURRENT size; emulators resize
  // when a game switches video mode, so everything below is rebuilt on change.
  let W = 0, H = 0;
  let inputTex: GPUTexture | null = null;
  let chain: any[] = [];
  let bind: GPUBindGroup | null = null;
  let stopped = false;

  const blit = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: "vs" },
    fragment: { module: device.createShaderModule({ code: BLIT_WGSL }), entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  function build(w: number, h: number) {
    inputTex?.destroy();
    W = w; H = h;
    inputTex = device.createTexture({
      size: [w, h], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const d = { device, inputTexture: inputTex };
    // Retro output is small, so a 2× CNN already lands at a sane size; the
    // preset modes (which deblur/denoise first) are what actually help the
    // blurry 3D-era stuff. Targets are capped so a 4K panel can't ask for a
    // 16× chain and hang the GPU.
    const target = { targetDimensions: { width: Math.min(w * 2, 2160), height: Math.min(h * 2, 2160) } };
    chain =
      mode === "fast" ? [new a4k!.CNNx2M(d)]
      : mode === "quality" ? [new a4k!.CNNx2VL(d)]
      : [new a4k!.ModeA({ ...d, nativeDimensions: { width: w, height: h }, ...target })];

    const last = chain[chain.length - 1].getOutputTexture();
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
    if (w !== W || h !== H) {
      try { build(w, h) } catch { stopped = true; return } // an unbuildable chain = fall back to native
    }
    if (!inputTex || !bind) return;
    try {
      device.queue.copyExternalImageToTexture({ source: src }, { texture: inputTex }, [w, h]);
    } catch {
      return; // source not paintable this frame (video between frames, tainted canvas)
    }
    const enc = device.createCommandEncoder();
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
  };

  try { build(first.w, first.h) } catch { device.destroy(); return null }
  raf = requestAnimationFrame(frame);

  return {
    output,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      inputTex?.destroy();
      try { device.destroy() } catch { /* already gone */ }
    },
  };
}
