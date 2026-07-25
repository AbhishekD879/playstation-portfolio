// 3D boards for the four grid games — Connect Four, Gomoku, Reversi, Checkers —
// on the same wooden table as Ludo and chess. Render layer ONLY: BoardGames owns
// the rules and networking, this draws whatever state arrives and reports the
// same action objects a 2D click would produce.
//
// One component instead of four because they share almost everything: the table
// rig, the renderer/camera/fit/dispose boilerplate, raycasting to cells, and
// "pieces chase their target each frame" (which gives Connect Four its drop,
// Reversi its flip and Checkers its slide for free). Only the board carcass and
// the click contract differ per game.
import { createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { addTabletop, addTableLights, fitDistance, makeControls, onBoardTap } from "./tabletop";
import {
  type AnyState, type Side, type CkPiece,
  C4_COLS, C4_ROWS, GO_SIZE, rvLegal, ckMoves,
} from "../board/rules";

type Kind = "c4" | "gomoku" | "reversi" | "checkers";

export default function Grid3D(props: {
  st: AnyState; seat: number; myTurn: boolean; colors: string[]; onAct: (a: any) => void;
}) {
  let wrap!: HTMLDivElement;

  onMount(() => {
    const kind = props.st.k as Kind;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    const controls = makeControls(camera, renderer.domElement, { min: 6, max: 70 });
    const junk: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => (junk.push(x), x);

    // board footprint in world units, and how upright the camera sits
    const N = kind === "gomoku" ? GO_SIZE : 8;               // flat games are N×N
    const flat = kind !== "c4";
    const span = flat ? N + 3.4 : C4_COLS + 4.5;
    const EL = flat ? 0.86 : 0.62;                            // Connect Four is played nearly face-on
    const AIM = flat ? 0.4 : 0;
    addTableLights(scene, coarse, Math.max(8, span * 0.55));
    junk.push(...addTabletop(scene, renderer, {
      mat: span + 1.6,
      y: flat ? -0.5 : -3.6,
      envIntensity: 0.5,
    }));

    const c0 = new THREE.Color(props.colors[0] ?? "#ff5c6c");
    const c1 = new THREE.Color(props.colors[1] ?? "#eef3fb");
    const pieceMat = [
      keep(new THREE.MeshStandardMaterial({ color: c0, roughness: 0.26, metalness: 0.12 })),
      keep(new THREE.MeshStandardMaterial({ color: c1, roughness: 0.26, metalness: 0.12 })),
    ];
    // flat-board cell → world; centred on the origin so the camera fit is symmetric
    const cx = (c: number) => c - (N - 1) / 2;
    const cz = (r: number) => r - (N - 1) / 2;

    const root = new THREE.Group();
    scene.add(root);
    const picks: THREE.Object3D[] = [];   // raycast targets, userData carries the cell

    // ═══ board carcass ═══
    if (flat) {
      const frame = new THREE.Mesh(
        keep(new RoundedBoxGeometry(N + 1.5, 0.7, N + 1.5, 4, 0.3)),
        keep(new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.42, metalness: 0.25 })),
      );
      frame.position.y = -0.42; frame.receiveShadow = true; root.add(frame);

      if (kind === "reversi" || kind === "checkers") {
        // Reversi is one green felt field; checkers is a chequered surface
        const sqGeo = keep(new THREE.BoxGeometry(1, 0.16, 1));
        const light = keep(new THREE.MeshStandardMaterial({ color: kind === "checkers" ? 0xd9c9a4 : 0x1c6b45, roughness: 0.62 }));
        const dark = keep(new THREE.MeshStandardMaterial({ color: kind === "checkers" ? 0x4a3626 : 0x18603d, roughness: 0.62 }));
        for (let i = 0; i < 64; i++) {
          const r = (i / 8) | 0, c = i % 8;
          const m = new THREE.Mesh(sqGeo, (r + c) % 2 ? dark : light);
          m.position.set(cx(c), -0.04, cz(r));
          m.receiveShadow = true;
          m.userData = { r, c };
          root.add(m); picks.push(m);
        }
      } else {
        // Gomoku: one wooden field with engraved grid lines, stones on intersections
        const field = new THREE.Mesh(
          keep(new RoundedBoxGeometry(N + 0.4, 0.2, N + 0.4, 3, 0.12)),
          keep(new THREE.MeshStandardMaterial({ color: 0xd8b476, roughness: 0.55 })),
        );
        field.position.y = -0.02; field.receiveShadow = true; root.add(field);
        const lineMat = keep(new THREE.LineBasicMaterial({ color: 0x6b4f2a, transparent: true, opacity: 0.55 }));
        for (let i = 0; i < N; i++) {
          for (const axis of [0, 1]) {
            const g = keep(new THREE.BufferGeometry().setFromPoints(axis
              ? [new THREE.Vector3(cx(0), 0.09, cz(i)), new THREE.Vector3(cx(N - 1), 0.09, cz(i))]
              : [new THREE.Vector3(cx(i), 0.09, cz(0)), new THREE.Vector3(cx(i), 0.09, cz(N - 1))]));
            root.add(new THREE.Line(g, lineMat));
          }
        }
        // invisible pads make every intersection clickable
        const padGeo = keep(new THREE.BoxGeometry(0.92, 0.05, 0.92));
        const padMat = keep(new THREE.MeshBasicMaterial({ visible: false }));
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
          const m = new THREE.Mesh(padGeo, padMat);
          m.position.set(cx(c), 0.1, cz(r));
          m.userData = { r, c };
          root.add(m); picks.push(m);
        }
      }
    } else {
      // ═══ Connect Four: an upright slotted rack ═══
      const rackMat = keep(new THREE.MeshStandardMaterial({ color: 0x143a86, roughness: 0.34, metalness: 0.22 }));
      // the panel the discs sit inside
      const panel = new THREE.Mesh(
        keep(new RoundedBoxGeometry(C4_COLS + 0.8, C4_ROWS + 1.0, 0.42, 3, 0.18)),
        rackMat,
      );
      panel.position.set(0, (C4_ROWS - 1) / 2, 0);
      panel.castShadow = true; panel.receiveShadow = true; root.add(panel);
      // a recessed ring per cell reads as the 42 holes
      const holeGeo = keep(new THREE.TorusGeometry(0.42, 0.07, 10, 26));
      const holeMat = keep(new THREE.MeshStandardMaterial({ color: 0x0d2154, roughness: 0.5, metalness: 0.3 }));
      for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
        const ring = new THREE.Mesh(holeGeo, holeMat);
        ring.position.set(c - (C4_COLS - 1) / 2, C4_ROWS - 1 - r, 0.23);
        root.add(ring);
      }
      const legGeo = keep(new THREE.BoxGeometry(0.4, 1.2, 1.9));
      for (const x of [-C4_COLS / 2 + 0.2, C4_COLS / 2 - 0.2]) {
        const m = new THREE.Mesh(legGeo, rackMat);
        m.position.set(x, -1.35, 0); m.castShadow = true; root.add(m);
      }
      // one tall invisible pad per column — you drop by picking a column, not a cell
      const colPad = keep(new THREE.BoxGeometry(0.94, C4_ROWS + 1.2, 1.2));
      const padMat = keep(new THREE.MeshBasicMaterial({ visible: false }));
      for (let c = 0; c < C4_COLS; c++) {
        const m = new THREE.Mesh(colPad, padMat);
        m.position.set(c - (C4_COLS - 1) / 2, (C4_ROWS - 1) / 2, 0);
        m.userData = { col: c };
        root.add(m); picks.push(m);
      }
    }

    // ═══ pieces ═══
    // A pool keyed by cell index: each entry chases a target transform every
    // frame, which is what makes discs fall, flip and slide without any
    // per-move animation bookkeeping.
    interface Pc { mesh: THREE.Mesh; targetY: number; targetX: number; targetZ: number; flip: number }
    const pool = new Map<number, Pc>();
    const discGeo = keep(new THREE.CylinderGeometry(0.4, 0.4, 0.16, 30));
    const stoneGeo = keep(new THREE.SphereGeometry(0.36, 26, 18));
    const crownGeo = keep(new THREE.TorusGeometry(0.2, 0.045, 10, 22));
    const hintGeo = keep(new THREE.CircleGeometry(0.17, 22));
    const hintMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    const hints = new THREE.Group(); root.add(hints);
    const sel = new THREE.Mesh(
      keep(new THREE.TorusGeometry(0.46, 0.05, 10, 26)),
      keep(new THREE.MeshBasicMaterial({ color: 0xffe08a })),
    );
    sel.rotation.x = -Math.PI / 2; sel.visible = false; root.add(sel);

    const makePiece = (side: Side, king: boolean) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(kind === "gomoku" ? stoneGeo : discGeo, pieceMat[side]);
      body.castShadow = true;
      g.add(body);
      if (king) {                                            // checkers crown
        const cr = new THREE.Mesh(crownGeo, pieceMat[side]);
        cr.rotation.x = -Math.PI / 2; cr.position.y = 0.12; cr.castShadow = true;
        g.add(cr);
      }
      return g as unknown as THREE.Mesh;
    };

    // checkers click-path state (mirrors the 2D board's machine)
    let path: number[] = [];

    const sync = () => {
      const st = props.st as any;
      const want = new Map<number, { side: Side; king: boolean }>();
      if (kind === "checkers") {
        (st.board as (CkPiece | null)[]).forEach((p, i) => { if (p) want.set(i, { side: p.s, king: p.k }); });
      } else if (kind === "c4") {
        (st.board as (Side | null)[]).forEach((v, i) => { if (v !== null) want.set(i, { side: v, king: false }); });
      } else {
        (st.board as (Side | null)[]).forEach((v, i) => { if (v !== null) want.set(i, { side: v, king: false }); });
      }
      // drop pieces that no longer exist (captures)
      for (const [i, pc] of [...pool]) {
        const w = want.get(i);
        if (!w) { root.remove(pc.mesh); pool.delete(i); continue; }
      }
      for (const [i, w] of want) {
        const cols = kind === "c4" ? C4_COLS : N;
        const r = (i / cols) | 0, c = i % cols;
        const existing = pool.get(i);
        // a cell whose owner changed (Reversi flip) or that gained a crown is rebuilt
        if (existing && (existing.mesh.userData.side !== w.side || existing.mesh.userData.king !== w.king)) {
          root.remove(existing.mesh); pool.delete(i);
        }
        let pc = pool.get(i);
        if (!pc) {
          const mesh = makePiece(w.side, w.king);
          mesh.userData = { side: w.side, king: w.king };
          if (kind === "c4") {
            mesh.rotation.x = Math.PI / 2;                    // discs stand up in the rack
            mesh.position.set(c - (C4_COLS - 1) / 2, C4_ROWS + 1.4, 0.16); // spawn above → falls
          } else {
            mesh.position.set(cx(c), kind === "reversi" ? 2.2 : 1.4, cz(r)); // drops onto the board
            if (kind === "reversi") mesh.rotation.z = Math.PI; // land face-down then flip up
          }
          root.add(mesh);
          pc = { mesh, targetX: 0, targetY: 0, targetZ: 0, flip: 0 };
          pool.set(i, pc);
        }
        if (kind === "c4") {
          pc.targetX = c - (C4_COLS - 1) / 2;
          pc.targetY = C4_ROWS - 1 - r; pc.targetZ = 0.16;
        } else {
          pc.targetX = cx(c); pc.targetZ = cz(r);
          pc.targetY = kind === "gomoku" ? 0.22 : 0.14;
        }
        pc.flip = 0;
      }
      // legal-move dots
      hints.clear();
      const st2 = props.st as any;
      if (props.myTurn && !st2.over) {
        const cells: number[] = kind === "reversi" ? rvLegal(st2.board, props.seat as Side)
          : kind === "checkers" ? [...new Set(ckMoves(st2.board, props.seat as Side).map((m: number[]) => (path.length ? -1 : m[0])))].filter((x) => x >= 0)
          : [];
        for (const i of cells) {
          const d = new THREE.Mesh(hintGeo, hintMat);
          d.rotation.x = -Math.PI / 2;
          d.position.set(cx(i % 8), 0.1, cz((i / 8) | 0));
          hints.add(d);
        }
        // checkers: once a piece is picked, show where it can continue
        if (kind === "checkers" && path.length) {
          for (const m of ckMoves(st2.board, props.seat as Side)) {
            if (m.length > path.length && path.every((x, k) => x === m[k])) {
              const t = m[path.length];
              const d = new THREE.Mesh(hintGeo, hintMat);
              d.rotation.x = -Math.PI / 2;
              d.position.set(cx(t % 8), 0.1, cz((t / 8) | 0));
              hints.add(d);
            }
          }
        }
      }
      sel.visible = kind === "checkers" && path.length > 0;
      if (sel.visible) sel.position.set(cx(path[0] % 8), 0.12, cz((path[0] / 8) | 0));
    };
    createEffect(sync);

    // ═══ picking ═══
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onPointer = (e: PointerEvent) => {
      if (!props.myTurn || (props.st as any).over) return;
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(picks, false)[0];
      if (!hit) return;
      const d = hit.object.userData as any;
      if (kind === "c4") { props.onAct({ col: d.col }); return; }
      if (kind === "gomoku" || kind === "reversi") { props.onAct({ r: d.r, c: d.c }); return; }
      // checkers: build the jump path click by click, exactly like the 2D board
      const i = d.r * 8 + d.c;
      const moves = ckMoves((props.st as any).board, props.seat as Side);
      if (!path.length) {
        if (moves.some((m: number[]) => m[0] === i)) { path = [i]; sync(); }
        return;
      }
      const next = moves.filter((m: number[]) => m.length > path.length && path.every((x, k) => x === m[k])).map((m: number[]) => m[path.length]);
      if (!next.includes(i)) { path = moves.some((m: number[]) => m[0] === i) ? [i] : []; sync(); return; }
      const np = [...path, i];
      const full = moves.some((m: number[]) => m.length === np.length && m.every((x, k) => x === np[k]));
      const more = moves.some((m: number[]) => m.length > np.length && np.every((x, k) => x === m[k]));
      if (full && !more) { props.onAct({ path: np }); path = []; } else path = np;
      sync();
    };
    const offTap = onBoardTap(renderer.domElement, onPointer);

    // ═══ loop ═══
    let disposed = false;
    let camDist = 20;
    let placed = false;
    const place = () => {                       // initial framing; the user owns it after
      camDist = fitDistance(camera, span + 2.4); // + the mat around it
      const midY = flat ? 0 : (C4_ROWS - 1) / 2;
      camera.position.set(0, Math.sin(EL) * camDist + (flat ? 0 : 1.6), Math.cos(EL) * camDist + AIM);
      controls.target.set(0, midY, AIM);
      controls.update();
    };
    const goal = new THREE.Vector3();
    const t0 = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      const ts = (now - t0) / 1000;
      for (const pc of pool.values()) {
        goal.set(pc.targetX, pc.targetY, pc.targetZ);
        pc.mesh.position.lerp(goal, kind === "c4" ? 0.26 : 0.22);   // the drop / slide
        if (kind === "reversi" && pc.mesh.rotation.z !== 0) {        // the flip
          pc.mesh.rotation.z = Math.abs(pc.mesh.rotation.z) < 0.02 ? 0 : pc.mesh.rotation.z * 0.82;
        }
        if (kind === "c4") pc.mesh.rotation.x = Math.PI / 2;
      }
      sel.rotation.z = ts * 2;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const size = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
      if (!placed) { place(); placed = true; }
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);

    onCleanup(() => {
      disposed = true;
      ro.disconnect();
      offTap(); controls.dispose();
      for (const d of junk) d.dispose();
      renderer.dispose();
    });
  });

  return <div class="bg-grid3d" ref={wrap} />;
}
