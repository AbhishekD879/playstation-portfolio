// Music Visualizer — a PS3 "Music Visualizations" homage. Taps the console's
// WebAudio master (the built-in radio, or the mic) through an AnalyserNode and
// drives a Three.js scene: a pulsing radial spectrum ring, a bass-reactive
// core, and drifting particles, all in the current XMB tint.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { audioContext, getAnalyser, radioPlaying, radioToggle } from "../audio";
import { tint } from "../theme";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

export default function Visualizer(props: { onClose: () => void }) {
  const [source, setSource] = createSignal<"console" | "mic">("console");
  const [playing, setPlaying] = createSignal(radioPlaying());
  const [micOn, setMicOn] = createSignal(false);
  let host!: HTMLDivElement;
  let micStream: MediaStream | null = null;
  let micAnalyser: AnalyserNode | null = null;

  const analyserFor = () => (source() === "mic" && micAnalyser ? micAnalyser : getAnalyser());

  async function toggleMic() {
    if (micOn()) {
      micStream?.getTracks().forEach((t) => t.stop());
      micStream = null; micAnalyser = null;
      setMicOn(false); setSource("console");
      return;
    }
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const c = audioContext();
      const src = c.createMediaStreamSource(micStream);
      micAnalyser = c.createAnalyser();
      micAnalyser.fftSize = 512;
      micAnalyser.smoothingTimeConstant = 0.8;
      src.connect(micAnalyser); // tap only — never routed to output (no feedback)
      setMicOn(true); setSource("mic");
    } catch { setMicOn(false); }
  }

  function toggleRadio() { setPlaying(radioToggle()); }

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 13);
    const accent = new THREE.Color(tint());

    // radial spectrum: one bar per frequency bin, arranged in a ring
    const BARS = 96;
    const bars = new THREE.Group();
    const barMat = new THREE.MeshBasicMaterial({ color: accent });
    const geo = new THREE.BoxGeometry(0.12, 1, 0.12);
    for (let i = 0; i < BARS; i++) {
      const m = new THREE.Mesh(geo, barMat.clone());
      const a = (i / BARS) * Math.PI * 2;
      m.position.set(Math.cos(a) * 4, 0, Math.sin(a) * 4);
      m.rotation.y = -a;
      bars.add(m);
    }
    scene.add(bars);

    // bass core — a glowing icosahedron that swells with the low end
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }),
    );
    scene.add(core);
    const coreGlow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5, 1),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending }),
    );
    scene.add(coreGlow);

    // particle halo
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 9, a = Math.random() * Math.PI * 2, y = (Math.random() - 0.5) * 12;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const dust = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: accent, size: 0.06, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    scene.add(dust);

    const freq = new Uint8Array(256);
    let disposed = false, t = 0;
    const render = () => {
      if (disposed) return;
      t += 0.016;
      const an = analyserFor();
      an.getByteFrequencyData(freq);
      let bass = 0;
      for (let i = 0; i < 12; i++) bass += freq[i];
      bass = bass / 12 / 255; // 0..1

      const kids = bars.children as THREE.Mesh[];
      for (let i = 0; i < BARS; i++) {
        const v = (freq[Math.floor((i / BARS) * 120) + 2] ?? 0) / 255;
        const h = 0.3 + v * 7;
        kids[i].scale.y = h;
        kids[i].position.y = 0; // grows both ways from centre
        (kids[i].material as THREE.MeshBasicMaterial).color.copy(accent).offsetHSL(0, 0, v * 0.4);
      }
      bars.rotation.y = t * 0.15;

      const s = 1 + bass * 1.1;
      core.scale.setScalar(s);
      coreGlow.scale.setScalar(s * 1.08 + Math.sin(t * 4) * 0.05);
      core.rotation.x = core.rotation.y += 0.004 + bass * 0.03;
      dust.rotation.y = -t * 0.04;
      (dust.material as THREE.PointsMaterial).opacity = 0.35 + bass * 0.5;
      camera.position.x = Math.sin(t * 0.1) * 2;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const size = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      removeEventListener("keydown", esc);
      micStream?.getTracks().forEach((tk) => tk.stop());
      setNavEnabled(true);
      renderer.dispose();
    });
  });

  return (
    <div class="viz pad-focus-scope">
      <div class="viz-bar">
        <div class="panel-tag">MUSIC VISUALIZER</div>
        <button class="ghost-btn" classList={{ on: playing() }} onClick={toggleRadio}>{playing() ? "⏸ radio" : "▶ radio"}</button>
        <button class="ghost-btn" classList={{ on: micOn() }} onClick={toggleMic}>🎤 mic</button>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <div class="viz-stage" ref={host} />
      <Show when={source() === "console" && !playing()}>
        <div class="viz-hint">▶ start the radio (or tap the mic) to feed the visualizer</div>
      </Show>
    </div>
  );
}
