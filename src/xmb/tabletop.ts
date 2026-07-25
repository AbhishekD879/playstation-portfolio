// The shared "sitting at a real table" rig for every 3D board on the console —
// Ludo, chess, and the grid games. One wooden table, one felt mat, one studio
// environment map, so the games all read as pieces on the same physical table
// instead of five different-looking WebGL scenes.
//
// Assets are CC0 from Poly Haven, vendored in public/ludo/ (see its README).
// Every load failure is swallowed: without them a board still plays, it just
// loses the grain and the reflections.
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface TabletopOpts {
  /** width/depth of the felt mat — make it a bit larger than the board */
  mat: number;
  /** y of the table surface (the mat sits just above it) */
  y?: number;
  /** felt colour; default is a card-room green */
  felt?: number;
  /** how strongly the HDRI lights the scene */
  envIntensity?: number;
}

/** Adds table + mat + environment to `scene` and tunes `renderer` for it.
 *  Returns the disposables so the caller's onCleanup can release them. */
export function addTabletop(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  opts: TabletopOpts,
): { dispose(): void }[] {
  const junk: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (junk.push(x), x);
  const y = opts.y ?? -0.5;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95; // 1.0+ blows out, 0.7 goes murky

  // Now that you can orbit, you can look at the horizon — so the table has to
  // fade into a dim room instead of ending at a hard edge in mid-air.
  const room = new THREE.Color(0x05080f);
  scene.background = room;
  scene.fog = new THREE.Fog(room, opts.mat * 1.9, opts.mat * 6);

  // —— the table ——
  const tex = new THREE.TextureLoader();
  // Grain has to look the same SIZE on every board, and the boards differ a lot
  // in world units (chess is 8 wide, Ludo 15) with the camera pulled in to match.
  // So derive the tiling from the mat instead of hardcoding it — a fixed repeat
  // read as huge abstract streaks behind the smaller boards.
  const rep = 200 / opts.mat;
  const load = (file: string, srgb = false) => {
    const t = tex.load(`/ludo/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    junk.push(t);
    return t;
  };
  const table = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(90, 90)),
    keep(new THREE.MeshStandardMaterial({
      map: load("wood_col.jpg", true),
      normalMap: load("wood_nor.jpg"),
      // Poly Haven "arm" packs AO/Rough/Metal into R/G/B, and three reads
      // roughness from G and metalness from B — so one file drives both.
      roughnessMap: load("wood_arm.jpg"),
      metalnessMap: load("wood_arm.jpg"),
      roughness: 1, metalness: 0.35,
    })),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = y;
  table.receiveShadow = true;
  scene.add(table);

  // —— the felt the board rests on ——
  const mat = new THREE.Mesh(
    keep(new RoundedBoxGeometry(opts.mat, 0.25, opts.mat, 3, 0.5)),
    keep(new THREE.MeshStandardMaterial({ color: opts.felt ?? 0x0e2417, roughness: 0.95, metalness: 0 })),
  );
  mat.position.y = y + 0.1;
  mat.receiveShadow = true;
  scene.add(mat);

  // —— something for varnish and plastic to reflect ——
  new RGBELoader().load("/ludo/studio.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    scene.environmentIntensity = opts.envIntensity ?? 0.45;
    junk.push(hdr);
  }, undefined, () => { /* no HDRI → the scene's own lights carry it */ });

  return junk;
}

/** Warm key + cool rim + hemisphere fill: the lighting the table expects.
 *  Returns nothing to dispose (lights hold no GPU resources). */
export function addTableLights(scene: THREE.Scene, coarse: boolean, span = 12): void {
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x080d16, 0.42));
  const key = new THREE.DirectionalLight(0xffeed6, 1.95);
  key.position.set(span * 0.6, span * 1.25, span * 0.65);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -span;
  key.shadow.camera.right = key.shadow.camera.top = span;
  key.shadow.bias = -0.0008;
  key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fa6ff, 0.35);
  rim.position.set(-span * 0.7, span * 0.5, -span * 0.75);
  scene.add(rim);
}

/** Camera distance that keeps `extent` in frame at any canvas aspect — a
 *  hardcoded position clips the board on square/portrait canvases. */
export function fitDistance(camera: THREE.PerspectiveCamera, extent: number): number {
  const half = Math.tan((camera.fov * Math.PI) / 180 / 2);
  return Math.max(extent / 2 / half, extent / 2 / (half * camera.aspect));
}

/** Drag to orbit, wheel/pinch to zoom, right-drag (or two fingers) to pan —
 *  what makes a 3D board feel like a table you're sitting at instead of a
 *  picture of one. Clamped so you can never end up under the table. */
export function makeControls(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  opts: { target?: THREE.Vector3; min: number; max: number; maxPolar?: number },
): OrbitControls {
  const c = new OrbitControls(camera, dom);
  c.target.copy(opts.target ?? new THREE.Vector3(0, 0, 0));
  c.enableDamping = true;
  c.dampingFactor = 0.075;
  c.rotateSpeed = 0.55;
  c.zoomSpeed = 0.8;
  c.panSpeed = 0.6;
  c.minDistance = opts.min;
  c.maxDistance = opts.max;
  c.minPolarAngle = 0.12;                        // don't fly to a perfect top-down
  c.maxPolarAngle = opts.maxPolar ?? 1.35;       // and never below the tabletop
  c.update();
  return c;
}

/** OrbitControls swallows drags, but a *tap* still has to place a piece. This
 *  fires `onTap` only when the pointer barely moved between down and up, so
 *  rotating the view never accidentally plays a move. */
export function onBoardTap(dom: HTMLElement, onTap: (e: PointerEvent) => void): () => void {
  let sx = 0, sy = 0, id = -1;
  const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; id = e.pointerId; };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) onTap(e); // a tap, not a drag
  };
  dom.addEventListener("pointerdown", down);
  dom.addEventListener("pointerup", up);
  return () => { dom.removeEventListener("pointerdown", down); dom.removeEventListener("pointerup", up); };
}
