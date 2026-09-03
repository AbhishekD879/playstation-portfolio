// Motion smoothing: image-based frame interpolation on WebGPU.
//
// A 30fps game presented at 60Hz shows every frame twice. This synthesises the
// frame in between from the two real ones, the way a TV's motion smoothing does,
// so the picture moves every refresh. It is honest about being image-based:
// DLSS Frame Generation reads the engine's own motion vectors and depth, which an
// emulator cannot provide, so the motion here is ESTIMATED by block matching.
// That means one source frame of added latency (the in-between frame needs both
// neighbours) and soft artefacts on hard cuts — which is why it ships off.
//
// Per display tick, in one encoder:
//   1. diff   : is the freshly captured frame different from the last accepted
//               one? A 32×32 luma comparison summed into one atomic. Read back
//               asynchronously, so the answer is used one tick late — fine, a
//               30fps frame holds for two ticks.
//   2. flow   : coarse optical flow, one vector per 16×16 block, from block
//               matching over a ±3-cell search at quarter resolution.
//   3. warp   : each pixel pulls the previous frame forward and the current one
//               back by half the local flow and blends them; where the two
//               disagree the estimate is untrusted and it falls back to a plain
//               crossfade, which is at worst a soft frame rather than a torn one.
// When the source turns out to run at 60 already (new frame nearly every tick),
// interpolating only adds lag, so it bypasses itself.

export interface FrameGen {
  /** Interpolated (or passed-through) frame at source resolution. */
  output: GPUTexture;
  /** Record the GPU work for this tick. `input` must already hold this tick's capture. */
  pass(enc: GPUCommandEncoder): void;
  /** Call after queue.submit(): kicks the async readback of this tick's diff. */
  afterSubmit(): void;
  /** For the diagnostics: what the smoother thinks it is doing. */
  stats(): { newFrames: number; interpolated: number; bypass: boolean; sourceHz: number };
  destroy(): void;
}

export const FG_DIFF_WGSL = /* wgsl */ `
@group(0) @binding(0) var a: texture_2d<f32>;
@group(0) @binding(1) var b: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<storage, read_write> sum: atomic<u32>;
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= 32u || gid.y >= 32u) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / 32.0;
  let d = abs(luma(textureSampleLevel(a, samp, uv, 0.0).rgb) - luma(textureSampleLevel(b, samp, uv, 0.0).rgb));
  atomicAdd(&sum, u32(d * 255.0));
}`;

export const FG_FLOW_WGSL = /* wgsl */ `
struct P { size: vec2f, cells: vec2f };
@group(0) @binding(0) var prev: texture_2d<f32>;
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var flow: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> p: P;
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
// Sum of absolute differences between a 4×4 block (in quarter-res cells, so 16
// full-res pixels a side) of cur at 'base' and the same block of prev shifted by
// 'off' — both in full-res pixel units.
fn sad(base: vec2f, off: vec2f) -> f32 {
  var s = 0.0;
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      let q = base + (vec2f(f32(x), f32(y)) + 0.5) * 4.0;
      let lc = luma(textureSampleLevel(cur, samp, q / p.size, 0.0).rgb);
      let lp = luma(textureSampleLevel(prev, samp, (q - off) / p.size, 0.0).rgb);
      s += abs(lc - lp);
    }
  }
  return s;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (f32(gid.x) >= p.cells.x || f32(gid.y) >= p.cells.y) { return; }
  let base = vec2f(gid.xy) * 16.0;
  var best = sad(base, vec2f(0.0));
  var bestOff = vec2f(0.0);
  // ±3 cells of 4px = ±12px of motion per frame at source resolution.
  for (var dy = -3; dy <= 3; dy++) {
    for (var dx = -3; dx <= 3; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let off = vec2f(f32(dx), f32(dy)) * 4.0;
      // a small bias toward zero motion keeps flat areas from jittering
      let s = sad(base, off) + 0.002 * length(off);
      if (s < best) { best = s; bestOff = off; }
    }
  }
  textureStore(flow, vec2i(gid.xy), vec4f(bestOff, 0.0, 0.0));
}`;

export const FG_WARP_WGSL = /* wgsl */ `
struct P { size: vec2f, cells: vec2f };
@group(0) @binding(0) var prev: texture_2d<f32>;
@group(0) @binding(1) var cur: texture_2d<f32>;
@group(0) @binding(2) var flow: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<uniform> p: P;
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (f32(gid.x) >= p.size.x || f32(gid.y) >= p.size.y) { return; }
  let px = vec2f(gid.xy) + 0.5;
  // bilinear flow: cell centres sit at (i+0.5)*16
  let v = textureSampleLevel(flow, samp, px / (p.cells * 16.0), 0.0).xy;
  let uvA = (px - 0.5 * v) / p.size;
  let uvB = (px + 0.5 * v) / p.size;
  let aw = textureSampleLevel(prev, samp, uvA, 0.0).rgb;
  let bw = textureSampleLevel(cur, samp, uvB, 0.0).rgb;
  let a0 = textureSampleLevel(prev, samp, px / p.size, 0.0).rgb;
  let b0 = textureSampleLevel(cur, samp, px / p.size, 0.0).rgb;
  // if the two warped views disagree the motion estimate is wrong here — fade to
  // a plain crossfade rather than show a tear
  let conf = 1.0 - smoothstep(0.12, 0.35, abs(luma(aw) - luma(bw)));
  let m = mix(0.5 * (a0 + b0), 0.5 * (aw + bw), conf);
  textureStore(dst, vec2i(gid.xy), vec4f(m, 1.0));
}`;

