// World Drive — data + math layer. Turns a lat/lon into a drivable ~3km world:
// AWS Open Data terrarium elevation tiles (keyless) for terrain, Overpass OSM
// (keyless) for roads + building footprints. Everything is projected into Web
// Mercator pixels at one fixed zoom so the heightmap, the road texture and the
// car all share a single, consistent coordinate frame; world units are meters.
//
// Roads are 3D ribbons draped over the render surface (buildRoadMeshes) with
// end-cap discs instead of true intersection meshing — hop.earth's unsolved
// problem dodged the same way they dodge it. The texture-painted roads remain
// only as the no-imagery fallback ground.

import { ShapeUtils, Vector2 } from "three"; // earcut only — no GPU, node-safe

export const ZOOM = 15; // terrarium max zoom
export const GRID = 3; // 3×3 tiles ≈ 2.5–3.6km world depending on latitude
export const HM = GRID * 256; // heightmap resolution (768²)

// —— projection: lat/lon ⇄ mercator px at ZOOM ————————————————————————————
const WORLD_PX = 256 * 2 ** ZOOM;

export function ll2px(lat: number, lon: number): { x: number; y: number } {
  const x = ((lon + 180) / 360) * WORLD_PX;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD_PX;
  return { x, y };
}

export function px2ll(x: number, y: number): { lat: number; lon: number } {
  const lon = (x / WORLD_PX) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / WORLD_PX;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}

/** meters per mercator pixel at this latitude and ZOOM */
export function metersPerPx(lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;
}

/** terrarium RGB → meters. h = R·256 + G + B/256 − 32768 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

// —— the world frame ———————————————————————————————————————————————————————
// A GRID×GRID tile block roughly centered on the point. Origin (world 0,0) is
// the searched point itself; +x = east, +z = south (three.js ground plane).
export interface WorldFrame {
  tx0: number; ty0: number; // top-left tile
  px0: number; py0: number; // origin in mercator px
  mpp: number; // meters per px
  sizeM: number; // world edge length in meters
}

export function makeFrame(lat: number, lon: number): WorldFrame {
  const p = ll2px(lat, lon);
  const half = Math.floor(GRID / 2);
  const tx0 = Math.floor(p.x / 256) - half;
  const ty0 = Math.floor(p.y / 256) - half;
  const mpp = metersPerPx(lat);
  return { tx0, ty0, px0: p.x, py0: p.y, mpp, sizeM: GRID * 256 * mpp };
}

/** lat/lon → world meters (x east, z south) */
export function ll2world(f: WorldFrame, lat: number, lon: number): { x: number; z: number } {
  const p = ll2px(lat, lon);
  return { x: (p.x - f.px0) * f.mpp, z: (p.y - f.py0) * f.mpp };
}

/** world meters → heightmap pixel coords (0..HM) */
export function world2hm(f: WorldFrame, x: number, z: number): { u: number; v: number } {
  return { u: f.px0 - f.tx0 * 256 + x / f.mpp, v: f.py0 - f.ty0 * 256 + z / f.mpp };
}

/** bilinear height sample from the decoded grid, in meters */
export function sampleHeight(hm: Float32Array, f: WorldFrame, x: number, z: number): number {
  const { u, v } = world2hm(f, x, z);
  const cu = Math.min(Math.max(u, 0), HM - 1.001), cv = Math.min(Math.max(v, 0), HM - 1.001);
  const iu = Math.floor(cu), iv = Math.floor(cv), fu = cu - iu, fv = cv - iv;
  const i = iv * HM + iu;
  const a = hm[i], b = hm[i + 1], c = hm[i + HM], d = hm[i + HM + 1];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

// —— fetching ———————————————————————————————————————————————————————————————
const TERRAIN_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Fetch + stitch + decode the GRID×GRID terrarium block into a Float32 grid. */
export async function fetchHeightmap(f: WorldFrame): Promise<Float32Array> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = HM;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await Promise.all(
    Array.from({ length: GRID * GRID }, (_, i) => {
      const dx = i % GRID, dy = Math.floor(i / GRID);
      return new Promise<void>((res, rej) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { ctx.drawImage(img, dx * 256, dy * 256); res(); };
        img.onerror = () => rej(new Error("terrain tile failed"));
        img.src = TERRAIN_URL(ZOOM, f.tx0 + dx, f.ty0 + dy);
      });
    }),
  );
  const d = ctx.getImageData(0, 0, HM, HM).data;
  const hm = new Float32Array(HM * HM);
  for (let i = 0; i < hm.length; i++) hm[i] = decodeTerrarium(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  return hm;
}

