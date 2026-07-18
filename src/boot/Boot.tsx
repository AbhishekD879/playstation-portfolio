// Console boot — the void wakes up. A galaxy of light swirls in the dark,
// gathers into a core, ignites on the chime's arrival hit, and blooms into a
// rippling wave (the same wave the XMB lives on, in this month's colour).
// PS2 soul, PS3 polish. Skippable with Enter / click.
//
// Two engines, one choreography: the classic path animates 6k points on the
// CPU (WebGL, runs anywhere). With Labs "galaxyboot" + WebGPU, the stars are
// a ~200k-sprite TSL cloud with real spiral arms — every orbit computed in
// the vertex stage from the same gather/burst tweens. Falls back silently.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import gsap from "gsap";
import { bootChime } from "../audio";
import { tint } from "../theme";
import { labEnabled } from "../labs";
import { DEVICE } from "../gpu";

function glowTexture(color: string): THREE.Texture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export default function Boot(props: { onDone: () => void }) {
  let canvas!: HTMLCanvasElement;
  let lineEl!: HTMLDivElement;
  let markEl!: HTMLDivElement;
  let flashEl!: HTMLDivElement;
  let root!: HTMLDivElement;

  onMount(() => {
    let cancelled = false;
    let teardown: (() => void) | null = null;

    void start();
    onCleanup(() => { cancelled = true; teardown?.(); });

    async function start() {
      const accent = new THREE.Color(tint());

      // —— pick the engine: TSL galaxy (Labs) or the classic CPU one ——
      let renderer: any = null;
      let gpuStars: { uT: any; uWarp: any; uGather: any; uBurst: any; uFade: any } | null = null;
      let scene: any;
      if (labEnabled("galaxyboot") && (navigator as any).gpu) {
        try {
          const [T, TSL] = await Promise.all([import("three/webgpu"), import("three/tsl")]);
          if (cancelled) return;
          const r = new (T as any).WebGPURenderer({ canvas, antialias: true });
          r.setPixelRatio(Math.min(devicePixelRatio, 2));
          r.setSize(innerWidth, innerHeight);
          await r.init();
          if (cancelled) { r.dispose(); return; }
          if ((r.backend?.isWebGPUBackend ?? false) === false) throw new Error("no webgpu backend");
          renderer = r;
          scene = new (T as any).Scene();

          const { float, hash, instanceIndex, uniform, uint, uv, vec2, vec3, vec4 } = TSL as any;
          const N = DEVICE.mobile ? 60_000 : 200_000;
          const uT = uniform(0), uWarp = uniform(0), uGather = uniform(0), uBurst = uniform(0), uFade = uniform(0);

          // per-star constants, derived from instanceIndex hashes (no buffers)
          const h1 = hash(instanceIndex);
          const h2 = hash(instanceIndex.add(uint(19349663)));
          const h3 = hash(instanceIndex.add(uint(83492791)));
          const h4 = hash(instanceIndex.add(uint(28571)));
          const R0 = h1.sqrt().mul(24.0).add(4.0);            // even disc density
          // three spiral arms: quantised base angle + radius-proportional twist
          const arm = h2.mul(3.0).floor().mul(2.0944);
          const A0 = arm.add(h3.mul(0.85)).add(R0.mul(0.28));
          const SP = float(2.2).div(R0).add(h3.mul(0.12));    // inner orbits faster
          const yc = h4.sub(0.5);
          const Y0 = yc.mul(yc).mul(yc).mul(20.0);            // cube by hand — WGSL pow(<0) is NaN

          const a = A0.add(uWarp.mul(SP));
          const rHome = R0.mul(uGather.oneMinus()).add(uGather.mul(0.5));
          const rr = rHome.add(R0.mul(1.12).mul(uBurst));
          const ripple = rr.mul(0.55).sub(uT.mul(2.4)).sin().mul(0.6).mul(uBurst);
          const y = Y0.mul(uGather.oneMinus())
            .add(a.mul(3.0).add(uT).sin().mul(0.14).mul(uBurst.oneMinus()))
            .add(ripple);

          const mat = new (T as any).SpriteNodeMaterial({
            transparent: true, blending: (T as any).AdditiveBlending, depthWrite: false, depthTest: false,
          });
          mat.positionNode = vec3(rr.mul(a.cos()), y, rr.mul(a.sin()));
          mat.scaleNode = h1.mul(0.16).add(0.09)
            .mul(uT.mul(2.2).add(h2.mul(6.283)).sin().mul(0.18).add(1.0)); // twinkle
          // soft round glow in the fragment stage — no texture needed
          const d = uv().sub(vec2(0.5, 0.5)).length();
          const glow = d.mul(2.0).oneMinus().clamp(0.0, 1.0);
          const white = vec3(0.92, 0.96, 1.0);
          const acc = vec3(accent.r, accent.g, accent.b);
          const deep = vec3(0.23, 0.42, 0.85);
          const m = hash(instanceIndex.add(uint(777)));
          const starCol = white.mix(acc, m.smoothstep(0.30, 0.55)).mix(deep, m.smoothstep(0.78, 0.95));
          // 33× the classic star count stacks additively — keep per-star alpha tiny
          mat.colorNode = vec4(starCol.add(glow.pow(8.0).mul(0.4)), glow.mul(glow).mul(0.1).mul(uFade));
          const sprites = new (T as any).Sprite(mat);
          sprites.count = N;
          sprites.frustumCulled = false;
          scene.add(sprites);
          gpuStars = { uT, uWarp, uGather, uBurst, uFade };
        } catch {
          renderer?.dispose?.();
          renderer = null; // fall through to classic
        }
      }
      if (cancelled) return;
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(innerWidth, innerHeight);
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        scene = new THREE.Scene();
      }
      const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
      camera.position.set(0, 2.4, 30);

      // —— classic CPU galaxy (only when the GPU path didn't take) ——
      const N = 6000;
      const pos = new Float32Array(N * 3);
      let geo: THREE.BufferGeometry | null = null;
      let cpuMat: THREE.PointsMaterial | null = null;
      let dotTex: THREE.Texture | null = null;
      const R0 = new Float32Array(N); // home orbit radius
      const A0 = new Float32Array(N); // start angle
      const SP = new Float32Array(N); // angular speed
      const Y0 = new Float32Array(N); // vertical scatter
      if (!gpuStars) {
        const col = new Float32Array(N * 3);
        const white = new THREE.Color(0.92, 0.96, 1);
        const deep = new THREE.Color(0x3a6bd8);
        const tmp = new THREE.Color();
        for (let i = 0; i < N; i++) {
          R0[i] = 4 + 24 * Math.sqrt(Math.random()); // even disc density
          A0[i] = Math.random() * Math.PI * 2;
          SP[i] = 2.2 / R0[i] + Math.random() * 0.12; // inner orbits spin faster
          Y0[i] = Math.pow(Math.random() - 0.5, 3) * 20;
          const m = Math.random();
          tmp.copy(m < 0.5 ? white : m < 0.8 ? accent : deep);
          col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
        }
        geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        // soft round sprite — without a map, points draw as hard squares
        dotTex = glowTexture("rgba(255,255,255,0.5)");
        cpuMat = new THREE.PointsMaterial({
          map: dotTex, size: 0.26, vertexColors: true, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        scene.add(new THREE.Points(geo, cpuMat));
      }

      // —— the core: an additive glow that ignites when the galaxy collapses ——
      const glowTex = glowTexture(`#${accent.getHexString()}`);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      core.scale.set(0.1, 0.1, 1);
      scene.add(core);

      // —— the shockwave ring (faces the camera) ——
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 80),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }),
      );
      scene.add(ring);

      // tweened by the timeline; read every frame
      const S = { gather: 0, burst: 0, speed: 1 };

      let elapsed = 0;
      let warp = 0; // ∫ speed dt — the GPU stars orbit on this
      let last = performance.now();
      const render = () => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        elapsed += dt;
        warp += dt * S.speed;

        if (gpuStars) {
          gpuStars.uT.value = elapsed;
          gpuStars.uWarp.value = warp;
          gpuStars.uGather.value = S.gather;
          gpuStars.uBurst.value = S.burst;
        } else {
          for (let i = 0; i < N; i++) {
            const a = A0[i] + elapsed * SP[i] * S.speed;
            // orbit → collapse to the core → bloom back out as a wave
            const rHome = R0[i] * (1 - S.gather) + 0.5 * S.gather;
            const r = rHome + R0[i] * 1.12 * S.burst;
            const ripple = Math.sin(r * 0.55 - elapsed * 2.4) * 0.6 * S.burst;
            const y = Y0[i] * (1 - S.gather) + Math.sin(a * 3 + elapsed) * 0.14 * (1 - S.burst) + ripple;
            pos[i * 3] = r * Math.cos(a);
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = r * Math.sin(a);
          }
          (geo!.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        }

        // heartbeat on the core so it never reads as a static PNG
        const pulse = 1 + Math.sin(elapsed * 6) * 0.045;
        core.scale.x *= pulse / (core.userData.lastPulse ?? 1);
        core.scale.y = core.scale.x;
        core.userData.lastPulse = pulse;

        camera.lookAt(0, 0.4, 0);
        renderer.render(scene, camera);
      };
      renderer.setAnimationLoop(render); // WebGPU only presents through its own loop

      const onResize = () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
      };
      addEventListener("resize", onResize);

      // —— the sequence (chime's arrival hit lands ~3.1s in — ignition syncs to it) ——
      bootChime();
      const fade: { obj: any; key: string } = gpuStars
        ? { obj: gpuStars.uFade, key: "value" }
        : { obj: cpuMat, key: "opacity" };
      const tl = gsap.timeline({ onComplete: finish });
      tl
        // the void breathes in: galaxy fades up already swirling
        .fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "power1.out" }, 0.15)
        .to(fade.obj, { [fade.key]: 0.85, duration: 1.4 }, 0.15)
        .fromTo(lineEl, { opacity: 0, letterSpacing: "0.18em" }, { opacity: 1, letterSpacing: "0.46em", duration: 1.5, ease: "power2.out" }, 0.35)
        .to(lineEl, { opacity: 0, duration: 0.6 }, 2.35)
        // gravity wins: everything spirals into the core
        .to(S, { gather: 1, duration: 2.7, ease: "power3.in" }, 0.5)
        .to(S, { speed: 3.4, duration: 2.7, ease: "power2.in" }, 0.5)
        .to(camera.position, { z: 19, y: 1.6, duration: 2.8, ease: "power2.inOut" }, 0.4)
        // IGNITION — on the chime hit
        .to(core.material, { opacity: 1, duration: 0.18, ease: "power4.in" }, 3.15)
        .to(core.scale, { x: 7, y: 7, duration: 0.5, ease: "expo.out" }, 3.2)
        .to(ring.material, { opacity: 0.9, duration: 0.05 }, 3.2)
        .to(ring.scale, { x: 34, y: 34, duration: 1.5, ease: "expo.out" }, 3.2)
        .to(ring.material, { opacity: 0, duration: 1.2, ease: "power2.out" }, 3.5)
        .to(flashEl, { opacity: 0.5, duration: 0.12, ease: "power4.in" }, 3.2)
        .to(flashEl, { opacity: 0, duration: 0.7 }, 3.34)
        // the bloom: core exhales the wave, camera lifts to take it in
        .to(S, { burst: 1, duration: 2.6, ease: "expo.out" }, 3.38)
        .to(core.scale, { x: 3.2, y: 3.2, duration: 2.2, ease: "power2.out" }, 3.7)
        .to(core.material, { opacity: 0.5, duration: 2.2 }, 3.7)
        .to(camera.position, { y: 7.5, z: 24, duration: 3.4, ease: "power2.inOut" }, 3.5)
        // the mark, with a PS3 gloss sweep
        .fromTo(markEl, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 1.1, ease: "power2.out" }, 3.9)
        .fromTo(markEl.querySelector(".boot-mark-name"), { backgroundPosition: "180% 0" }, { backgroundPosition: "-80% 0", duration: 1.7, ease: "power1.inOut" }, 4.1)
        .fromTo(markEl.querySelector(".boot-mark-sub"), { opacity: 0, letterSpacing: "0.2em" }, { opacity: 0.8, letterSpacing: "0.5em", duration: 1.4, ease: "power2.out" }, 4.4)
        // and through the white door into the XMB
        .to(flashEl, { opacity: 1, duration: 0.55, ease: "power2.in" }, 7.5)
        .to(root, { opacity: 0, duration: 0.01 });

      let done = false;
      function finish() {
        if (done) return;
        done = true;
        props.onDone();
      }
      const skip = (e: KeyboardEvent | MouseEvent) => {
        if (e instanceof KeyboardEvent && !["Enter", " ", "Escape"].includes(e.key)) return;
        tl.progress(1); // jumps to onComplete
      };
      addEventListener("keydown", skip);
      addEventListener("click", skip);

      teardown = () => {
        tl.kill();
        renderer.setAnimationLoop(null);
        removeEventListener("resize", onResize);
        removeEventListener("keydown", skip);
        removeEventListener("click", skip);
        geo?.dispose();
        cpuMat?.dispose();
        dotTex?.dispose();
        glowTex.dispose();
        renderer.dispose();
      };
      if (cancelled) teardown();
    }
  });

  return (
    <div class="boot" ref={root}>
      <canvas ref={canvas} class="boot-canvas" />
      <div class="boot-line" ref={lineEl}>
        COMPUTER ENTERTAINMENT SYSTEM
      </div>
      <div class="boot-mark" ref={markEl}>
        <div class="boot-mark-name">Abhishek Diwate</div>
        <div class="boot-mark-sub">SDE 3 · AI — PORTFOLIO SYSTEM SOFTWARE</div>
      </div>
      <div class="boot-flash" ref={flashEl} />
      <div class="boot-skip">press ENTER to skip</div>
    </div>
  );
}
