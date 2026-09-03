// AMD FidelityFX Super Resolution 1.0 — spatial upscaling, as two WebGPU compute
// passes. EASU (Edge Adaptive Spatial Upsampling) reconstructs the larger image
// with a 12-tap kernel that is rotated and stretched along the local edge
// direction, then RCAS (Robust Contrast Adaptive Sharpening) sharpens without
// ringing. Pure arithmetic, no trained weights — so it costs a fraction of the
// CNN modes and is the right "Sharp" tier for a phone GPU.
//
// The algorithm is AMD's, published under MIT (gpuopen.com/fidelityfx-
// superresolution). The two shaders below are a WGSL implementation of it; the
// constant setup mirrors FsrEasuCon so the maths matches the reference.
//
// Exposes the same {pass(enc), getOutputTexture()} shape as the anime4k
// pipelines, so the upscaler drives it identically.

export interface UpscalePipeline {
  pass(enc: GPUCommandEncoder): void;
  getOutputTexture(): GPUTexture;
  destroy(): void;
}

// EASU luma weighting is FSR's own: half red, full green, half blue.
export const FSR_EASU_WGSL = /* wgsl */ `
struct Con { c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f, outSize: vec2f, pad: vec2f };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> con: Con;

fn tapAt(p: vec2f) -> vec3f { return textureSampleLevel(src, samp, p, 0.0).rgb; }

// Accumulate one tap's direction/length contribution (FsrEasuSetF).
fn easuSet(dir: ptr<function, vec2f>, len: ptr<function, f32>, pp: vec2f,
           biS: bool, biT: bool, biU: bool, biV: bool,
           lA: f32, lB: f32, lC: f32, lD: f32, lE: f32) {
  var w = 0.0;
  if (biS) { w = (1.0 - pp.x) * (1.0 - pp.y); }
  if (biT) { w = pp.x * (1.0 - pp.y); }
  if (biU) { w = (1.0 - pp.x) * pp.y; }
  if (biV) { w = pp.x * pp.y; }
  let dc = lD - lC; let cb = lC - lB;
  var lenX = max(abs(dc), abs(cb));
  lenX = 1.0 / max(lenX, 1.0 / 32768.0);
  let dirX = lD - lB;
  (*dir).x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  lenX = lenX * lenX;
  (*len) += lenX * w;
  let ec = lE - lC; let ca = lC - lA;
  var lenY = max(abs(ec), abs(ca));
  lenY = 1.0 / max(lenY, 1.0 / 32768.0);
  let dirY = lE - lA;
  (*dir).y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  lenY = lenY * lenY;
  (*len) += lenY * w;
}

// One filter tap (FsrEasuTapF): anisotropic, rotated Lanczos-like kernel.
fn easuTap(aC: ptr<function, vec3f>, aW: ptr<function, f32>, off: vec2f, dir: vec2f,
           len: vec2f, lob: f32, clp: f32, c: vec3f) {
  var v = vec2f(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x);
  v *= len;
  let d2 = min(dot(v, v), clp);
  var wB = 2.0 / 5.0 * d2 - 1.0;
  var wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA;
  wB = 25.0 / 16.0 * wB - (25.0 / 16.0 - 1.0);
  let w = wB * wA;
  (*aC) += c * w;
  (*aW) += w;
}

fn luma(c: vec3f) -> f32 { return c.b * 0.5 + c.r * 0.5 + c.g; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (f32(gid.x) >= con.outSize.x || f32(gid.y) >= con.outSize.y) { return; }
  let ip = vec2f(gid.xy);
  var pp = ip * con.c0.xy + con.c0.zw;
  let fp = floor(pp);
  pp -= fp;
  // 12 taps around the source pixel, in EASU's letter layout:
  //      b c
  //    e f g h
  //    i j k l
  //      n o
  let p0 = fp * con.c1.xy + con.c1.zw;                 // centre of f
  let p1 = p0 + con.c2.xy;
  let p2 = p0 + con.c2.zw;
  let p3 = p0 + con.c3.xy;
  let bC = tapAt(p0 + vec2f(0.0, -1.0) * con.c1.xy);
  let cC = tapAt(p0 + vec2f(1.0, -1.0) * con.c1.xy);
  let eC = tapAt(p1 + vec2f(-1.0, 0.0) * con.c1.xy);
  let fC = tapAt(p1);
  let gC = tapAt(p1 + vec2f(1.0, 0.0) * con.c1.xy);
  let hC = tapAt(p1 + vec2f(2.0, 0.0) * con.c1.xy);
  let iC = tapAt(p2 + vec2f(-1.0, 0.0) * con.c1.xy);
  let jC = tapAt(p2);
  let kC = tapAt(p2 + vec2f(1.0, 0.0) * con.c1.xy);
  let lC = tapAt(p2 + vec2f(2.0, 0.0) * con.c1.xy);
  let nC = tapAt(p3);
  let oC = tapAt(p3 + vec2f(1.0, 0.0) * con.c1.xy);
  let bL = luma(bC); let cL = luma(cC); let eL = luma(eC); let fL = luma(fC);
  let gL = luma(gC); let hL = luma(hC); let iL = luma(iC); let jL = luma(jC);
  let kL = luma(kC); let lL = luma(lC); let nL = luma(nC); let oL = luma(oC);

  var dir = vec2f(0.0);
  var len = 0.0;
  easuSet(&dir, &len, pp, true,  false, false, false, bL, eL, fL, gL, jL);
  easuSet(&dir, &len, pp, false, true,  false, false, cL, fL, gL, hL, kL);
  easuSet(&dir, &len, pp, false, false, true,  false, fL, iL, jL, kL, nL);
  easuSet(&dir, &len, pp, false, false, false, true,  gL, jL, kL, lL, oL);

  // Normalise the direction; a flat area gets no rotation and a round kernel.
  var dir2 = dir * dir;
  var dirR = dir2.x + dir2.y;
  let zro = dirR < 1.0 / 32768.0;
  dirR = inverseSqrt(max(dirR, 1.0 / 32768.0));
  if (zro) { dirR = 1.0; dir.x = 1.0; }
  dir *= dirR;
  len = len * 0.5;
  len *= len;
  let stretch = (dir.x * dir.x + dir.y * dir.y) / max(abs(dir.x), abs(dir.y));
  let len2 = vec2f(1.0 + (stretch - 1.0) * len, 1.0 + -0.5 * len);
  let lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  let clp = 1.0 / lob;

  // Clamp to the 2x2 centre so the kernel can never invent a brighter pixel.
  let mn = min(min(fC, gC), min(jC, kC));
  let mx = max(max(fC, gC), max(jC, kC));
  var aC = vec3f(0.0);
  var aW = 0.0;
  easuTap(&aC, &aW, vec2f( 0.0, -1.0) - pp, dir, len2, lob, clp, bC);
  easuTap(&aC, &aW, vec2f( 1.0, -1.0) - pp, dir, len2, lob, clp, cC);
  easuTap(&aC, &aW, vec2f(-1.0,  1.0) - pp, dir, len2, lob, clp, iC);
  easuTap(&aC, &aW, vec2f( 0.0,  1.0) - pp, dir, len2, lob, clp, jC);
  easuTap(&aC, &aW, vec2f( 0.0,  0.0) - pp, dir, len2, lob, clp, fC);
  easuTap(&aC, &aW, vec2f(-1.0,  0.0) - pp, dir, len2, lob, clp, eC);
  easuTap(&aC, &aW, vec2f( 1.0,  1.0) - pp, dir, len2, lob, clp, kC);
  easuTap(&aC, &aW, vec2f( 2.0,  1.0) - pp, dir, len2, lob, clp, lC);
  easuTap(&aC, &aW, vec2f( 2.0,  0.0) - pp, dir, len2, lob, clp, hC);
  easuTap(&aC, &aW, vec2f( 1.0,  0.0) - pp, dir, len2, lob, clp, gC);
  easuTap(&aC, &aW, vec2f( 1.0,  2.0) - pp, dir, len2, lob, clp, oC);
  easuTap(&aC, &aW, vec2f( 0.0,  2.0) - pp, dir, len2, lob, clp, nC);
  let out = min(mx, max(mn, aC / max(aW, 1e-5)));
  textureStore(dst, vec2i(gid.xy), vec4f(out, 1.0));
}`;