// Esri World Imagery — same keyless service MapApp/CesiumGlobe already drape.
// z17 = 4× the mercator resolution of our z15 frame: 12×12 tiles, drawn 1:1
// onto a 3072² canvas. Photographic ground is what makes it read as "the real
// world"; the painted grass+roads look stays as the offline/failed fallback.
const IMAGERY_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const IMG_FACTOR = 4; // z15 → z17

export async function fetchImagery(f: WorldFrame): Promise<HTMLCanvasElement> {
  const n = GRID * IMG_FACTOR;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * 256;
  const ctx = canvas.getContext("2d")!;
  await Promise.all(
    Array.from({ length: n * n }, (_, i) => {
      const dx = i % n, dy = Math.floor(i / n);
      return new Promise<void>((res, rej) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { ctx.drawImage(img, dx * 256, dy * 256); res(); };
        img.onerror = () => rej(new Error("imagery tile failed"));
        img.src = IMAGERY_URL(ZOOM + 2, f.tx0 * IMG_FACTOR + dx, f.ty0 * IMG_FACTOR + dy);
      });
    }),
  );
  return canvas;
}

export interface OsmWay { kind: "road" | "building"; tags: Record<string, string>; pts: { lat: number; lon: number }[] }

const ROAD_RE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/;

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Roads + building footprints inside the frame, via Overpass (keyless, mirror fallback). */
export async function fetchOsm(f: WorldFrame): Promise<OsmWay[]> {
  const nw = px2ll(f.tx0 * 256, f.ty0 * 256);
  const se = px2ll((f.tx0 + GRID) * 256, (f.ty0 + GRID) * 256);
  const bbox = `${se.lat},${nw.lon},${nw.lat},${se.lon}`;
  const q = `[out:json][timeout:40];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${bbox});out geom;way["building"](${bbox});out geom 3000;`;
  let res: Response | null = null, lastErr: unknown = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(50_000) });
      if (r.ok) { res = r; break }
      lastErr = new Error(`Overpass ${r.status}`);
    } catch (e) { lastErr = e }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error("Overpass unreachable");
  const json: unknown = await res.json();
  const out: OsmWay[] = [];
  for (const el of (json as { elements?: any[] }).elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const tags: Record<string, string> = el.tags ?? {};
    const kind = ROAD_RE.test(tags.highway ?? "") ? "road" : tags.building ? "building" : null;
    if (!kind) continue;
    out.push({ kind, tags, pts: el.geometry.map((g: any) => ({ lat: g.lat, lon: g.lon })) });
  }
  return out;
}

export interface Place { name: string; lat: number; lon: number }

/** Nominatim geocoding (keyless, light use per their policy). */
export async function geocode(q: string): Promise<Place[]> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const json: unknown = await res.json();
  return (json as any[]).map((r) => ({ name: String(r.display_name), lat: Number(r.lat), lon: Number(r.lon) }));
}

// —— road rasterizing ———————————————————————————————————————————————————————
/** Real-world road width in meters by highway class. */
export function roadWidth(highway: string): number {
  if (/^motorway/.test(highway)) return 16;
  if (/^(trunk|primary)/.test(highway)) return 11;
  if (/^(secondary|tertiary)/.test(highway)) return 8;
  if (highway === "service") return 4;
  return 6.5; // residential & friends
}

/**
 * Ground texture + road mask. With `imagery`, the photo IS the texture (real
 * roads are already in it) and only the physics mask is drawn. Without it,
 * paint the grass+roads fallback look.
 */
