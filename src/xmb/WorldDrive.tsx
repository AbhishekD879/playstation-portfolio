// World Drive — hop.earth-style "drive the real world" for the console.
// Search any place on Earth (or pick a preset), drop in from the sky, and
// drive the actual streets: terrain from open elevation tiles, satellite
// imagery ground, 3D road ribbons and extruded OSM buildings with window
// facades — all keyless. The car is arcade math.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { setNavEnabled, primaryPad, type NavAction } from "../input";
import * as sfx from "../audio";
import { holdWakeLock } from "../wakelock";
import HzScreen from "./HzScreen";
import TileGrid, { COLS } from "./TileGrid";
import {
  GRID, HM, type MeshData, type OsmWay, type Place, type WorldFrame,
  buildBuildingMeshes, buildRoadMeshes, fetchHeightmap, fetchImagery, fetchOsm,
  findSpawn, geocode, makeFrame, makeSurface, rasterizeGround, stepCar, type CarState,
} from "../worlddrive";

// —— procedural textures (canvas, generated once per scene) ————————————————
function meshToGeo(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(d.pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(d.uv, 2));
  if (d.col) g.setAttribute("color", new THREE.Float32BufferAttribute(d.col, 3));
  g.setIndex(d.idx);
  return g;
}

/** Asphalt strip: edge lines + center dash. u = across the road, v = along. */
function makeRoadTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#45464c";
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = "rgba(215,219,226,0.85)";
  g.fillRect(5, 0, 3, 256); // edge lines
  g.fillRect(120, 0, 3, 256);
  g.fillRect(62, 0, 4, 128); // center dash — half the tile, repeats along v
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Facade tile: 4×4 window cells over 12m of wall (one cell = 3m). */
function makeWindowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#8b8f96"; // daylight concrete
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const r = Math.random();
      g.fillStyle = r < 0.15 ? "#b9c8d4" : r < 0.6 ? "#3d4650" : "#5d6b7a"; // sky glass / dark glass / office
      g.fillRect(x * 64 + 14, y * 64 + 12, 36, 40);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const LAST_KEY = "asp.worlddrive.last";

const PRESETS: (Place & { emoji: string; blurb: string })[] = [
  { name: "Shibuya Crossing, Tokyo", lat: 35.6595, lon: 139.7005, emoji: "🗼", blurb: "neon grid, tight streets" },
  { name: "Lombard Street, San Francisco", lat: 37.8021, lon: -122.4187, emoji: "🌉", blurb: "the crookedest hill" },
  { name: "Stelvio Pass, Italy", lat: 46.5286, lon: 10.4543, emoji: "🏔️", blurb: "48 alpine hairpins" },
  { name: "Monaco", lat: 43.7347, lon: 7.4206, emoji: "🏎️", blurb: "the grand prix streets" },
  { name: "Marine Drive, Mumbai", lat: 18.9432, lon: 72.8235, emoji: "🌊", blurb: "the queen's necklace" },
  { name: "Times Square, New York", lat: 40.758, lon: -73.9855, emoji: "🏙️", blurb: "manhattan blocks" },
];

type Phase = { t: "pick" } | { t: "loading"; msg: string } | { t: "drive" } | { t: "error"; msg: string };

