// GPU particle juice — a million-particle compute pool (three.js WebGPURenderer
// + TSL) living on a transparent overlay canvas. Everything runs on the GPU:
// spawning bursts, integration, fade-out. The overlay renders only while
// particles are alive, so idle cost is zero. No WebGPU → every call no-ops.
//
// This is also the console's TSL/WebGPURenderer beachhead: shaders written as
// TSL nodes, compiled to WGSL by three.
import { labEnabled } from "./labs";
import { tint } from "./theme";

type BurstOpts = {
  /** screen px; defaults to the selected XMB item (or screen center) */
  x?: number; y?: number;
  count?: number;
  /** css color; defaults to the console tint */
  color?: string;
  gold?: boolean; // trophy style — gold shower with extra sparkle
};

const MOBILE = matchMedia("(pointer: coarse)").matches;
const POOL = MOBILE ? 1 << 18 : 1 << 20; // 262k mobile · 1,048,576 desktop
const MAX_SPAWN = 1 << 17;               // per-burst ceiling (131k)

let state: null | "dead" | {
  renderer: any; scene: any; camera: any; canvas: HTMLCanvasElement;
  update: any; spawn: any;
  u: Record<string, any>;
  alive: number; head: number; raf: number; last: number;
} = null;
let booting: Promise<void> | null = null;

async function boot() {
  const [THREE, TSL] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
  const { Fn, If, deltaTime, float, hash, instanceIndex, instancedArray, uniform, uint, vec2, vec3, vec4 } = TSL as any;

  const canvas = document.createElement("canvas");
  canvas.className = "juice-canvas";
  canvas.style.cssText = "position:fixed;inset:0;z-index:45;pointer-events:none;width:100%;height:100%;display:none";
  document.body.appendChild(canvas);

  const renderer = new (THREE as any).WebGPURenderer({ canvas, alpha: true, antialias: false, forceWebGL: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  await renderer.init();
  if ((renderer.backend?.isWebGPUBackend ?? false) === false) throw new Error("no webgpu backend");

  // world = screen pixels, y-up (a y-down ortho flips winding and every face
  // gets backface-culled); fire() converts screen y → world y
  const camera = new (THREE as any).OrthographicCamera(0, innerWidth, innerHeight, 0, 0.1, 20);
  camera.position.z = 5; // sprites live at z=0 — billboarding needs real distance
  const scene = new (THREE as any).Scene();
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.right = innerWidth; camera.top = innerHeight;
    camera.updateProjectionMatrix();
  });

  const positions = instancedArray(POOL, "vec3");
  const velocities = instancedArray(POOL, "vec3");
  const lifes = instancedArray(POOL, "vec2"); // x = life left (s), y = 1/lifespan

  // —— integrate: drag + slight rise-then-fall + fade; dead particles skip ——
  const update = Fn(() => {
    const life = lifes.element(instanceIndex);
    If(life.x.greaterThan(0.0), () => {
      const dt = deltaTime;
      const v = velocities.element(instanceIndex);
      const p = positions.element(instanceIndex);
      life.x.subAssign(dt);
      v.assign(v.mul(float(1.0).sub(dt.mul(1.9)))); // exponential-ish drag
      v.y.subAssign(dt.mul(340.0));                 // gentle gravity (y-up world)
      p.assign(p.add(v.mul(dt)));
    });
  })().compute(POOL);

  // —— spawn a slice of the pool as a radial burst with curl-y variation ——
  const u = {
    origin: uniform(new (THREE as any).Vector2(0, 0)),
    seed: uniform(0, "uint"),
    offset: uniform(0, "uint"),
    n: uniform(0, "uint"),
    speed: uniform(520),
    spread: uniform(1.0), // 1 = full circle, <1 squashes vertically (fountain)
    lifespan: uniform(1.5),
  };
  const spawn = Fn(() => {
    If(instanceIndex.lessThan(u.n), () => {
      const i = u.offset.add(instanceIndex).mod(uint(POOL));
      const h1 = hash(instanceIndex.add(u.seed));
      const h2 = hash(instanceIndex.add(u.seed).add(uint(19349663)));
      const h3 = hash(instanceIndex.add(u.seed).add(uint(83492791)));
      const ang = h1.mul(6.28318);
      const speed = u.speed.mul(h2.mul(h2).mul(1.4).add(0.08)); // wide spread — most slow, a fast halo
      const dir = vec3(ang.cos(), ang.sin().mul(u.spread), 0.0);
      positions.element(i).assign(vec3(u.origin.x, u.origin.y, 0.0));
      velocities.element(i).assign(dir.mul(speed).add(vec3(0.0, float(90.0).mul(h3), 0.0))); // slight upward kick
      const span = u.lifespan.mul(h3.mul(0.7).add(0.5));
      lifes.element(i).assign(vec2(span, float(1.0).div(span)));
    });
  })().compute(MAX_SPAWN);

  // —— draw: additive glow sprites, white-hot core → tinted tail, GPU fade ——
  const uColor = uniform(new (THREE as any).Color(1, 1, 1));
  const mat = new (THREE as any).SpriteNodeMaterial({ transparent: true, blending: (THREE as any).AdditiveBlending, depthWrite: false, depthTest: false });
  const life = lifes.toAttribute();
  const t = life.x.mul(life.y).clamp(0.0, 1.0); // 1 → fresh, 0 → dying
  mat.positionNode = positions.toAttribute();
  mat.scaleNode = t.mul(t).mul(2.6).add(0.8);
  const core = vec3(1.0, 1.0, 1.0).mul(t.pow(5.0)).mul(0.5); // brief white-hot flash
  mat.colorNode = vec4(vec3(uColor).mul(t.mul(0.85).add(0.15)).add(core), t.mul(t).mul(0.2));
  const sprites = new (THREE as any).Sprite(mat);
  sprites.count = POOL;
  sprites.frustumCulled = false;
  scene.add(sprites);

  state = { renderer, scene, camera, canvas, update, spawn, u: { ...u, color: uColor }, alive: 0, head: 0, raf: 0, last: 0 };
}