export function rasterizeGround(f: WorldFrame, ways: OsmWay[], imagery?: HTMLCanvasElement | null) {
  const tex = imagery ?? document.createElement("canvas");
  const texSize = imagery ? imagery.width : (tex.width = tex.height = 2048);
  const originPx = { x: f.tx0 * 256, y: f.ty0 * 256 };
  const scale = texSize / HM; // tex px per mercator px
  const toTex = (lat: number, lon: number) => {
    const p = ll2px(lat, lon);
    return { x: (p.x - originPx.x) * scale, y: (p.y - originPx.y) * scale };
  };

  const mask = document.createElement("canvas");
  mask.width = mask.height = 1024;
  const m = mask.getContext("2d", { willReadFrequently: true })!;
  const mScale = 1024 / HM; // mask px per mercator px
  m.lineCap = m.lineJoin = "round";

  const roads = ways.filter((w) => w.kind === "road");
  const ordered = roads.sort((a, b) => roadWidth(b.tags.highway) - roadWidth(a.tags.highway));

  // Visible roads are 3D ribbons now (buildRoadMeshes); the texture only needs
  // painted roads in the no-imagery fallback so the ground isn't bare grass.
  if (!imagery) {
    const g = tex.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, texSize, texSize);
    grad.addColorStop(0, "#3d6b34");
    grad.addColorStop(1, "#48733a");
    g.fillStyle = grad;
    g.fillRect(0, 0, texSize, texSize);
    g.lineCap = g.lineJoin = "round";
    for (const w of ordered) {
      g.strokeStyle = "#4a4b52";
      g.lineWidth = (roadWidth(w.tags.highway) / f.mpp) * scale;
      g.beginPath();
      w.pts.forEach((p, i) => {
        const t = toTex(p.lat, p.lon);
        i ? g.lineTo(t.x, t.y) : g.moveTo(t.x, t.y);
      });
      g.stroke();
    }
  }

  // physics mask — always from OSM geometry, +2m of shoulder forgiveness
  for (const w of ordered) {
    m.strokeStyle = "#fff";
    m.lineWidth = ((roadWidth(w.tags.highway) + 2) / f.mpp) * mScale;
    m.beginPath();
    w.pts.forEach((p, i) => {
      const t = toTex(p.lat, p.lon);
      i ? m.lineTo((t.x / scale) * mScale, (t.y / scale) * mScale) : m.moveTo((t.x / scale) * mScale, (t.y / scale) * mScale);
    });
    m.stroke();
  }
  const maskData = m.getImageData(0, 0, 1024, 1024).data;
  const onRoad = (x: number, z: number): boolean => {
    const { u, v } = world2hm(f, x, z);
    const mx = Math.round((u / HM) * 1023), my = Math.round((v / HM) * 1023);
    if (mx < 0 || my < 0 || mx > 1023 || my > 1023) return false;
    return maskData[(my * 1024 + mx) * 4 + 3] > 0;
  };
  return { tex, onRoad };
}

/** Nearest road point to world origin, and the road's direction there. */
export function findSpawn(f: WorldFrame, ways: OsmWay[]): { x: number; z: number; heading: number } {
  let best = { x: 0, z: 0, heading: 0 }, bestD = Infinity;
  for (const w of ways) {
    if (w.kind !== "road") continue;
    for (let i = 0; i < w.pts.length; i++) {
      const p = ll2world(f, w.pts[i].lat, w.pts[i].lon);
      const d = p.x * p.x + p.z * p.z;
      if (d < bestD) {
        bestD = d;
        const q = w.pts[i + 1] ?? w.pts[i - 1] ?? w.pts[i];
        const pq = ll2world(f, q.lat, q.lon);
        const sign = w.pts[i + 1] ? 1 : -1;
        best = { x: p.x, z: p.z, heading: Math.atan2(sign * (pq.x - p.x), sign * (pq.z - p.z)) };
      }
    }
  }
  return best;
}

// —— 3D road ribbons + building prisms ————————————————————————————————————————
// hop.earth's look, clean-room: roads are geometry draped over the terrain
// (crisp at every distance, junction discs hide the seams — no true
// intersection meshing, that's their unsolved problem too), buildings are the
// real OSM footprints extruded with meter-accurate wall UVs for a window
// texture. Plain arrays out, so this stays testable without a GPU.
export interface MeshData { pos: number[]; uv: number[]; idx: number[]; col?: number[] }