// RCAS: a 5-tap sharpen whose strength is limited per pixel by how much
// headroom the local neighbourhood has, which is what keeps it from ringing.
export const FSR_RCAS_WGSL = /* wgsl */ `
struct Params { sharp: f32, w: u32, h: u32, pad: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: Params;

fn ld(x: i32, y: i32) -> vec3f {
  let c = vec2i(clamp(x, 0, i32(p.w) - 1), clamp(y, 0, i32(p.h) - 1));
  return textureLoad(src, c, 0).rgb;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= p.w || gid.y >= p.h) { return; }
  let x = i32(gid.x); let y = i32(gid.y);
  let b = ld(x, y - 1); let d = ld(x - 1, y); let e = ld(x, y);
  let f = ld(x + 1, y); let h = ld(x, y + 1);
  // Per-channel min/max of the cross, then the tightest limiter across channels.
  let mn4 = min(min(b, d), min(f, h));
  let mx4 = max(max(b, d), max(f, h));
  let peakC = vec2f(1.0, -4.0);
  let hitMin = mn4 / (4.0 * mx4);
  let hitMax = (peakC.x - mx4) / (4.0 * mn4 + peakC.y);
  let lobeRGB = max(-hitMin, hitMax);
  var lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * p.sharp;
  let outC = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  textureStore(dst, vec2i(x, y), vec4f(clamp(outC, vec3f(0.0), vec3f(1.0)), 1.0));
}`;

