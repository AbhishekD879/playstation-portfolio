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
    const sparkleMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending });
    const sparkles = new THREE.Points(pgeo, sparkleMat);
    scene.add(sparkles);

    // —— live audio level from the console's master bus (0 when silent) ——
    let analyser: AnalyserNode | null = null;
    let freq: Uint8Array | null = null;
    try { analyser = getAnalyser(); freq = new Uint8Array(analyser.frequencyBinCount); } catch { /* no audio ctx yet */ }
    let audioLevel = 0;

    // —— apply the chosen mode + tint (re-runs live when either changes) ——
    let speedMul = 1;
    createEffect(() => {
      const m = MODE[bgMode() as keyof typeof MODE] ?? MODE.reactive;
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
    });

    let disposed = false;
    let last = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      requestAnimationFrame(render); // keep polling so a Labs toggle re-animates live
      // Labs "Living Background" off → fade the wave/sparkles out, leaving the
      // calm static gradient backdrop (the .wave-bg CSS) behind. Fluid mode
      // renders on its own WebGPU canvas — the three wave sleeps under it.
      const live = labEnabled("livingbg") && !(bgMode() === "fluid" && hasWebGPU());
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
      renderer.render(scene, camera);
    };
    requestAnimationFrame(render);

    const onResize = () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener("resize", onResize);
    onCleanup(() => {
      disposed = true;
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
