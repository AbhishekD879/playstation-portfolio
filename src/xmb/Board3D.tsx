// 3D chessboard — render layer only. ChessApp owns the rules/engine; this
// draws the position (lathe-turned pieces, walnut board, soft shadows) and
// reports square pointer-downs/ups back, so click, drag and pad nav all work
// exactly like the old 2D grid.
import { createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import gsap from "gsap";
import { tint } from "../theme";

type Cell = { type: string; color: "w" | "b" } | null;

// —— lathe profiles: [radius, height] pairs, unit = square width ——
const PROFILES: Record<string, [number, number][]> = {
  p: [[0, 0], [0.30, 0], [0.30, 0.05], [0.14, 0.12], [0.11, 0.30], [0.17, 0.34], [0.10, 0.38], [0.15, 0.46], [0.13, 0.54], [0, 0.60]],
  r: [[0, 0], [0.32, 0], [0.32, 0.06], [0.18, 0.14], [0.16, 0.46], [0.24, 0.50], [0.24, 0.62], [0.18, 0.62], [0.18, 0.56], [0, 0.56]],
  n: [[0, 0], [0.32, 0], [0.32, 0.06], [0.17, 0.14], [0.13, 0.32], [0.20, 0.38], [0, 0.40]],
  b: [[0, 0], [0.31, 0], [0.31, 0.06], [0.15, 0.14], [0.10, 0.44], [0.17, 0.50], [0.12, 0.58], [0.06, 0.68], [0.09, 0.72], [0, 0.78]],
  q: [[0, 0], [0.34, 0], [0.34, 0.06], [0.17, 0.15], [0.11, 0.52], [0.20, 0.62], [0.15, 0.68], [0.20, 0.74], [0.08, 0.80], [0.11, 0.86], [0, 0.92]],
  k: [[0, 0], [0.34, 0], [0.34, 0.06], [0.18, 0.15], [0.12, 0.55], [0.22, 0.66], [0.16, 0.72], [0.19, 0.78], [0.08, 0.84], [0, 0.86]],
};

export default function Board3D(props: {
  board: Cell[][];
  cursor: number;
  picked: number | null;
  hints: Set<number>;
  onDown: (i: number) => void;
  onUp: (i: number) => void;
}) {
  let wrap!: HTMLDivElement;

  onMount(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 9.5, 9.8);
    camera.lookAt(0, 0, 0.4);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(5, 11, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -6;
    sun.shadow.camera.right = sun.shadow.camera.top = 6;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.35);
    fill.position.set(-6, 4, -5);
    scene.add(fill);

    // —— board: 64 squares + frame ——
    const lightSq = new THREE.MeshStandardMaterial({ color: 0xcbb489, roughness: 0.55 });
    const darkSq = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.55 });
    const sqGeo = new THREE.BoxGeometry(1, 0.16, 1);
    const squares: THREE.Mesh[] = [];
    for (let i = 0; i < 64; i++) {
      const f = i % 8, r = Math.floor(i / 8);
      const m = new THREE.Mesh(sqGeo, (f + r) % 2 ? darkSq : lightSq);
      m.position.set(f - 3.5, -0.08, r - 3.5);
      m.receiveShadow = true;
      m.userData.sq = i;
      scene.add(m);
      squares.push(m);
    }
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(9.0, 0.34, 9.0),
      new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.4 }),
    );
    frame.position.y = -0.19;
    frame.receiveShadow = true;
    scene.add(frame);

    // —— pieces (geometries cached per type, materials shared per side) ——
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.35, metalness: 0.05 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x35302c, roughness: 0.35, metalness: 0.15 });
    const geoCache: Record<string, THREE.LatheGeometry> = {};
    const latheFor = (t: string) => (geoCache[t] ??= new THREE.LatheGeometry(
      PROFILES[t].map(([x, y]) => new THREE.Vector2(x * 0.92, y * 1.15)), 48));
    const knightHead = new THREE.ConeGeometry(0.16, 0.42, 24);
    const crossV = new THREE.BoxGeometry(0.05, 0.2, 0.05);
    const crossH = new THREE.BoxGeometry(0.14, 0.05, 0.05);

    const pieces = new THREE.Group();
    scene.add(pieces);
    const makePiece = (t: string, color: "w" | "b", f: number, r: number) => {
      const mat = color === "w" ? whiteMat : blackMat;
      const g = new THREE.Group();
      const body = new THREE.Mesh(latheFor(t), mat);
      body.castShadow = true;
      g.add(body);
      if (t === "n") { // the horse: angled cone head atop the lathe stem
        const head = new THREE.Mesh(knightHead, mat);
        head.castShadow = true;
        head.position.set(0, 0.54, color === "w" ? -0.06 : 0.06);
        head.rotation.x = color === "w" ? -1.05 : 1.05; // lean toward the enemy
        g.add(head);
      }
      if (t === "k") {
        const v = new THREE.Mesh(crossV, mat); v.position.y = 1.08; v.castShadow = true;
        const h = new THREE.Mesh(crossH, mat); h.position.y = 1.10; h.castShadow = true;
        g.add(v, h);
      }
      g.position.set(f - 3.5, 0, r - 3.5);
      return g;
    };

    createEffect(() => {
      const b = props.board;
      pieces.clear();
      b.forEach((row, r) => row.forEach((p, f) => { if (p) pieces.add(makePiece(p.type, p.color, f, r)); }));
    });

    // —— highlights: cursor ring, picked glow, hint dots ——
    const accent = new THREE.Color(tint());
    const posOf = (i: number, y: number, v: THREE.Object3D) => v.position.set((i % 8) - 3.5, y, Math.floor(i / 8) - 3.5);
    const cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 4), // square-ish diamond ring
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    cursorRing.rotation.x = -Math.PI / 2;
    cursorRing.rotation.z = Math.PI / 4;
    cursorRing.scale.setScalar(1.35);
    scene.add(cursorRing);
    const pickedGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4 }),
    );
    pickedGlow.rotation.x = -Math.PI / 2;
    scene.add(pickedGlow);
    const dotGeo = new THREE.CircleGeometry(0.13, 24);
    const dotMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 });
    const hintDots = new THREE.Group();
    scene.add(hintDots);

    createEffect(() => posOf(props.cursor, 0.02, cursorRing));
    createEffect(() => {
      pickedGlow.visible = props.picked !== null;
      if (props.picked !== null) posOf(props.picked, 0.015, pickedGlow);
    });
    createEffect(() => {
      hintDots.clear();
      props.hints.forEach((i) => {
        const d = new THREE.Mesh(dotGeo, dotMat);
        d.rotation.x = -Math.PI / 2;
        posOf(i, 0.02, d);
        hintDots.add(d);
      });
    });

    // —— pointer → square, mirroring the 2D grid's down/up contract ——
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const squareAt = (e: PointerEvent): number | null => {
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(squares, false)[0];
      return hit ? (hit.object.userData.sq as number) : null;
    };
    const down = (e: PointerEvent) => { const i = squareAt(e); if (i !== null) props.onDown(i); };
    const up = (e: PointerEvent) => { const i = squareAt(e); if (i !== null) props.onUp(i); };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);

    // gentle intro sweep, then an idle breath so it never sits frozen
    gsap.from(camera.position, { y: 14, z: 14, duration: 1.4, ease: "power3.out" });
    let disposed = false;
    let t0 = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      const t = (now - t0) / 1000;
      camera.position.x = Math.sin(t * 0.12) * 0.55;
      camera.lookAt(0, 0, 0.4);
      cursorRing.rotation.z = Math.PI / 4 + t * 0.6;
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const size = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      Object.values(geoCache).forEach((g) => g.dispose());
      [sqGeo, knightHead, crossV, crossH, dotGeo].forEach((g) => g.dispose());
      renderer.dispose();
    });
  });

  return <div class="chess-board3d" ref={wrap} />;
}
