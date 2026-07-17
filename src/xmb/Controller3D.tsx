// A real 3D controller you can watch react live. Loads a proper GLB (DualSense
// or Xbox), lights it (studio env map), and reacts to the live pad. The analog
// STICKS are rigged to their real mesh and physically tilt with your sticks;
// buttons (fused into the shell on these scanned models, so not individually
// depressible) light a calibrated glow hotspot pinned to each control. Audio +
// rumble on every press edge.
import { createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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
    { id: "triangle", p: [0.69, 0.66, 0.6] }, { id: "circle", p: [1.04, 0.47, 0.6] },
    { id: "cross", p: [0.82, 0.28, 0.6] }, { id: "square", p: [0.55, 0.47, 0.6] },
    { id: "up", p: [-0.29, 0.02, 0.6] }, { id: "down", p: [-0.29, -0.25, 0.6] },
    { id: "left", p: [-0.42, -0.11, 0.6] }, { id: "right", p: [-0.16, -0.11, 0.6] },
    { id: "share", p: [-0.22, 0.53, 0.6] }, { id: "options", p: [0.16, 0.53, 0.6] },
    { id: "ps", p: [0, 0.83, 0.62] },
    { id: "l1", p: [-1.0, 0.9, 0.3] }, { id: "r1", p: [0.95, 0.9, 0.3] },
    { id: "l2", p: [-1.0, 1.05, 0.0], kind: "trig" }, { id: "r2", p: [0.95, 1.05, 0.0], kind: "trig" },
    { id: "l3", p: [-0.88, 0.55, 0.6], kind: "stickL" }, { id: "r3", p: [0.33, 0.1, 0.6], kind: "stickR" },
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const scene = new THREE.Scene();
    // a soft studio environment so PBR materials read as real plastic/metal
    // instead of dead grey (metallic surfaces need something to reflect)
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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

    // Two feedback modes, chosen per control at load time:
    //  · REAL geometry — if the model separates that control into its own mesh,
    //    we glow the ACTUAL part (and, for sticks, physically tilt it with the
    //    analog). No floating dot.
    //  · glow HOTSPOT — a fallback for controls fused into the shell (bumpers/
    //    triggers on most models; every button on the material-fused DualSense).
    const hot = new Map<string, THREE.Mesh>();
    const hotBase = new Map<string, THREE.Vector3>();
    type Part = { mesh: THREE.Mesh; rest: THREE.Quaternion; mats: any[]; kind?: Spot["kind"] };
    const parts = new Map<string, Part>();
    const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0);
    const sizeFor = (s: Spot) =>
      s.kind === "stickL" || s.kind === "stickR" ? 0.16
        : s.kind === "trig" ? 0.11
        : s.id === "l1" || s.id === "r1" ? 0.12
        : /^(up|down|left|right)$/.test(s.id) ? 0.07
        : /^(share|options|ps)$/.test(s.id) ? 0.07
        : 0.095; // face buttons
    const makeHotspot = (s: Spot) => {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint()), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(sizeFor(s), 16, 16), mat);
      m.position.set(...s.p); m.renderOrder = 999;
      pivot.add(m); hot.set(s.id, m); hotBase.set(s.id, m.position.clone());
    };

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
        model.traverse((n: any) => {
          if (!n.isMesh || !n.material) return;
          const fix = (m: any) => {
            if (o.mirror) m.side = THREE.DoubleSide; // negative scale flips winding
            if (m.isMeshStandardMaterial) {
              m.envMapIntensity = 1.1;
              if (!m.map) { // untextured PBR (e.g. the Xbox GLB) → read as moulded plastic, not dead metal
                m.metalness = Math.min(m.metalness ?? 1, 0.2);
                m.roughness = Math.min(Math.max(m.roughness ?? 1, 0.45), 0.7);
                if (m.color && Math.min(m.color.r, m.color.g, m.color.b) > 0.85) m.color.setHex(0xe2e4ea);
              }
            }
          };
          Array.isArray(n.material) ? n.material.forEach(fix) : fix(n.material);
        });
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        model.position.sub(box.getCenter(new THREE.Vector3()));
        pivot.add(model);

        // —— assign each control to its own mesh (real animation) or a hotspot ——
        model.updateMatrixWorld(true);
        const infos: { mesh: THREE.Mesh; c: THREE.Vector3; size: number }[] = [];
        model.traverse((n: any) => {
          if (!n.isMesh) return;
          const bb = new THREE.Box3().setFromObject(n);
          infos.push({ mesh: n, c: pivot.worldToLocal(bb.getCenter(new THREE.Vector3())), size: bb.getSize(new THREE.Vector3()).length() });
        });
        const cloned = new Map<THREE.Mesh, any[]>();
        const cloneMats = (mesh: THREE.Mesh) => {
          const hit = cloned.get(mesh); if (hit) return hit;
          const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const arr = src.map((m: any) => { const c = m.clone(); if (!c.emissive) c.emissive = new THREE.Color(0); return c; });
          (mesh as any).material = Array.isArray(mesh.material) ? arr : arr[0];
          cloned.set(mesh, arr); return arr;
        };
        // Only rig the parts that map cleanly to their own mesh: the two analog
        // STICKS (tilted with the analog) and the FACE BUTTONS (glow on press).
        // Everything else (d-pad disc, guide, menu, bumpers, triggers) is fused
        // or ambiguous, so it keeps a calibrated hotspot. Match in the SCREEN
        // (XY) plane — LAYOUT z is a hotspot front-offset, not the mesh depth.
        // Rig the two analog STICKS to their real mesh (physical tilt with the
        // analog). Every button keeps a calibrated hotspot — clear, reliable,
        // and unaffected by this model's occluded/fused button geometry.
        const used = new Set<THREE.Mesh>();
        for (const s of LAYOUT[props.model]) {
          const isStick = s.kind === "stickL" || s.kind === "stickR";
          if (!isStick) { makeHotspot(s); continue; }
          const near = infos
            .filter((mi) => mi.size < 0.95 && !used.has(mi.mesh))
            .map((mi) => ({ mi, d: Math.hypot(mi.c.x - s.p[0], mi.c.y - s.p[1]) }))
            .sort((a, b) => a.d - b.d)[0];
          if (near && near.d < 0.4) {
            used.add(near.mi.mesh);
            parts.set(s.id, { mesh: near.mi.mesh, rest: near.mi.mesh.quaternion.clone(), mats: cloneMats(near.mi.mesh), kind: s.kind });
          } else {
            makeHotspot(s); // no separable stick mesh (e.g. fused DualSense) → hotspot
          }
        }
        if (import.meta.env.DEV) {
          const sz = box.getSize(new THREE.Vector3());
          (window as any).__ctlbox = { model: props.model, x: +sz.x.toFixed(2), y: +sz.y.toFixed(2), z: +sz.z.toFixed(2) };
          const meshes: any[] = [];
          model.updateMatrixWorld(true);
          model.traverse((n: any) => {
            if (!n.isMesh) return;
            const b = new THREE.Box3().setFromObject(n);
            const c = pivot.worldToLocal(b.getCenter(new THREE.Vector3()));
            const s = b.getSize(new THREE.Vector3());
            meshes.push({ name: n.name, c: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], size: +s.length().toFixed(2) });
          });
          (window as any).__meshes = meshes;
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
      const tintNow = tint();
      const stickAxes = (kind: Spot["kind"]) => (kind === "stickL" ? [ax(0), ax(1)] : [ax(2), ax(3)]);
      // how "lit" a control is (0..1), and note press edges for feedback
      const litOf = (s: Spot): number => {
        if (s.kind === "stickL" || s.kind === "stickR") {
          const [axx, axy] = stickAxes(s.kind);
          const click = s.kind === "stickL" ? 10 : 11;
          if (b(click)?.pressed) pressedNow.add(s.id);
          return Math.max(Math.min(1, Math.hypot(axx, axy)) * 0.85, b(click)?.pressed ? 1 : 0);
        }
        if (s.kind === "trig") { const i = s.id === "l2" ? 6 : 7; if (b(i)?.pressed) pressedNow.add(s.id); return b(i)?.value ?? 0; }
        const idx = Object.entries(BTN_CTRL).find(([, v]) => v === s.id)?.[0];
        const pressed = idx != null && !!b(+idx)?.pressed;
        if (pressed) pressedNow.add(s.id);
        return pressed ? 1 : 0;
      };
      for (const s of LAYOUT[props.model]) {
        const lit = litOf(s);
        if (lit > 0.5 && !activeLabel) activeLabel = LABELS[props.model][s.id] ?? s.id;
        const part = parts.get(s.id);
        if (part) {
          // REAL geometry: glow the actual mesh; physically tilt the actual stick
          for (const m of part.mats) { m.emissive.set(tintNow); m.emissiveIntensity = lit * 2.2; }
          if (s.kind === "stickL" || s.kind === "stickR") {
            const [axx, axy] = stickAxes(s.kind);
            part.mesh.quaternion.copy(part.rest);
            part.mesh.rotateOnWorldAxis(AXIS_Y, -axx * 0.7);
            part.mesh.rotateOnWorldAxis(AXIS_X, axy * 0.7);
          }
        } else {
          const m = hot.get(s.id); if (!m) continue; // fallback hotspot
          if (s.kind === "stickL" || s.kind === "stickR") { const [axx, axy] = stickAxes(s.kind); const base = hotBase.get(s.id)!; m.position.set(base.x + axx * 0.16, base.y - axy * 0.16, base.z); }
          (m.material as THREE.MeshBasicMaterial).opacity = (CAL ? 0.4 : 0.16) + lit * 0.75;
          m.scale.setScalar(1 + lit * 0.9);
        }
      }

      // press-edge feedback: tick + rumble + a rim-light flash
      for (const id of pressedNow) if (!prev.has(id)) { sfx.tickH(); rumble(0.4, 0.3, 70); flash = 1; }
      prev.clear(); pressedNow.forEach((id) => prev.add(id));
      flash = Math.max(0, flash - dt * 3.5);
      rim.intensity = flash * 2.6;
      rim.color.set(tintNow);

      // gentle idle sway only — the sticks/buttons now react on the real model
      swayT += dt;
      if (CAL) pivot.rotation.set(0, 0, 0);
      else { pivot.rotation.y = Math.sin(swayT * 0.3) * 0.13; pivot.rotation.x = -0.05; }

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
