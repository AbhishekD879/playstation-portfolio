// Music Visualizer — a PS3 "Music Visualizations" homage, rebuilt. Taps the
// console's WebAudio master (radio/sfx) or the mic through an AnalyserNode and
// drives a bloom-lit Three.js scene in the current XMB tint:
//   · a noise-displaced REACTIVE ORB (custom GLSL — morphs to bass, spikes on
//     treble, punches on the beat, with a fresnel rim that blooms)
//   · an emissive SPECTRUM RING (one bar per FFT band, hot-colour by level)
//   · a REACTIVE PARTICLE NEBULA (pushed out by bass, sparkled by treble)
//   · UnrealBloom post-processing for real glow, beat detection for punch.
// Three switchable modes (←→ or the ◱ button): Nebula · Spectrum · Tunnel.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { audioContext, getAnalyser, radioPlaying, radioToggle } from "../audio";
import { tint } from "../theme";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

const MODES = ["Nebula", "Spectrum", "Tunnel"] as const;

// —— 3D simplex noise (Ashima / Stefan Gustavson) for the orb's vertex morph ——
const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+1.0*C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

export default function Visualizer(props: { onClose: () => void }) {
  const [source, setSource] = createSignal<"console" | "mic">("console");
  const [playing, setPlaying] = createSignal(radioPlaying());
  const [micOn, setMicOn] = createSignal(false);
  const [mode, setMode] = createSignal(0);
  let host!: HTMLDivElement;
  let micStream: MediaStream | null = null;
  let micAnalyser: AnalyserNode | null = null;
  let modeRef = 0; // read inside the rAF loop without re-subscribing

  const analyserFor = () => (source() === "mic" && micAnalyser ? micAnalyser : getAnalyser());
  const cycleMode = (d: number) => { const m = (mode() + d + MODES.length) % MODES.length; setMode(m); modeRef = m; sfx.tickH(); };

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
      micAnalyser.fftSize = 1024;
      micAnalyser.smoothingTimeConstant = 0.75;
      src.connect(micAnalyser); // tap only — never routed to output (no feedback)
      setMicOn(true); setSource("mic");
    } catch { setMicOn(false); }
  }

  function toggleRadio() { setPlaying(radioToggle()); }

  onMount(() => {
    setNavEnabled(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { sfx.back(); props.onClose(); }
      else if (e.key === "ArrowRight") cycleMode(1);
      else if (e.key === "ArrowLeft") cycleMode(-1);
    };
    addEventListener("keydown", onKey);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    camera.position.set(0, 0, 13);
    const accent = new THREE.Color(tint());

    // —— reactive orb — the centrepiece ——
    const orbUniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 },
      uTreble: { value: 0 }, uBeat: { value: 0 }, uColor: { value: accent.clone() },
    };
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.3, 24),
      new THREE.ShaderMaterial({
        uniforms: orbUniforms,
        vertexShader: SNOISE + `
          uniform float uTime,uBass,uMid,uTreble,uBeat; varying float vDisp; varying vec3 vN,vView;
          void main(){
            float n1=snoise(normal*1.1+uTime*0.22);
            float n2=snoise(normal*3.2-uTime*0.5);
            float amp=0.30+uBass*1.7+uBeat*0.9+uMid*0.4;
            float disp=n1*amp+n2*(0.12+uTreble*0.7);
            vDisp=disp;
            vec3 np=position+normal*disp;
            vN=normalize(normalMatrix*normal);
            vec4 mv=modelViewMatrix*vec4(np,1.0); vView=normalize(-mv.xyz);
            gl_Position=projectionMatrix*mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uTreble,uBeat; varying float vDisp; varying vec3 vN,vView;
          void main(){
            float fres=pow(1.0-max(dot(normalize(vN),normalize(vView)),0.0),2.2);
            vec3 hot=mix(uColor,vec3(1.0),clamp(vDisp*0.55+uTreble*0.45+uBeat*0.3,0.0,1.0));
            vec3 col=hot*(0.20+fres*1.05);
            gl_FragColor=vec4(col,1.0);
          }`,
      }),
    );
    scene.add(orb);
    const orbWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.34, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.06 }),
    );
    scene.add(orbWire);

    // —— spectrum ring — one emissive bar per band ——
    const BARS = 128;
    const ringGeo = new THREE.PlaneGeometry(0.14, 1);
    const ringMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.InstancedMesh(ringGeo, ringMat, BARS);
    const ringColors = new Float32Array(BARS * 3);
    ring.instanceColor = new THREE.InstancedBufferAttribute(ringColors, 3);
    scene.add(ring);
    const dummy = new THREE.Object3D();
    const cHot = new THREE.Color();

    // —— particle nebula ——
    const N = 2600;
    const pPos = new Float32Array(N * 3);
    const pRand = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = 5 + Math.random() * 11, a = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = Math.sin(ph) * Math.cos(a) * r;
      pPos[i * 3 + 1] = Math.cos(ph) * r * 0.6;
      pPos[i * 3 + 2] = Math.sin(ph) * Math.sin(a) * r;
      pRand[i] = Math.random();
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("aRand", new THREE.BufferAttribute(pRand, 1));
    const pUniforms = { uBass: { value: 0 }, uTreble: { value: 0 }, uColor: { value: accent.clone() }, uSize: { value: 1 }, uZ: { value: 0 } };
    const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({
      uniforms: pUniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `
        uniform float uBass,uTreble,uSize,uZ; attribute float aRand; varying float vB;
        void main(){
          vec3 p=position*(1.0+uBass*0.5*aRand);
          p.z=mod(p.z+uZ*(0.6+aRand),22.0)-11.0; // tunnel drift when uZ animates
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          vB=uTreble;
          gl_PointSize=clamp(uSize*(0.6+aRand)*(95.0/max(-mv.z,0.1)),0.0,13.0)*(1.0+uTreble*0.7);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vB;
        void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d)*0.55; gl_FragColor=vec4(uColor*(0.4+vB*0.6),a); }`,
    }));
    scene.add(dust);

    // —— bloom pipeline ——
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 0.6);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // —— audio bands with envelope followers + beat detection ——
    let freq = new Uint8Array(analyserFor().frequencyBinCount);
    let bassE = 0, midE = 0, trebE = 0, beat = 0;
    const bassHist: number[] = [];
    const follow = (env: number, raw: number) => env + (raw - env) * (raw > env ? 0.5 : 0.08);
    const band = (f: Uint8Array, lo: number, hi: number) => {
      let s = 0; for (let i = lo; i < hi; i++) s += f[i]; return s / (hi - lo) / 255;
    };

    let disposed = false, t = 0;
    const render = () => {
      if (disposed) return;
      requestAnimationFrame(render);
      t += 0.016;
      const an = analyserFor();
      if (freq.length !== an.frequencyBinCount) freq = new Uint8Array(an.frequencyBinCount); // mic/console fftSize differ
      an.getByteFrequencyData(freq);
      const bins = an.frequencyBinCount;
      const bass = band(freq, 1, Math.max(4, bins >> 5));
      const mid = band(freq, bins >> 5, bins >> 3);
      const treble = band(freq, bins >> 3, bins >> 1);
      bassE = follow(bassE, bass); midE = follow(midE, mid); trebE = follow(trebE, treble);

      // beat: bass energy spikes over a rolling average
      bassHist.push(bass); if (bassHist.length > 43) bassHist.shift();
      const avg = bassHist.reduce((a, b) => a + b, 0) / bassHist.length;
      if (bass > avg * 1.4 && bass > 0.22 && beat < 0.2) beat = 1;
      beat *= 0.9;

      const m = modeRef;
      orbUniforms.uTime.value = t;
      orbUniforms.uBass.value = bassE; orbUniforms.uMid.value = midE;
      orbUniforms.uTreble.value = trebE; orbUniforms.uBeat.value = beat;
      const orbScale = (m === 1 ? 0.7 : m === 2 ? 0.45 : 1) * (1 + beat * 0.12);
      orb.scale.setScalar(orbScale); orbWire.scale.setScalar(orbScale);
      orb.rotation.y = orbWire.rotation.y = t * 0.1;
      orb.rotation.x = orbWire.rotation.x = Math.sin(t * 0.13) * 0.3;

      // ring — height per band, hot colour by level; prominent in Spectrum mode
      const radius = 4.2;
      const heightK = m === 1 ? 9 : 5;
      for (let i = 0; i < BARS; i++) {
        const v = (freq[Math.floor((i / BARS) * (bins * 0.7)) + 2] ?? 0) / 255;
        const a = (i / BARS) * Math.PI * 2;
        const h = 0.2 + v * heightK;
        dummy.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        dummy.rotation.set(0, -a + Math.PI / 2, 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        ring.setMatrixAt(i, dummy.matrix);
        cHot.copy(accent).offsetHSL((v - 0.5) * 0.12, 0, v * 0.5 + 0.05);
        cHot.toArray(ringColors, i * 3);
      }
      ring.instanceMatrix.needsUpdate = true;
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
      ring.rotation.y = t * (m === 1 ? 0.12 : 0.05);
      ring.scale.setScalar(m === 2 ? 0.6 : 1);

      // particles
      pUniforms.uBass.value = bassE; pUniforms.uTreble.value = trebE;
      pUniforms.uSize.value = m === 0 ? 1.1 : m === 2 ? 1.4 : 0.7;
      pUniforms.uZ.value = m === 2 ? t * 6 : 0; // stream toward camera in Tunnel
      dust.rotation.y = m === 2 ? 0 : -t * 0.03;

      bloom.strength = 0.32 + bassE * 0.45 + beat * 0.5;

      // camera per mode
      if (m === 2) { camera.position.set(Math.sin(t * 0.3) * 1.2, Math.cos(t * 0.24) * 1.0, 9); }
      else { camera.position.set(Math.sin(t * 0.12) * 3, Math.sin(t * 0.08) * 1.5, m === 1 ? 11 : 13); }
      camera.lookAt(0, 0, 0);

      composer.render();
    };
    requestAnimationFrame(render);

    const size = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h); composer.setSize(w, h);
      bloom.setSize(w, h);
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(host);

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      removeEventListener("keydown", onKey);
      micStream?.getTracks().forEach((tk) => tk.stop());
      setNavEnabled(true);
      composer.dispose();
      renderer.dispose();
    });
  });

  return (
    <div class="viz pad-focus-scope">
      <div class="viz-bar">
        <div class="panel-tag">MUSIC VISUALIZER</div>
        <button class="ghost-btn" onClick={() => cycleMode(1)}>◱ {MODES[mode()]}</button>
        <button class="ghost-btn" classList={{ on: playing() }} onClick={toggleRadio}>{playing() ? "⏸ radio" : "▶ radio"}</button>
        <button class="ghost-btn" classList={{ on: micOn() }} onClick={toggleMic}>🎤 mic</button>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <div class="viz-stage" ref={host} />
      <div class="viz-modes">
        <For each={MODES}>{(name, i) => <span classList={{ on: mode() === i() }}>{name}</span>}</For>
      </div>
      <Show when={source() === "console" && !playing()}>
        <div class="viz-hint">▶ start the radio (or tap the mic) to feed the visualizer · ←→ switch mode</div>
      </Show>
    </div>
  );
}
