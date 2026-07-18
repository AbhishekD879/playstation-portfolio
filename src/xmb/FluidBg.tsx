// Fluid background — a real Navier–Stokes dye simulation in WebGPU compute
// (stable fluids + vorticity confinement), dressed as the XMB ribbon: a
// theme-tinted luminous current sweeping the lower third, pulsing to the
// console's audio, stirred by the pointer, nudged when the crossbar moves.
// Chosen via Settings › Theme › Background = "Fluid" (offered only when the
// device has WebGPU). The classic Wave stays the fallback everywhere else.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { tint } from "../theme";
import { getAnalyser } from "../audio";
import { labEnabled } from "../labs";

// —— tiny cross-module hooks (no-ops unless the fluid is actually running) ——
type Pulse = { x: number; y: number; dx: number; dy: number; r: number; amt: number };
const pulses: Pulse[] = [];
/** XMB nav calls this — the current gets a soft push in the travel direction. */
export function fluidNavPulse(dir: -1 | 1) {
  pulses.push({ x: 0.5 - dir * 0.18, y: 0.62, dx: dir * 0.55, dy: -0.04, r: 0.12, amt: 0.5 });
}
const WGSL_COMMON = /* wgsl */ `
struct U {
  texelV: vec2f, texelD: vec2f,
  dt: f32, time: f32, dissV: f32, dissD: f32,
  curl: f32, count: f32, pad0: f32, pad1: f32,
};
struct Splat { pos: vec2f, vel: vec2f, color: vec3f, radius: f32 };
struct Splats { s: array<Splat, 8> };
`;

// velocity advection + splat forces (reads velIn → writes velOut)
const WGSL_ADVECT_VEL = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<uniform> sp: Splats;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var velIn: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let v = textureSampleLevel(velIn, smp, uv, 0.0).xy;
  let src = uv - v * u.dt;                       // semi-Lagrangian backtrace
  var vel = textureSampleLevel(velIn, smp, src, 0.0).xy * u.dissV;
  let aspect = u.texelV.y / u.texelV.x;          // splats stay round on screen
  for (var i = 0u; i < u32(u.count); i++) {
    let s = sp.s[i];
    var d = uv - s.pos; d.x *= aspect;
    vel += s.vel * exp(-dot(d, d) / (s.radius * s.radius));
  }
  vel = clamp(vel, vec2f(-3.0), vec2f(3.0));       // keep the solve stable
  textureStore(velOut, id.xy, vec4f(vel, 0.0, 1.0));
}`;

// curl (vorticity magnitude) of the velocity field
const WGSL_CURL = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var curlOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(curlOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let l = textureSampleLevel(vel, smp, uv - vec2f(u.texelV.x, 0.0), 0.0).y;
  let r = textureSampleLevel(vel, smp, uv + vec2f(u.texelV.x, 0.0), 0.0).y;
  let b = textureSampleLevel(vel, smp, uv - vec2f(0.0, u.texelV.y), 0.0).x;
  let t = textureSampleLevel(vel, smp, uv + vec2f(0.0, u.texelV.y), 0.0).x;
  textureStore(curlOut, id.xy, vec4f(r - l - t + b, 0.0, 0.0, 1.0));
}`;

// vorticity confinement — swirls stay silky instead of smearing away
const WGSL_VORT = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var curlT: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let l = abs(textureSampleLevel(curlT, smp, uv - vec2f(u.texelV.x, 0.0), 0.0).x);
  let r = abs(textureSampleLevel(curlT, smp, uv + vec2f(u.texelV.x, 0.0), 0.0).x);
  let b = abs(textureSampleLevel(curlT, smp, uv - vec2f(0.0, u.texelV.y), 0.0).x);
  let t = abs(textureSampleLevel(curlT, smp, uv + vec2f(0.0, u.texelV.y), 0.0).x);
  let c = textureSampleLevel(curlT, smp, uv, 0.0).x;
  var force = vec2f(t - b, l - r);              // ∇|ω| rotated
  force = force / (length(force) + 1e-5) * u.curl * c;
  let v = textureSampleLevel(vel, smp, uv, 0.0).xy + force * u.dt;
  textureStore(velOut, id.xy, vec4f(v, 0.0, 1.0));
}`;

const WGSL_DIV = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var divOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(divOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let l = textureSampleLevel(vel, smp, uv - vec2f(u.texelV.x, 0.0), 0.0).x;
  let r = textureSampleLevel(vel, smp, uv + vec2f(u.texelV.x, 0.0), 0.0).x;
  let b = textureSampleLevel(vel, smp, uv - vec2f(0.0, u.texelV.y), 0.0).y;
  let t = textureSampleLevel(vel, smp, uv + vec2f(0.0, u.texelV.y), 0.0).y;
  textureStore(divOut, id.xy, vec4f(0.5 * (r - l + t - b), 0.0, 0.0, 1.0));
}`;

