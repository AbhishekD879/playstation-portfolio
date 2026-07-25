// 3D Ludo — render layer only. BoardGames owns the rules/state/networking
// (src/board/rules.ts, host-authoritative over WebRTC); this draws the same
// Ludo state as a proper 3D board and reports token clicks back. Design notes:
//  • the whole board is ROTATED so YOUR home yard is always nearest the camera
//    (every player sees their own colour at the bottom, like a real table)
//  • classic Ludo furniture: rounded tiles, four centre triangles, base slots,
//    safe-cell studs, lathe-turned pawns
//  • tokens lerp to their cell each frame and ARC as they travel, so moves read
//    as motion without any per-move animation bookkeeping
//  • legal moves glow AND their destination cell is previewed
import { createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { correctToFace, throwDie, type DieThrow } from "../dice";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { addTabletop, addTableLights, fitDistance, makeControls, onBoardTap } from "./tabletop";
import {
  type Ludo, ludoCell, LUDO_PATH, LUDO_HOME, LUDO_BASE, LUDO_COLORS, LUDO_SAFE_IDX, LUDO_GOAL,
} from "../board/rules";

// grid cell [row,col] (0..14) → board-local world (x,z); board centred on origin
const wx = (col: number) => col - 7;
const wz = (row: number) => row - 7;

// which side each quadrant's home column runs in from (drives the centre triangles)
const QUAD_SIDE: ("left" | "far" | "right" | "near")[] = ["left", "far", "right", "near"];
// world position index of each quadrant: 0=far-left 1=far-right 2=near-right 3=near-left
const QUAD_CENTER: [number, number][] = [[2.5, 2.5], [2.5, 11.5], [11.5, 11.5], [11.5, 2.5]];

export default function Ludo3D(props: { st: Ludo; seat: number; myTurn: boolean; onAct: (a: any) => void; colors?: string[] }) {
  let wrap!: HTMLDivElement;

  onMount(() => {
    const coarse = matchMedia("(pointer: coarse)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    // drag to look around the table, wheel/pinch to lean in
    const controls = makeControls(camera, renderer.domElement, { min: 9, max: 60 });
    // The board must never clip, at any canvas aspect — so the camera distance is
    // DERIVED from the board size + aspect on every resize (see fit()), rather
    // than hardcoded. Direction is fixed: a ~48° elevation for a tabletop feel.
    const BOARD = 21;                 // board + the mat and die beside it, kept in frame
    const EL = 0.84;                  // elevation in radians
    const AIM = 0.9;                  // look slightly near-of-centre so perspective
                                      // doesn't park the board low in the frame
    let camDist = 26;
    const place = () => {
      camDist = fitDistance(camera, BOARD);
      camera.position.set(0, Math.sin(EL) * camDist, Math.cos(EL) * camDist + AIM);
      controls.target.set(0, 0, AIM);
      controls.update();
    };

    addTableLights(scene, coarse, 12);

    const junk: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => (junk.push(x), x);

    junk.push(...addTabletop(scene, renderer, { mat: 20.5, y: -1.05 }));

    // ★ everything lives under `root`, spun so the local player's yard is NEAR.
    // quad positions run clockwise 0→1→2→3; each -90° turn shifts index by +1,
    // so k turns put my quad at index 3 (near-left) — the classic "you at the
    // bottom" view every player gets of their own colour.
    const root = new THREE.Group();
    scene.add(root);
    const myQuad = props.st.quads[props.seat] ?? 0;
    const quarterTurns = (3 - myQuad + 4) % 4; // land my quad on index 3 = near-left
    root.rotation.y = -quarterTurns * (Math.PI / 2);

    // —— board: dark rounded slab + metallic rim ——
    const frame = new THREE.Mesh(
      keep(new RoundedBoxGeometry(16.8, 0.9, 16.8, 4, 0.35)),
      keep(new THREE.MeshStandardMaterial({ color: 0x070c15, roughness: 0.35, metalness: 0.45 })),
    );
    frame.position.y = -0.62; frame.receiveShadow = true; root.add(frame);
    const slab = new THREE.Mesh(
      keep(new RoundedBoxGeometry(15.6, 0.55, 15.6, 3, 0.18)),
      keep(new THREE.MeshStandardMaterial({ color: 0x121c30, roughness: 0.75 })),
    );
    slab.position.y = -0.2; slab.receiveShadow = true; root.add(slab);

    const colors = (props.colors ?? LUDO_COLORS).map((c) => new THREE.Color(c));

    // —— home yards + their four base slots ——
    const yardGeo = keep(new RoundedBoxGeometry(6.1, 0.22, 6.1, 3, 0.22));
    const slotGeo = keep(new THREE.TorusGeometry(0.36, 0.055, 10, 26));
    const slotMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true, opacity: 0.55 }));
    const yardMats: THREE.MeshStandardMaterial[] = [];
    QUAD_CENTER.forEach(([r, c], q) => {
      const mat = keep(new THREE.MeshStandardMaterial({ color: colors[q], roughness: 0.45, emissive: colors[q], emissiveIntensity: 0 }));
      yardMats.push(mat);
      const m = new THREE.Mesh(yardGeo, mat);
      m.position.set(wx(c), 0.03, wz(r));
      m.receiveShadow = true;
      root.add(m);
      // the four parking rings inside the yard, at the exact base coords
      for (const [br, bc] of LUDO_BASE[q]) {
        const ring = new THREE.Mesh(slotGeo, slotMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx(bc), 0.16, wz(br));
        root.add(ring);
      }
    });

    // —— track tiles (rounded), coloured at each quadrant's entry ——
    const tileGeo = keep(new RoundedBoxGeometry(0.94, 0.22, 0.94, 2, 0.1));
    const tileLight = keep(new THREE.MeshStandardMaterial({ color: 0xeef4ff, roughness: 0.55 }));
    const tileSafe = keep(new THREE.MeshStandardMaterial({ color: 0xc3d3ea, roughness: 0.5 }));
    const tileQuad = colors.map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.42 })));
    const studGeo = keep(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 18));
    const studMat = keep(new THREE.MeshStandardMaterial({ color: 0x64789a, roughness: 0.4 }));
    const entryOf = (i: number) => (i === 0 ? 0 : i === 13 ? 1 : i === 26 ? 2 : i === 39 ? 3 : -1);
    LUDO_PATH.forEach(([r, c], i) => {
      const owner = entryOf(i);
      const safe = LUDO_SAFE_IDX.has(i);
      const m = new THREE.Mesh(tileGeo, owner >= 0 ? tileQuad[owner] : safe ? tileSafe : tileLight);
      m.position.set(wx(c), 0.14, wz(r));
      m.receiveShadow = true;
      root.add(m);
      if (safe && owner < 0) { // a little stud marks the neutral safe squares
        const s = new THREE.Mesh(studGeo, studMat);
        s.position.set(wx(c), 0.27, wz(r));
        root.add(s);
      }
    });
    // home columns, brightening toward the goal
    LUDO_HOME.forEach((col, q) => col.forEach(([r, c], j) => {
      const mat = keep(new THREE.MeshStandardMaterial({
        color: colors[q], roughness: 0.4,
        emissive: colors[q], emissiveIntensity: 0.08 + j * 0.05,
      }));
      const m = new THREE.Mesh(tileGeo, mat);
      m.position.set(wx(c), 0.14, wz(r));
      m.receiveShadow = true;
      root.add(m);
    }));

    // —— centre: four triangles pointing in + a faceted crown ——
    const H = 1.5;
    const triFor = (side: string): number[] =>
      side === "left" ? [-H, -H, -H, H, 0, 0]
      : side === "far" ? [-H, -H, H, -H, 0, 0]
      : side === "right" ? [H, -H, H, H, 0, 0]
      : [-H, H, H, H, 0, 0]; // near
    QUAD_SIDE.forEach((side, q) => {
      const p = triFor(side);
      const g = keep(new THREE.BufferGeometry());
      g.setAttribute("position", new THREE.Float32BufferAttribute([p[0], 0, p[1], p[2], 0, p[3], p[4], 0, p[5]], 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, keep(new THREE.MeshStandardMaterial({
        color: colors[q], roughness: 0.4, side: THREE.DoubleSide,
        emissive: colors[q], emissiveIntensity: 0.18,
      })));
      m.position.y = 0.27;
      root.add(m);
    });
    const crown = new THREE.Mesh(
      keep(new THREE.ConeGeometry(0.62, 0.95, 4)),
      keep(new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.25, metalness: 0.35 })),
    );
    crown.position.set(0, 0.75, 0);
    crown.rotation.y = Math.PI / 4;
    crown.castShadow = true;
    root.add(crown);

    // —— pawns: lathe-turned, per-seat colour, glow when playable ——
    const np = props.st.np;
    const pawnGeo = keep(new THREE.LatheGeometry(
      [[0, 0], [0.34, 0], [0.34, 0.05], [0.19, 0.13], [0.14, 0.34], [0.24, 0.4], [0.12, 0.47], [0.19, 0.58], [0.13, 0.68], [0, 0.78]]
        .map(([r, h]) => new THREE.Vector2(r, h)), 40));
    const ringGeo = keep(new THREE.TorusGeometry(0.46, 0.075, 12, 34));
    const hitGeo = keep(new THREE.CylinderGeometry(0.52, 0.52, 1.3, 10));
    const invisible = keep(new THREE.MeshBasicMaterial({ visible: false }));
    const discGeo = keep(new THREE.CircleGeometry(0.4, 26));
    const tokens: { grp: THREE.Group; ring: THREE.Mesh; mat: THREE.MeshStandardMaterial }[][] = [];
    for (let s = 0; s < np; s++) {
      const quad = props.st.quads[s];
      tokens[s] = [];
      for (let t = 0; t < 4; t++) {
        const mat = keep(new THREE.MeshStandardMaterial({
          color: colors[quad], roughness: 0.22, metalness: 0.25,
          emissive: colors[quad], emissiveIntensity: 0,
        }));
        const grp = new THREE.Group();
        const body = new THREE.Mesh(pawnGeo, mat); body.castShadow = true;
        const hit = new THREE.Mesh(hitGeo, invisible); hit.position.y = 0.65; hit.userData = { seat: s, token: t };
        const ring = new THREE.Mesh(ringGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
        grp.add(body, hit, ring);
        root.add(grp);
        tokens[s].push({ grp, ring, mat });
      }
    }

    // ═══ a real die on the table ═══
    // Pips are drawn to a canvas per face (crisp at any zoom, nothing to
    // download). It lives in `scene`, NOT `root`, so it always rests in the same
    // corner of the table no matter which way the board is turned for you.
    const pipFace = (n: number) => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#16202e";
      const P = 26, M = 64, Q = 102;                       // pip grid positions
      const spots: Record<number, [number, number][]> = {
        1: [[M, M]],
        2: [[P, P], [Q, Q]],
        3: [[P, P], [M, M], [Q, Q]],
        4: [[P, P], [Q, P], [P, Q], [Q, Q]],
        5: [[P, P], [Q, P], [M, M], [P, Q], [Q, Q]],
        6: [[P, P], [Q, P], [P, M], [Q, M], [P, Q], [Q, Q]],
      };
      for (const [x, y] of spots[n]) { g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      junk.push(t);
      return keep(new THREE.MeshStandardMaterial({ map: t, roughness: 0.32, metalness: 0.05 }));
    };
    // BoxGeometry material order is +X −X +Y −Y +Z −Z; opposite faces sum to 7
    const die = new THREE.Mesh(
      keep(new RoundedBoxGeometry(1.5, 1.5, 1.5, 4, 0.26)),
      [pipFace(1), pipFace(6), pipFace(2), pipFace(5), pipFace(3), pipFace(4)],
    );
    // on the felt in FRONT of the board (between board edge 8.4 and mat edge 10.25),
    // pulled in from the right so perspective can't clip it out of frame
    const DIE_REST = new THREE.Vector3(5.6, -0.05, 9.35);
    die.position.copy(DIE_REST);
    die.castShadow = true;
    scene.add(die);
    // the rotation that lands face N face-up
    const FACE_UP: Record<number, [number, number, number]> = {
      1: [0, 0, Math.PI / 2], 2: [0, 0, 0], 3: [-Math.PI / 2, 0, 0],
      4: [Math.PI / 2, 0, 0], 5: [Math.PI, 0, 0], 6: [0, 0, -Math.PI / 2],
    };
    const dieTarget = new THREE.Quaternion();
    const dieSpinAxis = new THREE.Vector3(1, 0.6, 0.35).normalize();
    let rollT0 = -1;                     // >=0 while the scripted fallback tumbles
    let shownDie: number | null = null;
    const ROLL_MS = 780;

    // —— physics throw ————————————————————————————————————————————————————
    // A real rigid body tumbling on the table. The VALUE still comes from the
    // host, so once the body settles we rotate the demanded face upward — see
    // dice.ts for why that's invisible. If Rapier fails to load for any reason
    // we fall straight back to the old scripted spin, so the board always works.
    let sim: DieThrow | null = null;
    let simFace = 0;                     // the value this throw must end on
    let settleQ: THREE.Quaternion | null = null;

    const startRoll = (value: number) => {
      dieTarget.setFromEuler(new THREE.Euler(...FACE_UP[value]));
      dieSpinAxis.set(Math.random() * 2 - 1, Math.random() + 0.4, Math.random() * 2 - 1).normalize();
      simFace = value;
      settleQ = null;
      sim?.dispose(); sim = null;
      rollT0 = performance.now();        // scripted animation runs until physics is ready
      throwDie(DIE_REST).then((t) => {
        if (simFace !== value) { t.dispose(); return } // a newer roll already started
        sim = t;
        rollT0 = -1;                     // physics has the die now
      }).catch(() => { /* keep the scripted roll */ });
    };
    // roll whenever the host hands us a new die value; snap when it's cleared
    createEffect(() => {
      const d = props.st.die;
      if (d === shownDie) return;
      shownDie = d;
      if (d != null) startRoll(d);
    });

    // —— destination previews for the legal moves ——
    const destMat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    const dests = new THREE.Group();
    root.add(dests);

    const cellOf = (quad: number, rel: number, tokenIdx: number): [number, number] => {
      const c = rel === -1 ? LUDO_BASE[quad][tokenIdx] : (ludoCell(quad, rel) as [number, number]);
      return [wx(c[1]), wz(c[0])];
    };

    // —— reactive: targets, legality, previews, turn glow ——
    let targets: [number, number][][] = [];
    const legal = new Set<string>();
    createEffect(() => {
      const st = props.st;
      targets = [];
      for (let s = 0; s < np; s++) {
        targets[s] = [];
        for (let t = 0; t < 4; t++) targets[s][t] = cellOf(st.quads[s], st.tokens[s][t], t);
      }
      legal.clear();
      const canMove = props.myTurn && st.die !== null && !st.over;
      if (canMove) for (const t of st.legal) legal.add(`${props.seat}:${t}`);
      // preview where each legal token would land
      dests.clear();
      if (canMove && st.die !== null) {
        const quad = st.quads[props.seat];
        for (const t of st.legal) {
          const rel = st.tokens[props.seat][t];
          const to = rel === -1 ? 0 : Math.min(rel + st.die, LUDO_GOAL);
          const [x, z] = cellOf(quad, to, t);
          const d = new THREE.Mesh(discGeo, destMat);
          d.rotation.x = -Math.PI / 2;
          d.position.set(x, 0.29, z);
          dests.add(d);
        }
      }
      // the active player's yard breathes
      yardMats.forEach((m, q) => { m.emissiveIntensity = (!st.over && st.quads[st.turn] === q) ? 0.32 : 0; });
    });

    // —— pick a pawn (still supported; the DOM buttons are the primary path) ——
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hits: THREE.Object3D[] = [];
    for (const row of tokens) for (const tk of row) hits.push(tk.grp.children[1]);
    const onPointer = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(hits, false)[0];
      if (!hit) return;
      const { seat, token } = hit.object.userData as { seat: number; token: number };
      if (seat === props.seat && legal.has(`${seat}:${token}`)) props.onAct({ kind: "move", token });
    };
    const offTap = onBoardTap(renderer.domElement, onPointer);

    // —— loop: pawns chase their cell and ARC while travelling ——
    let disposed = false;
    const goal = new THREE.Vector3();
    const t0 = performance.now();
    const render = (now: number) => {
      if (disposed) return;
      const ts = (now - t0) / 1000;
      for (let s = 0; s < np; s++) for (let t = 0; t < 4; t++) {
        const tk = tokens[s]?.[t]; const tg = targets[s]?.[t];
        if (!tk || !tg) continue;
        const isLegal = legal.has(`${s}:${t}`);
        const home = props.st.tokens[s][t] === LUDO_GOAL;
        const p = tk.grp.position;
        const gap = Math.hypot(tg[0] - p.x, tg[1] - p.z);
        const arc = Math.min(gap * 0.45, 0.85);                       // hop while moving
        const bob = isLegal ? Math.abs(Math.sin(ts * 3.4)) * 0.26 : 0; // beckon when playable
        goal.set(tg[0], 0.17 + arc + bob + (home ? 0.22 : 0), tg[1]);
        p.lerp(goal, 0.22);
        tk.ring.visible = isLegal;
        tk.mat.emissiveIntensity = isLegal ? 0.35 + Math.sin(ts * 3.4) * 0.15 : (home ? 0.22 : 0);
        if (isLegal) { tk.ring.rotation.z = ts * 2.4; tk.grp.rotation.y = ts * 1.1; } else tk.grp.rotation.y = 0;
      }
      crown.rotation.y = Math.PI / 4 + ts * 0.35;

      // die: a real thrown body when Rapier is up, the scripted spin otherwise
      if (sim) {
        const { pos, quat, settled } = sim.step();
        die.position.copy(pos);
        if (!settled) {
          die.quaternion.copy(quat);
        } else {
          // lock in the demanded face once, then ease onto it so the swap
          // reads as the die rocking to a stop rather than snapping
          settleQ ??= correctToFace(quat, simFace);
          die.quaternion.slerp(settleQ, 0.25);
          die.position.lerp(DIE_REST, 0.12);
        }
      } else if (rollT0 >= 0) {
        const k = Math.min(1, (now - rollT0) / ROLL_MS);
        if (k < 0.72) {                                   // airborne, spinning
          die.rotateOnAxis(dieSpinAxis, 0.34);
          die.position.set(
            DIE_REST.x - 1.6 * (1 - k),
            DIE_REST.y + Math.sin(k / 0.72 * Math.PI) * 2.3,
            DIE_REST.z - 0.9 * (1 - k),
          );
        } else {                                          // land on the rolled face
          const s = (k - 0.72) / 0.28;
          die.quaternion.slerp(dieTarget, 0.28);
          die.position.lerp(DIE_REST, 0.3);
          if (s >= 1) { die.quaternion.copy(dieTarget); die.position.copy(DIE_REST); rollT0 = -1; }
        }
      }
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    let placed = false;
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
      sim?.dispose(); sim = null;   // the Rapier world holds wasm memory
      for (const d of junk) d.dispose();
      renderer.dispose();
    });
  });

  return <div class="bg-ludo3d" ref={wrap} />;
}
