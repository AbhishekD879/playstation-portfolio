// A real 3D controller you can watch react live. Loads a proper GLB (DualSense
// or Xbox), lights it, and — because the meshes are fused by material and can't
// be depressed individually — anchors glowing hotspots over each control that
// light up as you press. Sticks push, triggers swell by analog value. Audio +
// rumble on every press edge. The hotspots are parented to the model, so they
// stay pinned to their buttons as it turns.
import { createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { tint } from "../theme";
import * as sfx from "../audio";
import { rumble } from "../input";

export type PadModel = "dualsense" | "xbox";

// standard-mapping button index → canonical control id
const BTN_CTRL: Record<number, string> = {
  0: "cross", 1: "circle", 2: "square", 3: "triangle",
  4: "l1", 5: "r1", 6: "l2", 7: "r2", 8: "share", 9: "options",
  10: "l3", 11: "r3", 12: "up", 13: "down", 14: "left", 15: "right", 16: "ps",
};
// human labels per model (shown in the live readout)
const LABELS: Record<PadModel, Record<string, string>> = {
  dualsense: {
    cross: "Cross", circle: "Circle", square: "Square", triangle: "Triangle",
    l1: "L1", r1: "R1", l2: "L2", r2: "R2", share: "Create", options: "Options",
    l3: "L3", r3: "R3", up: "D-Pad ↑", down: "D-Pad ↓", left: "D-Pad ←", right: "D-Pad →", ps: "PS",
  },
  xbox: {
    cross: "A", circle: "B", square: "X", triangle: "Y",
    l1: "LB", r1: "RB", l2: "LT", r2: "RT", share: "View", options: "Menu",
    l3: "LS", r3: "RS", up: "D-Pad ↑", down: "D-Pad ↓", left: "D-Pad ←", right: "D-Pad →", ps: "Guide",
  },
};

type Spot = { id: string; p: [number, number, number]; kind?: "stickL" | "stickR" | "trig" };
// positions in normalized model space (model centered at origin, longest side
// ≈ 3 units, front toward +Z, up +Y). Calibrated per model.
const LAYOUT: Record<PadModel, Spot[]> = {
  dualsense: [
    { id: "triangle", p: [0.95, -0.26, 0.48] }, { id: "circle", p: [1.15, -0.42, 0.48] },
    { id: "cross", p: [0.95, -0.58, 0.48] }, { id: "square", p: [0.75, -0.42, 0.48] },
    { id: "up", p: [-0.95, -0.26, 0.48] }, { id: "down", p: [-0.95, -0.58, 0.48] },
    { id: "left", p: [-1.15, -0.42, 0.48] }, { id: "right", p: [-0.75, -0.42, 0.48] },
    { id: "share", p: [-0.5, 0.28, 0.48] }, { id: "options", p: [0.5, 0.28, 0.48] },
    { id: "ps", p: [0, -0.62, 0.42] },
    { id: "l1", p: [-0.95, 0.55, 0.15] }, { id: "r1", p: [0.95, 0.55, 0.15] },
    { id: "l2", p: [-0.95, 0.72, -0.15], kind: "trig" }, { id: "r2", p: [0.95, 0.72, -0.15], kind: "trig" },
    { id: "l3", p: [-0.42, 0.08, 0.42], kind: "stickL" }, { id: "r3", p: [0.42, 0.08, 0.42], kind: "stickR" },
  ],
  xbox: [
    { id: "triangle", p: [0.6, 0.5, 0.7] }, { id: "circle", p: [0.76, 0.33, 0.7] },
    { id: "cross", p: [0.6, 0.16, 0.7] }, { id: "square", p: [0.44, 0.33, 0.7] },
    { id: "up", p: [-0.29, 0.02, 0.7] }, { id: "down", p: [-0.29, -0.32, 0.7] },
    { id: "left", p: [-0.44, -0.15, 0.7] }, { id: "right", p: [-0.14, -0.15, 0.7] },
    { id: "share", p: [-0.13, 0.5, 0.7] }, { id: "options", p: [0.16, 0.5, 0.7] },
    { id: "ps", p: [0, 0.72, 0.72] },
    { id: "l1", p: [-0.7, 0.85, 0.35] }, { id: "r1", p: [0.7, 0.85, 0.35] },
    { id: "l2", p: [-0.7, 1.0, 0.0], kind: "trig" }, { id: "r2", p: [0.7, 1.0, 0.0], kind: "trig" },
    { id: "l3", p: [-0.66, 0.51, 0.7], kind: "stickL" }, { id: "r3", p: [0.36, 0.0, 0.7], kind: "stickR" },
  ],
};
// per-model orientation + framing tweaks (tuned so the front faces the camera)
const ORIENT: Record<PadModel, { rx: number; ry: number; rz: number; scale: number; mirror?: boolean }> = {
  dualsense: { rx: Math.PI / 2, ry: 0, rz: 0, scale: 1.9, mirror: true },
  xbox: { rx: 0, ry: 0, rz: 0, scale: 1.9 },
};
const CAL = false; // calibration: freeze the pivot flat + show idle hotspots brighter

export default function Controller3D(props: { model: PadModel; onActive?: (label: string | null) => void }) {
  let canvas!: HTMLCanvasElement;
  let host!: HTMLDivElement;
  const [status, setStatus] = createSignal("Loading model…");

  onMount(() => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.2, 6);
    camera.lookAt(0, 0, 0);

    const size = () => {
      const r = host.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };

    // lighting: soft key + fill + a tint rim that pulses on press
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6); fill.position.set(-5, 1, 3); scene.add(fill);
    const rim = new THREE.PointLight(new THREE.Color(tint()), 0, 18); rim.position.set(0, 1, -4); scene.add(rim);

    const pivot = new THREE.Group();
    scene.add(pivot);

    // hotspots — small additive spheres parented to the pivot at each control
    const hot = new Map<string, THREE.Mesh>();
    const hotBase = new Map<string, THREE.Vector3>();
    const spotGeo = new THREE.SphereGeometry(0.11, 20, 20);
    for (const s of LAYOUT[props.model]) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint()), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(spotGeo, mat);
      m.position.set(...s.p);
      m.userData.spot = s;
      pivot.add(m);
      hot.set(s.id, m);
      hotBase.set(s.id, m.position.clone());
    }

    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(
      `/models/${props.model}.glb`,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const o = ORIENT[props.model];
        // orient → scale → recenter (recenter AFTER scaling, or the offset is wrong)
        model.rotation.set(o.rx, o.ry, o.rz);
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const s = o.scale / (sphere.radius || 1);
        model.scale.set(o.mirror ? -s : s, s, s); // some GLBs are mirrored — flip X back
        if (o.mirror) model.traverse((n: any) => { if (n.isMesh && n.material) { const set = (m: any) => (m.side = THREE.DoubleSide); Array.isArray(n.material) ? n.material.forEach(set) : set(n.material); } });
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        pivot.add(model);
        if (import.meta.env.DEV) {
          const sz = box.getSize(new THREE.Vector3());
          (window as any).__ctlbox = { model: props.model, x: +sz.x.toFixed(2), y: +sz.y.toFixed(2), z: +sz.z.toFixed(2) };
        }
        setStatus("");
      },
      undefined,
      () => { if (!disposed) setStatus("Couldn't load the 3D model."); },
    );

    // —— live pad → hotspots ——
    const prev = new Set<string>();
    let flash = 0;
    let swayT = 0;
    const tintCol = new THREE.Color(tint());
    const readPad = (): Gamepad | null => {
      const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected !== false);
      const std = pads.filter((p) => p.mapping === "standard");
      return std[std.length - 1] ?? pads.sort((a, b) => b.buttons.length - a.buttons.length)[0] ?? null;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const pad = readPad();
      const b = (i: number) => pad?.buttons[i];
      const ax = (i: number) => pad?.axes[i] ?? 0;

      let activeLabel: string | null = null;
      const pressedNow = new Set<string>();
      for (const s of LAYOUT[props.model]) {
        const m = hot.get(s.id)!;
        const base = hotBase.get(s.id)!;
        let lit = 0;
        if (s.kind === "stickL" || s.kind === "stickR") {
          const [axx, axy] = s.kind === "stickL" ? [ax(0), ax(1)] : [ax(2), ax(3)];
          m.position.set(base.x + axx * 0.16, base.y - axy * 0.16, base.z);
          const clickIdx = s.kind === "stickL" ? 10 : 11;
          const mag = Math.min(1, Math.hypot(axx, axy));
          lit = Math.max(mag * 0.8, b(clickIdx)?.pressed ? 1 : 0);
          if (b(clickIdx)?.pressed) pressedNow.add(s.id);
        } else if (s.kind === "trig") {
          const idx = s.id === "l2" ? 6 : 7;
          lit = b(idx)?.value ?? 0;
          if (b(idx)?.pressed) pressedNow.add(s.id);
        } else {
          const idx = Object.entries(BTN_CTRL).find(([, v]) => v === s.id)?.[0];
          const pressed = idx != null && b(+idx)?.pressed;
          lit = pressed ? 1 : 0;
          if (pressed) pressedNow.add(s.id);
        }
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = (CAL ? 0.4 : 0.16) + lit * 0.75;
        m.scale.setScalar(1 + lit * 0.9);
        if (lit > 0.5 && !activeLabel) activeLabel = LABELS[props.model][s.id] ?? s.id;
      }

      // press-edge feedback: tick + rumble + a rim-light flash
      for (const id of pressedNow) if (!prev.has(id)) { sfx.tickH(); rumble(0.4, 0.3, 70); flash = 1; }
      prev.clear(); pressedNow.forEach((id) => prev.add(id));
      flash = Math.max(0, flash - dt * 3.5);
      rim.intensity = flash * 2.6;
      rim.color.set(tint());

      // gentle sway + tilt by the left stick, so the model reacts to the stick too
      swayT += dt;
      if (CAL) { pivot.rotation.set(0, 0, 0); }
      else {
        pivot.rotation.y = Math.sin(swayT * 0.3) * 0.14 + ax(0) * 0.4;
        pivot.rotation.x = -0.05 + ax(1) * 0.22;
      }

      props.onActive?.(activeLabel);
      renderer.render(scene, camera);
    };

    const ro = new ResizeObserver(size);
    ro.observe(host);
    size();
    raf = requestAnimationFrame(loop);

    onCleanup(() => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
    });
  });

  return (
    <div class="ctl3d" ref={host}>
      <canvas ref={canvas} />
      {status() && <div class="ctl3d-status">{status()}</div>}
    </div>
  );
}