const WGSL_JACOBI = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var pIn: texture_2d<f32>;
@group(0) @binding(3) var divT: texture_2d<f32>;
@group(0) @binding(4) var pOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(pOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let l = textureSampleLevel(pIn, smp, uv - vec2f(u.texelV.x, 0.0), 0.0).x;
  let r = textureSampleLevel(pIn, smp, uv + vec2f(u.texelV.x, 0.0), 0.0).x;
  let b = textureSampleLevel(pIn, smp, uv - vec2f(0.0, u.texelV.y), 0.0).x;
  let t = textureSampleLevel(pIn, smp, uv + vec2f(0.0, u.texelV.y), 0.0).x;
  let d = textureSampleLevel(divT, smp, uv, 0.0).x;
  textureStore(pOut, id.xy, vec4f((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0));
}`;

const WGSL_GRAD = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var pT: texture_2d<f32>;
@group(0) @binding(3) var vel: texture_2d<f32>;
@group(0) @binding(4) var velOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelV;
  let l = textureSampleLevel(pT, smp, uv - vec2f(u.texelV.x, 0.0), 0.0).x;
  let r = textureSampleLevel(pT, smp, uv + vec2f(u.texelV.x, 0.0), 0.0).x;
  let b = textureSampleLevel(pT, smp, uv - vec2f(0.0, u.texelV.y), 0.0).x;
  let t = textureSampleLevel(pT, smp, uv + vec2f(0.0, u.texelV.y), 0.0).x;
  let v = textureSampleLevel(vel, smp, uv, 0.0).xy - 0.5 * vec2f(r - l, t - b);
  textureStore(velOut, id.xy, vec4f(v, 0.0, 1.0));
}`;

// dye advection + splat injection (higher-res grid than velocity)
const WGSL_ADVECT_DYE = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<uniform> sp: Splats;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var vel: texture_2d<f32>;
@group(0) @binding(4) var dyeIn: texture_2d<f32>;
@group(0) @binding(5) var dyeOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dyeOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) * u.texelD;
  let v = textureSampleLevel(vel, smp, uv, 0.0).xy;
  let src = uv - v * u.dt;
  var dye = textureSampleLevel(dyeIn, smp, src, 0.0).rgb * u.dissD;
  let aspect = u.texelD.y / u.texelD.x;
  for (var i = 0u; i < u32(u.count); i++) {
    let s = sp.s[i];
    var d = uv - s.pos; d.x *= aspect;
    dye += s.color * exp(-dot(d, d) / (s.radius * s.radius));
  }
  textureStore(dyeOut, id.xy, vec4f(min(dye, vec3f(4.0)), 1.0));
}`;

// composite: dye → screen, dark-glass style so the CSS gradient shows through
const WGSL_RENDER = /* wgsl */ `
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var dye: texture_2d<f32>;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = p[i] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSampleLevel(dye, smp, in.uv, 0.0).rgb;
  let lum = dot(c, vec3f(0.299, 0.587, 0.114));
  let glow = c + c * c * 0.35;                      // soft self-glow
  // stay out of the crossbar's face — the current lives in the lower half
  let mask = smoothstep(0.18, 0.52, in.uv.y);
  let a = clamp(lum * 0.9, 0.0, 0.55) * mask;
  return vec4f(glow * a, a);                        // premultiplied over the gradient
}`;

export default function FluidBg() {
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    let disposed = false;
    let raf = 0;

    (async () => {
      const adapter = await (navigator as any).gpu?.requestAdapter().catch(() => null);
      const device: GPUDevice | null = adapter ? await adapter.requestDevice().catch(() => null) : null;
      if (!device || disposed) return;
      const ctx = canvas.getContext("webgpu") as unknown as GPUCanvasContext | null;
      if (!ctx) return;
      const format = (navigator as any).gpu.getPreferredCanvasFormat();
      const fit = () => {
        const dpr = Math.min(devicePixelRatio, 1.5);
        canvas.width = Math.max(2, Math.floor(innerWidth * dpr));
        canvas.height = Math.max(2, Math.floor(innerHeight * dpr));
        ctx.configure({ device, format, alphaMode: "premultiplied" });
      };
      fit();
      addEventListener("resize", fit);
      onCleanup(() => removeEventListener("resize", fit));

      // —— sim grids: velocity coarse, dye 2× for crisp ribbons ——
      const VW = 256, VH = 144, DW = 512, DH = 288;
      // usage flags spelled numerically — this TS lib has the WebGPU types but
      // not the const namespaces. TEXTURE_BINDING|STORAGE_BINDING|COPY_DST / UNIFORM|COPY_DST
      const TEX_USAGE = 0x04 | 0x08 | 0x02, UBUF_USAGE = 0x40 | 0x08;
      const mkTex = (w: number, h: number) =>
        device.createTexture({ size: [w, h], format: "rgba16float", usage: TEX_USAGE });
      const vel = [mkTex(VW, VH), mkTex(VW, VH)];
      const dye = [mkTex(DW, DH), mkTex(DW, DH)];
      const press = [mkTex(VW, VH), mkTex(VW, VH)];
      const divT = mkTex(VW, VH);
      const curlT = mkTex(VW, VH);
      const smp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });

      const ubuf = device.createBuffer({ size: 48, usage: UBUF_USAGE });
      const sbuf = device.createBuffer({ size: 8 * 32, usage: UBUF_USAGE });

      const pipe = (code: string) =>
        device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
      const pAdvV = pipe(WGSL_ADVECT_VEL), pCurl = pipe(WGSL_CURL), pVort = pipe(WGSL_VORT);
      const pDiv = pipe(WGSL_DIV), pJac = pipe(WGSL_JACOBI), pGrad = pipe(WGSL_GRAD), pAdvD = pipe(WGSL_ADVECT_DYE);
      const rmod = device.createShaderModule({ code: WGSL_RENDER });
      const pRender = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: rmod, entryPoint: "vs" },
        fragment: { module: rmod, entryPoint: "fs", targets: [{ format, blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
        primitive: { topology: "triangle-list" },
      });

      const bg = (p: GPUComputePipeline | GPURenderPipeline, entries: (GPUSampler | GPUTextureView | GPUBuffer)[]) =>
        device.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: entries.map((r, i) => ({ binding: i, resource: (r as GPUBuffer).size !== undefined ? { buffer: r as GPUBuffer } : (r as GPUSampler | GPUTextureView) })),
        });
      const view = (t: GPUTexture) => t.createView();

      // prebuilt bind groups for both ping-pong directions
      const bgAdvV = [0, 1].map((i) => bg(pAdvV, [ubuf, sbuf, smp, view(vel[i]), view(vel[1 - i])]));
      const bgCurl = [0, 1].map((i) => bg(pCurl, [ubuf, smp, view(vel[i]), view(curlT)]));
      const bgVort = [0, 1].map((i) => bg(pVort, [ubuf, smp, view(vel[i]), view(curlT), view(vel[1 - i])]));
      const bgDiv = [0, 1].map((i) => bg(pDiv, [ubuf, smp, view(vel[i]), view(divT)]));
      const bgJac = [0, 1].map((i) => bg(pJac, [ubuf, smp, view(press[i]), view(divT), view(press[1 - i])]));
      const bgGrad = [0, 1].map((pi) => [0, 1].map((vi) => bg(pGrad, [ubuf, smp, view(press[pi]), view(vel[vi]), view(vel[1 - vi])])));
      const bgAdvD = [0, 1].map((vi) => [0, 1].map((di) => bg(pAdvD, [ubuf, sbuf, smp, view(vel[vi]), view(dye[di]), view(dye[1 - di])])));
      const bgRender = [0, 1].map((i) => bg(pRender, [smp, view(dye[i])]));

      // —— audio level (same master-bus bass read as the Wave) ——
      let analyser: AnalyserNode | null = null, freq: Uint8Array | null = null;
      try { analyser = getAnalyser(); freq = new Uint8Array(analyser.frequencyBinCount); } catch { /* not yet */ }
      let audio = 0;

      // pointer stirs the current
      let px = -1, py = -1, pdx = 0, pdy = 0, pmoved = false;
      const onMove = (e: PointerEvent) => {
        const nx = e.clientX / innerWidth, ny = e.clientY / innerHeight;
        if (px >= 0) { pdx = nx - px; pdy = ny - py; pmoved = Math.abs(pdx) + Math.abs(pdy) > 0.0005; }
        px = nx; py = ny;
      };
      addEventListener("pointermove", onMove);
      onCleanup(() => removeEventListener("pointermove", onMove));

      let vi = 0, di = 0, pi = 0;
      let time = Math.random() * 100;
      let last = performance.now();
      const udata = new Float32Array(12);
      const sdata = new Float32Array(8 * 8);
      const tintCol = new THREE.Color();

      const frame = (now: number) => {
        if (disposed) return;
        raf = requestAnimationFrame(frame);
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        time += dt;

        if (analyser && freq) {
          analyser.getByteFrequencyData(freq as any);
          let sum = 0; for (let i = 2; i < 26; i++) sum += freq[i];
          audio += (Math.min(1, sum / 24 / 165) - audio) * 0.16;
        }
        tintCol.set(tint());

        // —— build this frame's splats: the sweeping ribbon + interactions ——
        let n = 0;
        const put = (x: number, y: number, dx: number, dy: number, r: number, cr: number, cg: number, cb: number) => {
          if (n >= 8) return;
          sdata.set([x, y, dx, dy, cr, cg, cb, r], n * 8);
          n++;
        };
        // the ribbon: a slow horizontal sweep along the lower third. Injection
        // scales with path speed so the sine's turning points don't pool dye.
        const rx = 0.5 + Math.sin(time * 0.13) * 0.42;
        const ry = 0.66 + Math.sin(time * 0.47) * 0.05;
        const pace = Math.abs(Math.cos(time * 0.13));        // 0 at the edges
        const glow = (0.13 + audio * 0.55) * (0.25 + pace * 0.75);
        put(rx, ry, Math.cos(time * 0.13) * 0.35, -0.012 - audio * 0.1, 0.042, tintCol.r * glow, tintCol.g * glow, tintCol.b * glow);
        // a faint counter-current, phase-shifted, slightly whiter
        const r2x = 0.5 + Math.sin(time * 0.09 + 2.6) * 0.45;
        const r2y = 0.74 + Math.sin(time * 0.31 + 1.2) * 0.04;
        const g2 = (0.03 + audio * 0.18) * (0.25 + Math.abs(Math.cos(time * 0.09 + 2.6)) * 0.75);
        put(r2x, r2y, -Math.cos(time * 0.09 + 2.6) * 0.25, -0.008, 0.04,
          (tintCol.r * 0.5 + 0.5) * g2, (tintCol.g * 0.5 + 0.5) * g2, (tintCol.b * 0.5 + 0.5) * g2);
        // pointer stir — motion only, barely any dye (keeps it classy)
        if (pmoved && px >= 0) {
          put(px, py, pdx * 18, pdy * 18, 0.06, tintCol.r * 0.02, tintCol.g * 0.02, tintCol.b * 0.02);
          pmoved = false;
        }
        // queued pulses from the crossbar / app launches
        while (pulses.length && n < 8) {
          const p = pulses.shift()!;
          put(p.x, p.y, p.dx, p.dy, p.r, tintCol.r * p.amt * 0.35, tintCol.g * p.amt * 0.35, tintCol.b * p.amt * 0.35);
        }

        udata.set([1 / VW, 1 / VH, 1 / DW, 1 / DH, dt, time, Math.exp(-dt * 0.35), Math.exp(-dt * 0.75), 6, n, 0, 0]);
        device.queue.writeBuffer(ubuf, 0, udata);
        device.queue.writeBuffer(sbuf, 0, sdata);

        const enc = device.createCommandEncoder();
        const gx = Math.ceil(VW / 8), gy = Math.ceil(VH / 8);
        const run = (p: GPUComputePipeline, b: GPUBindGroup, x = gx, y = gy) => {
          const pass = enc.beginComputePass();
          pass.setPipeline(p); pass.setBindGroup(0, b); pass.dispatchWorkgroups(x, y); pass.end();
        };
        run(pAdvV, bgAdvV[vi]); vi = 1 - vi;
        run(pCurl, bgCurl[vi]);
        run(pVort, bgVort[vi]); vi = 1 - vi;
        run(pDiv, bgDiv[vi]);
        for (let i = 0; i < 20; i++) { run(pJac, bgJac[pi]); pi = 1 - pi; }
        run(pGrad, bgGrad[pi][vi]); vi = 1 - vi;
        run(pAdvD, bgAdvD[vi][di], Math.ceil(DW / 8), Math.ceil(DH / 8)); di = 1 - di;

        const rp = enc.beginRenderPass({
          colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }],
        });
        rp.setPipeline(pRender); rp.setBindGroup(0, bgRender[di]); rp.draw(3); rp.end();
        device.queue.submit([enc.finish()]);
      };
      raf = requestAnimationFrame(frame);

      onCleanup(() => {
        [...vel, ...dye, ...press, divT, curlT].forEach((t) => t.destroy());
        device.destroy();
      });
    })();

    onCleanup(() => { disposed = true; cancelAnimationFrame(raf); });
  });

  return <canvas class="fluid-canvas" ref={canvas} style={{ opacity: labEnabled("livingbg") ? 1 : 0 }} />;
}
