// Self-check for the die face maths. Run: npx tsx src/dice.test.ts
// The physics itself needs wasm + a GPU-ish runtime, but the part that can be
// WRONG WITHOUT CRASHING is the face correction: get it subtly off and the
// board cheerfully shows a 3 when the server said 5.
import { strict as assert } from "node:assert";
import * as THREE from "three";
import { FACE_NORMALS, correctToFace, faceUp } from "./dice";

// —— the die is a real die: opposite faces sum to 7 ——
for (const [a, b] of [[1, 6], [2, 5], [3, 4]]) {
  const dot = FACE_NORMALS[a].dot(FACE_NORMALS[b]);
  assert.equal(dot, -1, `faces ${a} and ${b} must be opposite`);
}
// and all six are distinct unit axes
const seen = new Set(Object.values(FACE_NORMALS).map((v) => `${v.x},${v.y},${v.z}`));
assert.equal(seen.size, 6, "six distinct face normals");

// —— faceUp agrees with the board's own FACE_UP euler table ——
const FACE_UP_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, Math.PI / 2], 2: [0, 0, 0], 3: [-Math.PI / 2, 0, 0],
  4: [Math.PI / 2, 0, 0], 5: [Math.PI, 0, 0], 6: [0, 0, -Math.PI / 2],
};
for (let f = 1; f <= 6; f++) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_UP_EULER[f]));
  assert.equal(faceUp(q), f, `FACE_UP[${f}] must actually put ${f} up`);
}

// —— ★ the correction always produces the demanded face ——
// Exhaustive over many random settled orientations × every wanted value: this
// is the one that guarantees the board can never contradict the server.
let rngState = 12345;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff };
for (let trial = 0; trial < 400; trial++) {
  const settled = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2))
    .normalize();
  for (let want = 1; want <= 6; want++) {
    const fixed = correctToFace(settled, want);
    assert.equal(faceUp(fixed), want, `trial ${trial}: wanted ${want}, got ${faceUp(fixed)}`);
    assert.ok(Math.abs(fixed.length() - 1) < 1e-6, "correction must stay a unit quaternion");
  }
}

// —— already-correct orientations are left completely alone ——
for (let f = 1; f <= 6; f++) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...FACE_UP_EULER[f]));
  const fixed = correctToFace(q, f);
  assert.ok(Math.abs(Math.abs(fixed.dot(q)) - 1) < 1e-9, `face ${f} needed no correction`);
}

// —— the correction preserves the die lying FLAT ——
// If it tilted the die, physics' resting pose would visibly pop.
for (let trial = 0; trial < 100; trial++) {
  // a realistic settled pose: flat on some face, arbitrary yaw
  const base = Number(Object.keys(FACE_NORMALS)[trial % 6]);
  const flat = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(...FACE_UP_EULER[base]))
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2));
  for (let want = 1; want <= 6; want++) {
    const fixed = correctToFace(flat, want);
    const up = FACE_NORMALS[want].clone().applyQuaternion(fixed);
    assert.ok(up.y > 0.999, `face ${want} must end up pointing straight up, got y=${up.y.toFixed(4)}`);
  }
}

console.log("dice: face maths ok");
