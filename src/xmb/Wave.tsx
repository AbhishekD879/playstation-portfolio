// The XMB wave: a translucent ribbon flowing across a month-colored gradient,
// with slow rising sparkles. Faithful to the PS3 idle screen — now a "living
// background": its motion/glow follow the chosen Background mode (Settings ›
// Themes), and Reactive/Aurora pulse to whatever sound the console is playing
// (radio, Winamp, videos) via the shared master-bus analyser.
import { Show, createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { bgMode, tint } from "../theme";
import { getAnalyser } from "../audio";
import { labEnabled } from "../labs";
import { hasWebGPU } from "../gpu";
import { resting } from "../rest";
import { registerWaveCapture } from "../snapshot";
import FluidBg from "./FluidBg";

const WAVE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uAudio;
  uniform float uReact;
  varying float vGlow;
  void main() {
    vec3 p = position;
    float a = uAmp * (1.0 + uReact * uAudio * 1.6);
    float w1 = sin(p.x * 0.28 + uTime * 0.55) * 1.4;
    float w2 = sin(p.x * 0.11 - uTime * 0.32 + p.y * 0.3) * 2.2;
    float w3 = sin(p.x * 0.52 + uTime * 0.85) * 0.5;
    float env = 0.4 + 0.6 * smoothstep(-6.0, 6.0, p.y);
    p.z += (w1 + w2 + w3) * env * a;
    p.y += (w1 + w3) * 0.35 * a;
    vGlow = 0.5 + 0.5 * sin(p.x * 0.2 + uTime * 0.4);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const WAVE_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform float uGlow;
  uniform float uAudio;
  uniform float uReact;
  uniform vec3 uColor;
  varying float vGlow;
  void main() {
    float glow = 0.35 + vGlow * 0.65 * uGlow;
    float pulse = 1.0 + uReact * uAudio * 0.9;
    vec3 col = mix(vec3(1.0), uColor, 0.28);
    gl_FragColor = vec4(col, uOpacity * glow * pulse);
  }
`;

// per-mode feel: wave amplitude, glow, audio-reactivity, speed, sparkle look
const MODE = {
  calm: { amp: 0.75, glow: 0.55, react: 0.0, speed: 0.75, sparkSize: 0.12, sparkOp: 0.5 },
  waves: { amp: 1.05, glow: 0.8, react: 0.35, speed: 1.0, sparkSize: 0.14, sparkOp: 0.66 },
  reactive: { amp: 1.1, glow: 0.95, react: 1.0, speed: 1.05, sparkSize: 0.16, sparkOp: 0.82 },
  aurora: { amp: 1.32, glow: 1.18, react: 0.6, speed: 0.85, sparkSize: 0.19, sparkOp: 0.92 },
} as const;
const isWaveMode = (m: string): m is keyof typeof MODE => m in MODE;

// —— Horizon: a retro sunset grid scrolling toward the viewer ——
const GRID_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAudio;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // lines rush toward the camera; density compresses at the horizon (vUv.y→1)
    float depth = 1.0 - vUv.y;
    float rows = fract(pow(depth, 1.6) * 14.0 + uTime * 0.9);
    float cols = fract((vUv.x - 0.5) * 42.0 * (0.25 + depth));
    float line = smoothstep(0.075, 0.0, abs(rows - 0.5) * (0.4 + depth))
               + smoothstep(0.045, 0.0, abs(cols - 0.5) * (0.6 + depth * 2.0));
    float horizon = smoothstep(0.14, 0.02, depth) * 0.55;      // glow band near the far edge
    float glow = (line * (0.3 + depth * 0.55) + horizon) * (0.65 + uAudio * 1.0);
    glow *= smoothstep(0.0, 0.035, depth);                     // no hard line at the geometry edge
    vec3 col = mix(uColor, vec3(1.0), 0.22 + horizon * 0.4);
    gl_FragColor = vec4(col * glow, glow * 0.85);
  }
`;
const GRID_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export default function Wave() {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;

  onMount(() => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    camera.position.set(0, 0, 20);

    const mkWave = (opacity: number, y: number, speed: number) => {
      const geo = new THREE.PlaneGeometry(70, 16, 200, 20);
      const mat = new THREE.ShaderMaterial({
        vertexShader: WAVE_VERT,
        fragmentShader: WAVE_FRAG,
        uniforms: {
          uTime: { value: Math.random() * 50 }, uOpacity: { value: opacity },
          uAmp: { value: 1 }, uGlow: { value: 0.8 }, uAudio: { value: 0 },
          uReact: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -1.15;
      mesh.position.y = y;
      mesh.userData.baseSpeed = speed;
      scene.add(mesh);
      return mesh;
    };
    const waves = [mkWave(0.09, -3.5, 1), mkWave(0.05, -4.6, 0.62)];
    const mats = waves.map((w) => w.material as THREE.ShaderMaterial);

    // a soft round dot for every particle system (default point sprites are squares)
    const dotCanvas = document.createElement("canvas");
    dotCanvas.width = dotCanvas.height = 64;
    const dctx = dotCanvas.getContext("2d")!;
    const grad = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, 64, 64);
    const dotTex = new THREE.CanvasTexture(dotCanvas);

    // sparkles rising like the XMB dust
    const N = 110;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 2] = Math.random() * 6 - 3;
      vel[i] = 0.12 + Math.random() * 0.5;
    }
    const pgeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparkleMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, map: dotTex, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending });
    const sparkles = new THREE.Points(pgeo, sparkleMat);
    scene.add(sparkles);

    // —— Fireflies: dense tinted embers that wander and glow with the music ——
    const FN = 240;
    const fBase = new Float32Array(FN * 3), fPos = new Float32Array(FN * 3), fPhase = new Float32Array(FN), fVel = new Float32Array(FN);
    for (let i = 0; i < FN; i++) {
      fBase[i * 3] = (Math.random() - 0.5) * 46;
      fBase[i * 3 + 1] = (Math.random() - 0.5) * 26;
      fBase[i * 3 + 2] = Math.random() * 8 - 4;
      fPhase[i] = Math.random() * Math.PI * 2;
      fVel[i] = 0.25 + Math.random() * 0.8;
    }
    fPos.set(fBase);
    const fGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(fPos, 3));
    const flyMat = new THREE.PointsMaterial({ color: 0xffdd88, size: 0.3, map: dotTex, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const flies = new THREE.Points(fGeo, flyMat);
    flies.visible = false;
    scene.add(flies);

    // —— Starfield: deep space rushing past, faster when the music hits ——
    const SN = 900;
    const sPos = new Float32Array(SN * 3);
    const seedStar = (i: number, z?: number) => {
      sPos[i * 3] = (Math.random() - 0.5) * 60;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 34;
      sPos[i * 3 + 2] = z ?? Math.random() * 60 - 52;
    };
    for (let i = 0; i < SN; i++) seedStar(i);
    const sGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcfe2ff, size: 0.16, map: dotTex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const stars = new THREE.Points(sGeo, starMat);
    stars.visible = false;
    scene.add(stars);

    // —— Horizon grid ——
    const gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT, fragmentShader: GRID_FRAG,
      uniforms: { uTime: { value: 0 }, uAudio: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(150, 40), gridMat);
    grid.rotation.x = -1.25;
    grid.position.y = -10.5;
    grid.position.z = -6;
    grid.visible = false;
    scene.add(grid);

    // —— pointer parallax: the whole backdrop leans toward the cursor ——
    let parX = 0, parY = 0, parTX = 0, parTY = 0;
    const onPar = (e: PointerEvent) => {
      parTX = (e.clientX / innerWidth) * 2 - 1;
      parTY = (e.clientY / innerHeight) * 2 - 1;
    };
    addEventListener("pointermove", onPar);
    onCleanup(() => removeEventListener("pointermove", onPar));

    // —— live audio level from the console's master bus (0 when silent) ——
    let analyser: AnalyserNode | null = null;
    let freq: Uint8Array | null = null;
    try { analyser = getAnalyser(); freq = new Uint8Array(analyser.frequencyBinCount); } catch { /* no audio ctx yet */ }
    let audioLevel = 0;

    // —— apply the chosen mode + tint (re-runs live when either changes) ——
    let speedMul = 1;
    createEffect(() => {
      const mode = bgMode();
      const m = MODE[mode as keyof typeof MODE] ?? MODE.reactive;
      speedMul = m.speed;
      const col = new THREE.Color(tint());
      for (const mat of mats) {
        mat.uniforms.uAmp.value = m.amp;
        mat.uniforms.uGlow.value = m.glow;
        mat.uniforms.uReact.value = m.react;
        mat.uniforms.uColor.value = col;
      }
      sparkleMat.size = m.sparkSize;
      sparkleMat.opacity = m.sparkOp;
      sparkleMat.color = col.clone().lerp(new THREE.Color(0xffffff), 0.6);
      // one scene, many backdrops — flip what's on stage
      const wave = isWaveMode(mode);
      for (const w of waves) w.visible = wave;
      sparkles.visible = wave;
      flies.visible = mode === "fireflies";
      stars.visible = mode === "stars";
      grid.visible = mode === "grid";
      flyMat.color = col.clone().lerp(new THREE.Color(0xffe9a8), 0.55);
      starMat.color = col.clone().lerp(new THREE.Color(0xdce9ff), 0.75);
      gridMat.uniforms.uColor.value = col;
    });

    let disposed = false;
    let last = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      requestAnimationFrame(render); // keep polling so a Labs toggle re-animates live
      if (resting()) { last = now; return; } // Rest Mode — the scene sleeps, state intact
      // Labs "Living Background" off — or the "Flat 2D" mode — fades everything
      // out, leaving the original still gradient (the .wave-bg CSS). Fluid mode
      // renders on its own WebGPU canvas — the three scene sleeps under it.
      const live = labEnabled("livingbg") && bgMode() !== "flat" && !(bgMode() === "fluid" && hasWebGPU());
      const want = live ? "1" : "0";
      if (canvas.style.opacity !== want) { canvas.style.transition = "opacity 0.5s ease"; canvas.style.opacity = want; }
      if (!live) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (analyser && freq) {
        analyser.getByteFrequencyData(freq as any); // TS lib: ArrayBuffer vs SharedArrayBuffer
        let sum = 0; const lo = 2, hi = 26;
        for (let i = lo; i < hi; i++) sum += freq[i];
        const target = Math.min(1, sum / (hi - lo) / 165); // normalize bass energy
        audioLevel += (target - audioLevel) * 0.16; // smooth
      }
      // parallax — a beat behind the pointer, so it reads as depth not jitter
      if (labEnabled("parallaxbg")) {
        parX += (parTX - parX) * 0.04;
        parY += (parTY - parY) * 0.04;
        camera.position.x = parX * 1.1;
        camera.position.y = -parY * 0.7;
        camera.lookAt(0, 0, 0);
      } else if (camera.position.x !== 0 || camera.position.y !== 0) {
        camera.position.set(0, 0, 20);
        camera.lookAt(0, 0, 0);
      }
      const mode = bgMode();
      if (isWaveMode(mode)) {
        for (const w of waves) {
          const mat = w.material as THREE.ShaderMaterial;
          mat.uniforms.uTime.value += dt * (w.userData.baseSpeed as number) * speedMul;
          mat.uniforms.uAudio.value = audioLevel;
        }
        const p = pgeo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < N; i++) {
          let y = p.getY(i) + vel[i] * dt * (1 + audioLevel * 0.8);
          if (y > 13) y = -13;
          p.setY(i, y);
        }
        p.needsUpdate = true;
      } else if (mode === "fireflies") {
        // wander: slow rise + sinuous drift; the swarm brightens with the bass
        const t = now / 1000;
        for (let i = 0; i < FN; i++) {
          fBase[i * 3 + 1] += fVel[i] * dt * (0.5 + audioLevel);
          if (fBase[i * 3 + 1] > 14) fBase[i * 3 + 1] = -14;
          fPos[i * 3] = fBase[i * 3] + Math.sin(t * fVel[i] + fPhase[i]) * 1.6;
          fPos[i * 3 + 1] = fBase[i * 3 + 1] + Math.cos(t * 0.7 + fPhase[i]) * 0.5;
          fPos[i * 3 + 2] = fBase[i * 3 + 2];
        }
        (fGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        flyMat.opacity = 0.55 + audioLevel * 0.45 + Math.sin(now / 900) * 0.08;
        flyMat.size = 0.2 + audioLevel * 0.14;
      } else if (mode === "stars") {
        // fly through space; the music is the throttle
        for (let i = 0; i < SN; i++) {
          sPos[i * 3 + 2] += dt * (4 + audioLevel * 42);
          if (sPos[i * 3 + 2] > 12) seedStar(i, -52);
        }
        (sGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        starMat.size = 0.11 + audioLevel * 0.07;
      } else if (mode === "grid") {
        gridMat.uniforms.uTime.value += dt * (0.85 + audioLevel * 1.1);
        gridMat.uniforms.uAudio.value = audioLevel;
      }
      renderer.render(scene, camera);
    };
    requestAnimationFrame(render);

    const onResize = () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener("resize", onResize);

    // Photo Mode reads the scene back — render a fresh frame in the same task
    registerWaveCapture(() => {
      renderer.render(scene, camera);
      return canvas.toDataURL("image/png");
    });

    onCleanup(() => {
      disposed = true;
      registerWaveCapture(null);
      removeEventListener("resize", onResize);
      renderer.dispose();
    });
  });

  // the real XMB dims with the time of day — night is noticeably darker
  const h = new Date().getHours();
  const brightness = h < 6 || h >= 22 ? 0.72 : h < 9 ? 0.88 : h < 17 ? 1 : h < 20 ? 0.92 : 0.8;

  return (
    <div class="wave-bg" ref={wrap} style={{ "--xmb-tint": tint(), transition: "background 0.6s", filter: `brightness(${brightness})` }}>
      <canvas ref={canvas} />
      <Show when={bgMode() === "fluid" && hasWebGPU()}>
        <FluidBg />
      </Show>
    </div>
  );
}