/** Mean luma difference (0–255 scale, over 1024 samples) above which the capture
 *  counts as a new source frame. ~2 levels: below that is compression noise. */
export const NEW_FRAME_SUM = 2 * 1024;
/** Above this many new frames per second the source is already smooth and
 *  interpolating would only add a frame of lag. */
export const BYPASS_HZ = 45;

export function createFrameGen(device: GPUDevice, input: GPUTexture, w: number, h: number): FrameGen {
  const cw = Math.ceil(w / 16), ch = Math.ceil(h / 16);
  const texUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
  const prev = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: texUsage });
  const cur = device.createTexture({ size: [w, h], format: "rgba8unorm", usage: texUsage });
  const output = device.createTexture({
    size: [w, h], format: "rgba8unorm",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  });
  // rgba16float, not rgba16float: only the former is a storage-capable format, and
  // the runtime refuses the texture otherwise. The .zw lanes go unused.
  const flow = device.createTexture({ size: [cw, ch], format: "rgba16float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const samp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(params, 0, new Float32Array([w, h, cw, ch]));

  const mk = (code: string) => device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } });
  const diffP = mk(FG_DIFF_WGSL), flowP = mk(FG_FLOW_WGSL), warpP = mk(FG_WARP_WGSL);

  const sumBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  // two staging buffers so a buffer still mapped from the last tick is never reused
  const staging = [0, 1].map(() => device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
  const mapped = [false, false];

  const diffBind = device.createBindGroup({ layout: diffP.getBindGroupLayout(0), entries: [
    { binding: 0, resource: input.createView() }, { binding: 1, resource: cur.createView() },
    { binding: 2, resource: samp }, { binding: 3, resource: { buffer: sumBuf } },
  ] });
  const flowBind = device.createBindGroup({ layout: flowP.getBindGroupLayout(0), entries: [
    { binding: 0, resource: prev.createView() }, { binding: 1, resource: cur.createView() },
    { binding: 2, resource: samp }, { binding: 3, resource: flow.createView() }, { binding: 4, resource: { buffer: params } },
  ] });
  const warpBind = device.createBindGroup({ layout: warpP.getBindGroupLayout(0), entries: [
    { binding: 0, resource: prev.createView() }, { binding: 1, resource: cur.createView() },
    { binding: 2, resource: flow.createView() }, { binding: 3, resource: samp },
    { binding: 4, resource: output.createView() }, { binding: 5, resource: { buffer: params } },
  ] });

  let tick = 0, lastDiff = Number.MAX_SAFE_INTEGER; // first capture always counts as new
  let newFrames = 0, interpolated = 0, primed = 0;
  const arrivals: number[] = [];          // timestamps of accepted frames, for the Hz estimate
  const sourceHz = () => {
    const now = performance.now();
    while (arrivals.length && now - arrivals[0] > 1000) arrivals.shift();
    return arrivals.length;
  };

  return {
    output,
    pass(enc) {
      const isNew = lastDiff > NEW_FRAME_SUM;
      const hz = sourceHz();
      const bypass = hz > BYPASS_HZ;
      if (isNew) {
        newFrames++;
        arrivals.push(performance.now());
        // accept: cur becomes prev, the capture becomes cur
        enc.copyTextureToTexture({ texture: cur }, { texture: prev }, [w, h]);
        enc.copyTextureToTexture({ texture: input }, { texture: cur }, [w, h]);
        primed = Math.min(primed + 1, 2);
      }
      // diff for NEXT tick's decision: this capture vs what we just accepted
      device.queue.writeBuffer(sumBuf, 0, new Uint32Array([0]));
      const cp = enc.beginComputePass();
      cp.setPipeline(diffP); cp.setBindGroup(0, diffBind); cp.dispatchWorkgroups(4, 4);
      if (isNew && primed >= 2 && !bypass) {
        // a fresh pair: present the frame BETWEEN them
        cp.setPipeline(flowP); cp.setBindGroup(0, flowBind); cp.dispatchWorkgroups(Math.ceil(cw / 8), Math.ceil(ch / 8));
        cp.setPipeline(warpP); cp.setBindGroup(0, warpBind); cp.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
        interpolated++;
        cp.end();
      } else {
        // no new source frame (or bypassing): present the latest real frame
        cp.end();
        enc.copyTextureToTexture({ texture: cur }, { texture: output }, [w, h]);
      }
      const s = tick & 1;
      if (!mapped[s]) enc.copyBufferToBuffer(sumBuf, 0, staging[s], 0, 4);
    },
    afterSubmit() {
      const s = tick & 1;
      tick++;
      if (mapped[s]) return;
      mapped[s] = true;
      staging[s].mapAsync(GPUMapMode.READ).then(() => {
        lastDiff = new Uint32Array(staging[s].getMappedRange())[0];
        staging[s].unmap();
        mapped[s] = false;
      }).catch(() => { mapped[s] = false; lastDiff = Number.MAX_SAFE_INTEGER; }); // lost device: treat as new, keep moving
    },
    stats: () => ({ newFrames, interpolated, bypass: sourceHz() > BYPASS_HZ, sourceHz: sourceHz() }),
    destroy() {
      for (const t of [prev, cur, output, flow]) t.destroy();
      for (const b of [params, sumBuf, ...staging]) { try { b.destroy(); } catch { /* mapped buffers throw; fine */ } }
    },
  };
}
