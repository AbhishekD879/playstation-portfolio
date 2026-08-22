// Self-check for World Drive math. Run: npx tsx src/worlddrive.test.ts
// Covers the pure layer only (projection, decode, sampling, car step) — the
// fetch/canvas layer is exercised live in the browser.
import { strict as assert } from "node:assert";
import { buildBuildingMeshes, buildRoadMeshes, buildingHeight, decodeTerrarium, ll2px, px2ll, ll2world, makeFrame, resample, sampleHeight, world2hm, roadWidth, stepCar, HM, type CarState, type OsmWay } from "./worlddrive";

// terrarium decode: sea level encodes as (128, 0, 0)
assert.equal(decodeTerrarium(128, 0, 0), 0);
assert.equal(decodeTerrarium(129, 0, 0), 256);
assert.ok(Math.abs(decodeTerrarium(128, 100, 128) - 100.5) < 1e-9);

// projection roundtrip
for (const [lat, lon] of [[35.6595, 139.7005], [46.5197, 6.6323], [-33.8688, 151.2093]] as const) {
  const p = ll2px(lat, lon);
  const b = px2ll(p.x, p.y);
  assert.ok(Math.abs(b.lat - lat) < 1e-6 && Math.abs(b.lon - lon) < 1e-6, "roundtrip");
}

// world frame: searched point lands at origin, inside the central tile
const f = makeFrame(35.6595, 139.7005); // Shibuya
const o = ll2world(f, 35.6595, 139.7005);
assert.ok(Math.abs(o.x) < 1e-6 && Math.abs(o.z) < 1e-6);
const hmPos = world2hm(f, 0, 0);
assert.ok(hmPos.u > 256 && hmPos.u < 512 && hmPos.v > 256 && hmPos.v < 512, "origin in central tile");

// ~100m east should be ~100m in world x
const e = ll2world(f, 35.6595, 139.7005 + 100 / (111320 * Math.cos((35.6595 * Math.PI) / 180)));
assert.ok(Math.abs(e.x - 100) < 1, `east offset ${e.x}`);
assert.ok(Math.abs(e.z) < 1);

// bilinear sampling on a synthetic ramp: h = u
const ramp = new Float32Array(HM * HM);
for (let v = 0; v < HM; v++) for (let u = 0; u < HM; u++) ramp[v * HM + u] = u;
const mid = sampleHeight(ramp, f, 0, 0);
assert.ok(Math.abs(mid - world2hm(f, 0, 0).u) < 0.01, "ramp sample");

// road widths ordered sanely
assert.ok(roadWidth("motorway") > roadWidth("primary"));
assert.ok(roadWidth("primary") > roadWidth("residential"));
assert.ok(roadWidth("residential") > roadWidth("service"));

// car: throttle accelerates forward along +heading, brake stops, reverse works
const onRoad = () => true;
let s: CarState = { x: 0, z: 0, heading: 0, speed: 0 };
for (let i = 0; i < 120; i++) s = stepCar(s, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60, onRoad);
assert.ok(s.speed > 10, `accelerates (${s.speed})`);
assert.ok(s.z > 5 && Math.abs(s.x) < 1e-6, "moves along heading 0 = +z");
for (let i = 0; i < 300; i++) s = stepCar(s, { throttle: 0, brake: 1, steer: 0, handbrake: false }, 1 / 60, onRoad);
assert.ok(s.speed <= 0, "brake then reverse");
assert.ok(s.speed >= -9.5, "reverse capped");

// steering turns, and off-road is slower than on-road
let road: CarState = { x: 0, z: 0, heading: 0, speed: 0 };
let dirt: CarState = { x: 0, z: 0, heading: 0, speed: 0 };
for (let i = 0; i < 240; i++) {
  road = stepCar(road, { throttle: 1, brake: 0, steer: 0.5, handbrake: false }, 1 / 60, () => true);
  dirt = stepCar(dirt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1 / 60, () => false);
}
assert.ok(road.heading > 0.3, "steers");
assert.ok(dirt.speed < road.speed * 0.7, `offroad slower (${dirt.speed} vs ${road.speed})`);

// resample: ~6m spacing, endpoints kept
const rs = resample([{ x: 0, z: 0 }, { x: 60, z: 0 }]);
assert.equal(rs.length, 11);
assert.deepEqual(rs[0], { x: 0, z: 0 });
assert.deepEqual(rs[rs.length - 1], { x: 60, z: 0 });

// road ribbons on flat ground: lifted, quad strip, uv runs in dash periods
const flat = new Float32Array(HM * HM);
const east = 120 / (111320 * Math.cos((35.6595 * Math.PI) / 180));
const roadWay: OsmWay = { kind: "road", tags: { highway: "primary" }, pts: [{ lat: 35.6595, lon: 139.7005 }, { lat: 35.6595, lon: 139.7005 + east }] };
const { road: ribbon, disc } = buildRoadMeshes(f, [roadWay], () => 0);
assert.ok(ribbon.pos.length >= 2 * 3 * 2, "ribbon has vertices");
assert.equal(ribbon.idx.length % 3, 0);
for (let i = 1; i < ribbon.pos.length; i += 3) assert.ok(Math.abs(ribbon.pos[i] - 0.3) < 1e-6, "road floats 0.3m");
const vMax = Math.max(...ribbon.uv.filter((_, i) => i % 2 === 1));
assert.ok(Math.abs(vMax - 120 / 12) < 0.15, `uv length ${vMax}`);
assert.ok(disc.idx.length >= 2 * 10 * 3, "two end caps");

// building heights: tags win, fallback deterministic
assert.equal(buildingHeight({ height: "40" }, 0), 40);
assert.ok(Math.abs(buildingHeight({ "building:levels": "5" }, 0) - 16) < 1e-9);
assert.equal(buildingHeight({}, 3), buildingHeight({}, 3));

// square footprint: 4 wall quads, earcut roof (2 tris), meter UVs
const sq = 20 / (111320 * Math.cos((35.6595 * Math.PI) / 180));
const bWay: OsmWay = {
  kind: "building", tags: { height: "12" },
  pts: [
    { lat: 35.6595, lon: 139.7005 }, { lat: 35.6595, lon: 139.7005 + sq },
    { lat: 35.6595 + 20 / 110540, lon: 139.7005 + sq }, { lat: 35.6595 + 20 / 110540, lon: 139.7005 },
    { lat: 35.6595, lon: 139.7005 }, // closed ring — must be deduped
  ],
};
const { walls, roofs } = buildBuildingMeshes(f, [bWay], () => 0);
assert.equal(walls.pos.length / 3, 16, "4 quads");
assert.equal(roofs.idx.length, 6, "2 roof tris");
const wallU = walls.uv.filter((_, i) => i % 2 === 0);
assert.ok(Math.abs(Math.max(...wallU) - 20 / 3) < 0.2, "wall uv in 3m window cells");

console.log("worlddrive: all checks passed");