export default function WorldDrive(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [phase, setPhase] = createSignal<Phase>({ t: "pick" });
  const [q, setQ] = createSignal("");
  const [results, setResults] = createSignal<Place[]>([]);
  const [sel, setSel] = createSignal(0);
  const [speedKmh, setSpeedKmh] = createSignal(0);
  const [placeName, setPlaceName] = createSignal("");
  let input: HTMLInputElement | undefined;
  let mount!: HTMLDivElement;
  let stopScene: (() => void) | null = null;
  let searchSeq = 0;

  const lastDrive = (): Place | null => {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") } catch { return null }
  };
  const tiles = () => {
    const last = lastDrive();
    return [
      ...(last ? [{ title: "Last drive", sub: last.name.split(",").slice(0, 2).join(","), place: last, emoji: "⟲" }] : []),
      ...PRESETS.map((p) => ({ title: p.name.split(",")[0], sub: p.blurb, place: p as Place, emoji: p.emoji })),
      ...results().map((r) => ({ title: r.name.split(",").slice(0, 2).join(","), sub: r.name.split(",").slice(2, 5).join(","), place: r, emoji: "📍" })),
    ];
  };

  async function runSearch(query: string) {
    const seq = ++searchSeq;
    const r = await geocode(query).catch(() => []);
    if (seq === searchSeq) { setResults(r); setSel(0); }
  }

  function pick(i: number) {
    const t = tiles()[i];
    if (t) { sfx.confirm(); startDrive(t.place); }
  }

  props.bind((a) => {
    if (phase().t !== "pick") { if (a === "back") backOut(); return }
    if (a === "left") { setSel(Math.max(0, sel() - 1)); sfx.tickV(); }
    if (a === "right") { setSel(Math.min(tiles().length - 1, sel() + 1)); sfx.tickV(); }
    if (a === "up") { setSel(Math.max(0, sel() - COLS)); sfx.tickV(); }
    if (a === "down") { setSel(Math.min(tiles().length - 1, sel() + COLS)); sfx.tickV(); }
    if (a === "confirm") pick(sel());
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  function backOut() {
    // from drive/loading/error back to the picker
    stopScene?.();
    stopScene = null;
    setNavEnabled(true);
    sfx.back();
    setPhase({ t: "pick" });
  }

  async function startDrive(place: Place) {
    setPhase({ t: "loading", msg: "Reading the mountains…" });
    setPlaceName(place.name.split(",").slice(0, 2).join(","));
    try {
      const frame = makeFrame(place.lat, place.lon);
      const hmP = fetchHeightmap(frame);
      const osmP = fetchOsm(frame);
      const imgP = fetchImagery(frame).catch(() => null); // photo ground; fallback = painted look
      const hm = await hmP;
      setPhase({ t: "loading", msg: "Photographing the ground from orbit…" });
      const ways = await osmP;
      if (!ways.some((w) => w.kind === "road")) throw new Error("No roads here — try somewhere less remote.");
      const imagery = await imgP;
      setPhase({ t: "loading", msg: "Laying the asphalt, raising the city…" });
      await new Promise((r) => setTimeout(r)); // let the loading line paint
      localStorage.setItem(LAST_KEY, JSON.stringify(place));
      setPhase({ t: "drive" });
      await new Promise((r) => requestAnimationFrame(r)); // mount div exists now
      stopScene = buildScene(frame, hm, ways, imagery);
      setNavEnabled(false);
    } catch (e) {
      setPhase({ t: "error", msg: e instanceof Error ? e.message : "Couldn't load this place." });
    }
  }

  function buildScene(frame: WorldFrame, hm: Float32Array, ways: OsmWay[], imagery: HTMLCanvasElement | null): () => void {
    const { tex, onRoad } = rasterizeGround(frame, ways, imagery);
    const spawn = findSpawn(frame, ways);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const sky = new THREE.Color("#8fb8dc");
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 300, frame.sizeM * 0.55);
    const camera = new THREE.PerspectiveCamera(62, mount.clientWidth / mount.clientHeight, 0.5, frame.sizeM * 1.2);

    scene.add(new THREE.HemisphereLight("#cfe4ff", "#3a4a30", 0.9));
    const sun = new THREE.DirectionalLight("#fff2dd", 1.4);
    sun.position.set(0.4, 1, 0.3);
    scene.add(sun);

    // —— terrain: one displaced plane wearing the road-painted texture ——
    const blockCenter = {
      x: ((frame.tx0 + GRID / 2) * 256 - frame.px0) * frame.mpp,
      z: ((frame.ty0 + GRID / 2) * 256 - frame.py0) * frame.mpp,
    };
    const surf = makeSurface(hm, frame); // ONE height source for plane, roads, buildings and car
    const seg = surf.seg;
    const geo = new THREE.PlaneGeometry(frame.sizeM, frame.sizeM, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, surf.sample(blockCenter.x + pos.getX(i), blockCenter.z + pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const groundTex = new THREE.CanvasTexture(tex);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.position.set(blockCenter.x, 0, blockCenter.z);
    scene.add(ground);

    // —— buildings: real footprints extruded, window facades in meter UVs ——
    const { walls, roofs } = buildBuildingMeshes(frame, ways, surf.sample);
    if (walls.pos.length) {
      const wallGeo = meshToGeo(walls);
      wallGeo.computeVertexNormals();
      scene.add(new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ map: makeWindowTexture(), vertexColors: true, side: THREE.DoubleSide })));
      scene.add(new THREE.Mesh(meshToGeo(roofs), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }

    // —— roads: crisp ribbons draped on the terrain, junction discs under seams ——
    const { road, disc } = buildRoadMeshes(frame, ways, surf.sample);
    // Basic (unlit) materials: asphalt is flat — and it can never go black from
    // a back-facing normal, whatever the ribbon winding turned out to be.
    const discMesh = new THREE.Mesh(meshToGeo(disc), new THREE.MeshBasicMaterial({ color: "#45464c", polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    discMesh.renderOrder = 1;
    const roadMesh = new THREE.Mesh(meshToGeo(road), new THREE.MeshBasicMaterial({ map: makeRoadTexture(), polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    roadMesh.renderOrder = 2;
    scene.add(discMesh, roadMesh);

    // —— the car: PS1-lowpoly box kart, nose toward +z ——
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4), new THREE.MeshLambertMaterial({ color: "#c62828" }));
    body.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), new THREE.MeshLambertMaterial({ color: "#263238" }));
    cabin.position.set(0, 1.05, -0.3);
    car.add(body, cabin);
    const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.35], [0.85, -1.35]]) {
      const wheel = new THREE.Mesh(wheelGeo, new THREE.MeshLambertMaterial({ color: "#111" }));
      wheel.position.set(wx, 0.38, wz);
      car.add(wheel);
    }
    scene.add(car);

    // —— the loop ——
    let s: CarState = { x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0 };
    let dropT = 0; // sky-drop intro
    const DROP = 2.0;
    const keys = new Set<string>();
    const kd = (e: KeyboardEvent) => {
      if (e.key === "Escape") { backOut(); return }
      if (e.repeat) return;
      keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === "r") s = { x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0 };
    };
    const ku = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    const releaseLock = holdWakeLock();

    let raf = 0, last = performance.now(), padExit = false;
    const camPos = new THREE.Vector3(s.x, surf.sample(s.x, s.z) + 60, s.z - 30);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 1 / 25);
      last = now;

      const pad = primaryPad();
      let steer = (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0);
      let throttle = keys.has("w") || keys.has("arrowup") ? 1 : 0;
      let brake = keys.has("s") || keys.has("arrowdown") ? 1 : 0;
      let handbrake = keys.has(" ");
      if (pad) {
        const ax = pad.axes[0] ?? 0;
        if (Math.abs(ax) > 0.12) steer = -ax;
        throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
        brake = Math.max(brake, pad.buttons[6]?.value ?? 0, pad.buttons[1]?.pressed ? 1 : 0);
        handbrake ||= !!pad.buttons[2]?.pressed;
        if (pad.buttons[3]?.pressed) s = { x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0 };
        if (pad.buttons[9]?.pressed) { if (!padExit) { padExit = true; backOut(); return } } else padExit = false;
      }

      const landed = dropT >= DROP;
      if (landed) s = stepCar(s, { throttle, brake, steer, handbrake }, dt, onRoad);
      else dropT += dt;

      const groundY = surf.sample(s.x, s.z);
      // ease in from the sky, then hug the terrain
      const drop = landed ? 0 : 120 * (1 - dropT / DROP) ** 2;
      car.position.set(s.x, groundY + drop, s.z);
      // visual pitch/roll from the terrain gradient under the car
      const dirX = Math.sin(s.heading), dirZ = Math.cos(s.heading);
      const ahead = surf.sample(s.x + dirX * 2.2, s.z + dirZ * 2.2);
      const behind = surf.sample(s.x - dirX * 2.2, s.z - dirZ * 2.2);
      const left = surf.sample(s.x + dirZ * 1.1, s.z - dirX * 1.1);
      const right = surf.sample(s.x - dirZ * 1.1, s.z + dirX * 1.1);
      car.rotation.set(Math.atan2(behind - ahead, 4.4), s.heading, Math.atan2(right - left, 2.2), "YXZ");

      const dist = 9 + Math.abs(s.speed) * 0.12, height = 3.6 + drop * 0.5;
      camPos.lerp(new THREE.Vector3(s.x - dirX * dist, groundY + drop * 0.4 + height, s.z - dirZ * dist), Math.min(1, dt * 4));
      camera.position.copy(camPos);
      camera.lookAt(s.x, groundY + drop + 1.6, s.z);

      setSpeedKmh(Math.round(Math.abs(s.speed) * 3.6));
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      removeEventListener("resize", onResize);
      releaseLock();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }

  onMount(() => setTimeout(() => input?.focus(), 60));
  onCleanup(() => { stopScene?.(); setNavEnabled(true); });

  return (
    <Show
      when={phase().t === "pick"}
      fallback={
        <div class="fullapp">
          <div class="fullapp-mount" ref={mount} />
          <Show when={phase().t === "loading"}>
            <div class="fullapp-status">🌍 {placeName()}<br />{(phase() as { msg: string }).msg}</div>
          </Show>
          <Show when={phase().t === "error"}>
            <div class="fullapp-status">{(phase() as { msg: string }).msg}<br /><br />○ back</div>
          </Show>
          <Show when={phase().t === "drive"}>
            <div class="wd-hud">
              <span class="wd-speed">{speedKmh()}<i> km/h</i></span>
              <span class="wd-place">{placeName()}</span>
            </div>
            <div class="doom-controls">🎮 stick steer · R2 gas · L2 brake · □ handbrake · △/R respawn · Options/Esc leave — or WASD</div>
          </Show>
          <button class="session-eject" onClick={backOut}>⏏ NEW LOCATION</button>
        </div>
      }
    >
      <div class="artwrap">
        <HzScreen
          kick="World Drive · the real Earth, drivable"
          count={`${tiles().length} places`}
          hints="✕ drive · ○ back"
          sub="imagery © Esri, Maxar · terrain © Copernicus/AWS · streets © OpenStreetMap"
          onClose={props.onClose}
          search={{
            value: q(),
            placeholder: "search anywhere on Earth…",
            onInput: setQ,
            ref: (el) => (input = el),
            onEnter: () => { const t = q().trim(); if (t) runSearch(t); },
          }}
        >
          <TileGrid
            tiles={tiles().map((t) => ({ title: t.title, sub: t.sub, badge: t.emoji }))}
            sel={sel()}
            shape="wide"
            fallback="🌍"
            onPick={pick}
            onHover={(i) => setSel(i)}
          />
        </HzScreen>
      </div>
    </Show>
  );
}
