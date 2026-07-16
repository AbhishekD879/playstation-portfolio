// Console boot — the void wakes up. A galaxy of light swirls in the dark,
// gathers into a core, ignites on the chime's arrival hit, and blooms into a
// rippling wave (the same wave the XMB lives on, in this month's colour).
// PS2 soul, PS3 polish. Skippable with Enter / click.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import gsap from "gsap";
import { bootChime } from "../audio";
import { tint } from "../theme";

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
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
    camera.position.set(0, 2.4, 30);

    const accent = new THREE.Color(tint());

    // —— the galaxy: per-particle orbits, driven by tweened state ——
    const N = 6000;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const R0 = new Float32Array(N); // home orbit radius
    const A0 = new Float32Array(N); // start angle
    const SP = new Float32Array(N); // angular speed
    const Y0 = new Float32Array(N); // vertical scatter
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // soft round sprite — without a map, points draw as hard squares
    const dotTex = glowTexture("rgba(255,255,255,0.5)");
    const mat = new THREE.PointsMaterial({
      map: dotTex, size: 0.26, vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const stars = new THREE.Points(geo, mat);
    scene.add(stars);

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

    let disposed = false;
    let elapsed = 0;
    let last = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;

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
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      // heartbeat on the core so it never reads as a static PNG
      const pulse = 1 + Math.sin(elapsed * 6) * 0.045;
      core.scale.x *= pulse / (core.userData.lastPulse ?? 1);
      core.scale.y = core.scale.x;
      core.userData.lastPulse = pulse;

      camera.lookAt(0, 0.4, 0);
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const onResize = () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener("resize", onResize);

    // —— the sequence (chime's arrival hit lands ~3.1s in — ignition syncs to it) ——
    bootChime();
    const tl = gsap.timeline({ onComplete: finish });
    tl
      // the void breathes in: galaxy fades up already swirling
      .fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "power1.out" }, 0.15)
      .to(mat, { opacity: 0.85, duration: 1.4 }, 0.15)
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

    onCleanup(() => {
      disposed = true;
      tl.kill();
      removeEventListener("resize", onResize);
      removeEventListener("keydown", skip);
      removeEventListener("click", skip);
      geo.dispose();
      mat.dispose();
      dotTex.dispose();
      glowTex.dispose();
      renderer.dispose();
    });
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