/**
 * The render surface: heights bilinear-interpolated over the SAME lattice the
 * terrain plane uses. Roads, buildings and the car must all sample this — not
 * the raw heightmap — or they sink under / float over the rendered ground
 * wherever the plane's linear interpolation departs from the finer data.
 */
export interface Surface { sample: (x: number, z: number) => number; seg: number }

export function makeSurface(hm: Float32Array, f: WorldFrame, seg = 383): Surface {
  const cx = ((f.tx0 + GRID / 2) * 256 - f.px0) * f.mpp;
  const cz = ((f.ty0 + GRID / 2) * 256 - f.py0) * f.mpp;
  const x0 = cx - f.sizeM / 2, z0 = cz - f.sizeM / 2, cell = f.sizeM / seg;
  const n = seg + 1;
  const grid = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++)
      grid[iz * n + ix] = sampleHeight(hm, f, x0 + ix * cell, z0 + iz * cell);
  const sample = (x: number, z: number) => {
    const u = Math.min(Math.max((x - x0) / cell, 0), seg - 0.001);
    const v = Math.min(Math.max((z - z0) / cell, 0), seg - 0.001);
    const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
    const i = iv * n + iu;
    return (grid[i] * (1 - fu) + grid[i + 1] * fu) * (1 - fv) + (grid[i + n] * (1 - fu) + grid[i + n + 1] * fu) * fv;
  };
  return { sample, seg };
}

const ROAD_LIFT = 0.3; // meters above terrain — hides drape error without floating
const DASH_PERIOD = 12; // meters of road per texture repeat along its length

/** Resample a polyline to ~`step` meter spacing, keeping original vertices. */
export function resample(pts: { x: number; z: number }[], step = 6): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Road ribbons + junction end-cap discs, draped on the heightmap. */
export function buildRoadMeshes(f: WorldFrame, ways: OsmWay[], surf: (x: number, z: number) => number): { road: MeshData; disc: MeshData } {
  const road: MeshData = { pos: [], uv: [], idx: [] };
  const disc: MeshData = { pos: [], uv: [], idx: [] };
  for (const w of ways) {
    if (w.kind !== "road" || w.pts.length < 2) continue;
    const half = roadWidth(w.tags.highway) / 2;
    const pts = resample(w.pts.map((p) => ll2world(f, p.lat, p.lon)));
    const base = road.pos.length / 3;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next.x - prev.x, dz = next.z - prev.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const y = surf(pts[i].x, pts[i].z) + ROAD_LIFT;
      road.pos.push(pts[i].x - dz * half, y, pts[i].z + dx * half, pts[i].x + dz * half, y, pts[i].z - dx * half);
      road.uv.push(0, s / DASH_PERIOD, 1, s / DASH_PERIOD);
      if (i > 0) {
        const v = base + i * 2;
        road.idx.push(v - 2, v - 1, v, v, v - 1, v + 1);
      }
    }
    // end caps: discs slightly wider than the ribbon, so T-junctions read as paved
    for (const end of [pts[0], pts[pts.length - 1]]) {
      const c = disc.pos.length / 3;
      const y = surf(end.x, end.z) + ROAD_LIFT - 0.02;
      disc.pos.push(end.x, y, end.z);
      disc.uv.push(0.5, 0.5);
      const SEG = 10;
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        disc.pos.push(end.x + Math.cos(a) * half * 1.15, y, end.z + Math.sin(a) * half * 1.15);
        disc.uv.push(0.5, 0.5);
        disc.idx.push(c, c + 1 + k, c + 1 + ((k + 1) % SEG));
      }
    }
  }
  return { road, disc };
}

/** Building height in meters from tags, with a deterministic fallback. */
export function buildingHeight(tags: Record<string, string>, seed: number): number {
  const h = parseFloat(tags.height ?? "");
  if (h > 2) return h;
  const lv = parseFloat(tags["building:levels"] ?? "");
  if (lv > 0) return lv * 3.2;
  return 5 + ((seed * 2654435761) % 9);
}

