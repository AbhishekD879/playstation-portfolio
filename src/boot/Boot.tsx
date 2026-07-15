// Console boot: black → "COMPUTER ENTERTAINMENT SYSTEM" → a drift through the
// career universe (one light tower per era, PS2-style) → wordmark → done.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import gsap from "gsap";
import { bootChime } from "../audio";
import { CAREER } from "../content";

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
    scene.fog = new THREE.FogExp2(0x03040a, 0.024);
    const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 2.2, 26);

    // light towers — height scales with era length, staggered along the flight path
    const eras = CAREER.length;
    const towers = new THREE.Group();
    for (let i = 0; i < eras; i++) {
      const h = 3 + (eras - i) * 2.1;
      const geo = new THREE.BoxGeometry(1.6, h, 1.6);
      const hue = 0.55 + i * 0.045;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.7, 0.72), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      const side = i % 2 ? 1 : -1;
      m.position.set(side * (2.6 + Math.sin(i * 2.7) * 1.4), h / 2 - 1.2, 12 - i * 7);
      towers.add(m);
      // mirrored reflection
      const r = m.clone();
      const rm = mat.clone();
      rm.opacity = 0.14;
      r.material = rm;
      r.scale.y = -1;
      r.position.y = -h / 2 - 1.25;
      towers.add(r);
      // halo slab at the tower crown
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.18, 2.1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
      );
      cap.position.set(m.position.x, h - 1.2 + 0.2, m.position.z);
      towers.add(cap);
    }
    scene.add(towers);

    // star dust drifting past
    const N = 700;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 22 - 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const dust = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: 0x9fc4ff, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    scene.add(dust);

    // dark reflective ground plane
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshBasicMaterial({ color: 0x04050c, transparent: true, opacity: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.24;
    scene.add(floor);

    let disposed = false;
    let elapsed = 0;
    let last = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      dust.rotation.y = elapsed * 0.015;
      towers.children.forEach((t, i) => {
        if ((t as THREE.Mesh).geometry.type === "BoxGeometry") t.rotation.y = elapsed * 0.12 + i;
      });
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

    // —— the sequence ——
    bootChime();
    const tl = gsap.timeline({ onComplete: finish });
    tl.fromTo(lineEl, { opacity: 0 }, { opacity: 1, duration: 1.1, delay: 0.6 })
      .to(lineEl, { opacity: 0, duration: 0.8, delay: 1.2 })
      .fromTo(canvas, { opacity: 0 }, { opacity: 1, duration: 1.4 }, "-=0.4")
      .to(camera.position, { z: -24, y: 4.4, duration: 7.2, ease: "power1.inOut" }, "<")
      .to(camera.rotation, { x: 0.1, duration: 7.2, ease: "power1.inOut" }, "<")
      .fromTo(markEl, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 1.3, ease: "power2.out" }, "-=2.6")
      .to(flashEl, { opacity: 1, duration: 0.5, ease: "power2.in" }, "+=1.0")
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
