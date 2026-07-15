// The XMB wave: a translucent ribbon flowing across a month-colored gradient,
// with slow rising sparkles. Faithful to the PS3 idle screen.
import { onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { tint } from "../theme";

const WAVE_VERT = /* glsl */ `
  uniform float uTime;
  varying float vGlow;
  void main() {
    vec3 p = position;
    float w1 = sin(p.x * 0.28 + uTime * 0.55) * 1.4;
    float w2 = sin(p.x * 0.11 - uTime * 0.32 + p.y * 0.3) * 2.2;
    float w3 = sin(p.x * 0.52 + uTime * 0.85) * 0.5;
    p.z += (w1 + w2 + w3) * (0.4 + 0.6 * smoothstep(-6.0, 6.0, p.y));
    p.y += (w1 + w3) * 0.35;
    vGlow = 0.5 + 0.5 * sin(p.x * 0.2 + uTime * 0.4);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const WAVE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity * (0.35 + vGlow * 0.65));
  }
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
        uniforms: { uTime: { value: Math.random() * 50 }, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        wireframe: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -1.15;
      mesh.position.y = y;
      mesh.userData.speed = speed;
      scene.add(mesh);
      return mesh;
    };
    const waves = [mkWave(0.09, -3.5, 1), mkWave(0.05, -4.6, 0.62)];

    // sparkles rising like the XMB dust
    const N = 90;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 2] = Math.random() * 6 - 3;
      vel[i] = 0.12 + Math.random() * 0.5;
    }
    const pgeo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparkles = new THREE.Points(
      pgeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scene.add(sparkles);

    let disposed = false;
    let last = performance.now();
    let t = 0;
    const render = (now: number) => {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      for (const w of waves) (w.material as THREE.ShaderMaterial).uniforms.uTime.value += dt * w.userData.speed;
      const p = pgeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        let y = p.getY(i) + vel[i] * dt;
        if (y > 13) y = -13;
        p.setY(i, y);
      }
      p.needsUpdate = true;
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
    </div>
  );
}