/** FsrEasuCon: the four constant vectors EASU needs, from input and output sizes. */
export function easuConstants(inW: number, inH: number, outW: number, outH: number): Float32Array {
  const c = new Float32Array(20);
  c[0] = inW / outW; c[1] = inH / outH;
  c[2] = 0.5 * inW / outW - 0.5; c[3] = 0.5 * inH / outH - 0.5;
  c[4] = 1 / inW; c[5] = 1 / inH; c[6] = 1 / inW; c[7] = -1 / inH;
  c[8] = -1 / inW; c[9] = 2 / inH; c[10] = 1 / inW; c[11] = 2 / inH;
  c[12] = 0; c[13] = 4 / inH; c[14] = 0; c[15] = 0;
  c[16] = outW; c[17] = outH; c[18] = 0; c[19] = 0;
  return c;
}

/** RCAS sharpness: 0 is maximal, each +1 halves it. 0.2 is FSR's usual default. */
export const rcasSharp = (sharpness: number) => Math.pow(2, -sharpness);

export function createFsr(device: GPUDevice, input: GPUTexture, outW: number, outH: number, sharpness = 0.2): UpscalePipeline {
  const mid = device.createTexture({
    size: [outW, outH], format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  // COPY_SRC so the result can be read back — by the diagnostics' frame capture
  // and by the GPU test that checks the kernel produced pixels, not just compiled.
  const out = device.createTexture({
    size: [outW, outH], format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
  });
  const easu = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: FSR_EASU_WGSL }), entryPoint: "main" },
  });
  const rcas = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: FSR_RCAS_WGSL }), entryPoint: "main" },
  });
  const conBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(conBuf, 0, easuConstants(input.width, input.height, outW, outH));
  const prm = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pv = new ArrayBuffer(16);
  new Float32Array(pv, 0, 1)[0] = rcasSharp(sharpness);
  new Uint32Array(pv, 4, 2).set([outW, outH]);
  device.queue.writeBuffer(prm, 0, pv);
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const easuBind = device.createBindGroup({
    layout: easu.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: input.createView() }, { binding: 1, resource: sampler },
      { binding: 2, resource: mid.createView() }, { binding: 3, resource: { buffer: conBuf } },
    ],
  });
  const rcasBind = device.createBindGroup({
    layout: rcas.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: mid.createView() }, { binding: 1, resource: out.createView() },
      { binding: 2, resource: { buffer: prm } },
    ],
  });
  const gx = Math.ceil(outW / 8), gy = Math.ceil(outH / 8);
  return {
    pass(enc) {
      const p = enc.beginComputePass();
      p.setPipeline(easu); p.setBindGroup(0, easuBind); p.dispatchWorkgroups(gx, gy);
      p.setPipeline(rcas); p.setBindGroup(0, rcasBind); p.dispatchWorkgroups(gx, gy);
      p.end();
    },
    getOutputTexture: () => out,
    destroy() { mid.destroy(); out.destroy(); conBuf.destroy(); prm.destroy(); },
  };
}