function loop(now: number) {
  if (!state || state === "dead") return;
  const s = state;
  s.renderer.compute(s.update);
  s.renderer.render(s.scene, s.camera);
  if (now > s.last + (s.u.lifespan.value as number) * 1400 + 600) { // everything faded
    s.renderer.setAnimationLoop(null); // sleep — zero idle cost
    s.canvas.style.display = "none";
    s.alive = 0;
  }
}

/** Fire a particle burst. Safe to call from anywhere; no-ops without WebGPU. */
export function burst(opts: BurstOpts = {}) {
  if (!labEnabled("gpujuice")) return;
  if (state === "dead") return;
  if (!(navigator as any).gpu) { state = "dead"; return; }
  if (!state) {
    if (!booting) booting = boot().catch(() => { state = "dead"; });
    booting.then(() => fire(opts));
    return;
  }
  fire(opts);
}

function fire(opts: BurstOpts) {
  if (!state || state === "dead") return;
  const s = state;
  // default origin: the selected crossbar item (that's what just launched)
  let x = opts.x, y = opts.y;
  if (x === undefined || y === undefined) {
    const r = document.querySelector(".item.selected")?.getBoundingClientRect();
    x = x ?? (r ? r.left + 40 : innerWidth / 2);
    y = y ?? (r ? r.top + r.height / 2 : innerHeight * 0.45);
  }
  const n = Math.min(opts.count ?? (opts.gold ? 70_000 : 45_000), MAX_SPAWN);
  s.u.origin.value.set(x, innerHeight - y); // screen y-down → world y-up
  s.u.seed.value = (Math.random() * 1e6) | 0;
  s.u.offset.value = s.head;
  s.u.n.value = n;
  s.u.speed.value = opts.gold ? 420 : 540;
  s.u.spread.value = opts.gold ? 0.75 : 1.0;
  s.u.lifespan.value = opts.gold ? 2.2 : 1.4;
  s.u.color.value.set(opts.color ?? (opts.gold ? "#f5c542" : tint()));
  s.head = (s.head + n) % POOL;
  s.renderer.compute(s.spawn);
  s.canvas.style.display = "block";
  s.last = performance.now();
  if (!s.alive) { s.alive = 1; s.renderer.setAnimationLoop(loop); }
}