/** Extruded real footprints: walls with meter UVs (windows), flat roofs. */
export function buildBuildingMeshes(f: WorldFrame, ways: OsmWay[], surf: (x: number, z: number) => number): { walls: MeshData; roofs: MeshData } {
  const walls: MeshData = { pos: [], uv: [], idx: [], col: [] };
  const roofs: MeshData = { pos: [], uv: [], idx: [], col: [] };
  const WIN = 3; // one window cell per 3m of facade
  let bi = 0;
  for (const w of ways) {
    if (w.kind !== "building" || w.pts.length < 3) continue;
    const ring = w.pts.map((p) => ll2world(f, p.lat, p.lon));
    if (Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].z - ring[ring.length - 1].z) < 0.1) ring.pop();
    if (ring.length < 3) continue;
    const h = Math.max(3, buildingHeight(w.tags, bi));
    let yBase = Infinity;
    for (const p of ring) yBase = Math.min(yBase, surf(p.x, p.z));
    yBase -= 0.6;
    const yTop = yBase + h + 0.6;
    const shade = 0.75 + ((bi * 40503) % 100) / 400; // per-building gray variation
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.3) continue;
      const v = walls.pos.length / 3;
      walls.pos.push(a.x, yBase, a.z, b.x, yBase, b.z, b.x, yTop, b.z, a.x, yTop, a.z);
      walls.uv.push(0, 0, len / WIN, 0, len / WIN, (yTop - yBase) / WIN, 0, (yTop - yBase) / WIN);
      for (let k = 0; k < 4; k++) walls.col!.push(shade, shade, shade);
      walls.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const rv = roofs.pos.length / 3;
    for (const p of ring) {
      roofs.pos.push(p.x, yTop, p.z);
      roofs.uv.push(0, 0);
      roofs.col!.push(shade * 0.55, shade * 0.55, shade * 0.58);
    }
    // earcut handles concave (L/U-shaped) footprints correctly
    const tris = ShapeUtils.triangulateShape(ring.map((p) => new Vector2(p.x, p.z)), []);
    for (const t of tris) roofs.idx.push(rv + t[0], rv + t[1], rv + t[2]);
    bi++;
  }
  return { walls, roofs };
}

// —— arcade car ——————————————————————————————————————————————————————————————
// Kinematic, not rigid-body: sample terrain under the wheels, integrate speed
// and yaw. ponytail: no Rapier — a heightfield rigid body needs tuning to feel
// worse than 40 lines of arcade math; revisit only if we ever want collisions
// with buildings or jumps with airtime physics.
export interface CarState { x: number; z: number; heading: number; speed: number }
export interface CarInput { throttle: number; brake: number; steer: number; handbrake: boolean }

export const CAR = {
  accel: 14, // m/s²
  brake: 26,
  drag: 0.35, // per-second fraction of v
  offroadDrag: 1.6,
  maxSteer: 0.9, // rad/s at full grip speed
  topSpeed: 52, // m/s ≈ 187 km/h
  reverseTop: -9,
};

export function stepCar(s: CarState, inp: CarInput, dt: number, onRoad: (x: number, z: number) => boolean): CarState {
  const off = !onRoad(s.x, s.z);
  let a = inp.throttle * CAR.accel - Math.sign(s.speed) * inp.brake * CAR.brake;
  a -= s.speed * (CAR.drag + (off ? CAR.offroadDrag : 0));
  if (inp.handbrake) a -= Math.sign(s.speed) * 20;
  let speed = s.speed + a * dt;
  if (inp.brake > 0 && s.speed <= 0.3) speed = Math.max(CAR.reverseTop, s.speed - inp.brake * 8 * dt); // brake at standstill = reverse
  speed = Math.min(CAR.topSpeed * (off ? 0.45 : 1), speed);
  if (Math.abs(speed) < 0.02 && inp.throttle === 0) speed = 0;
  // steering authority scales up with speed then eases off near top speed
  const grip = Math.min(1, Math.abs(speed) / 7) * (1 - 0.4 * Math.min(1, Math.abs(speed) / CAR.topSpeed));
  const heading = s.heading + inp.steer * CAR.maxSteer * grip * (speed < 0 ? -1 : 1) * dt * (inp.handbrake ? 1.7 : 1);
  return {
    x: s.x + Math.sin(heading) * speed * dt,
    z: s.z + Math.cos(heading) * speed * dt,
    heading,
    speed,
  };
}
