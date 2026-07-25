// A real thrown die for the 3D tabletop.
//
// The old die was a scripted spin that slerped onto the answer. This throws an
// actual rigid body that tumbles and bounces off the table, which is the single
// most satisfying missing thing on the Ludo board.
//
// ★ The constraint that shapes everything: the VALUE IS NOT DECIDED HERE. Ludo
// is host-authoritative, so the number arrives over the network before the die
// is thrown. Physics is therefore theatre with a fixed ending — we simulate an
// honest throw, and once it settles we apply the smallest rotation that swaps
// the required face into the up position. Because opposite faces of a die are
// symmetric, that correction is invisible: the die still lies flat, at the yaw
// physics gave it, just relabelled.
import * as THREE from "three";

/**
 * Local-space normals for each pip count. Derived from the board's existing
 * FACE_UP table, and self-consistent: opposite faces sum to 7.
 */
export const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(1, 0, 0),
  2: new THREE.Vector3(0, 1, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
  5: new THREE.Vector3(0, -1, 0),
  6: new THREE.Vector3(-1, 0, 0),
};

/** Which pip count is facing up, given a world orientation. */
export function faceUp(q: THREE.Quaternion): number {
  let best = 1, bestDot = -Infinity;
  const v = new THREE.Vector3();
  for (const key of Object.keys(FACE_NORMALS)) {
    const f = Number(key);
    v.copy(FACE_NORMALS[f]).applyQuaternion(q);
    if (v.y > bestDot) { bestDot = v.y; best = f }
  }
  return best;
}

/**
 * The smallest correction that makes `want` the up face, starting from the
 * orientation physics settled into. Rotating the required face's normal onto
 * where the currently-up face's normal sits keeps the die flat and keeps its
 * yaw, so the swap reads as "that's just how it landed".
 */
export function correctToFace(settled: THREE.Quaternion, want: number): THREE.Quaternion {
  const up = faceUp(settled);
  if (up === want) return settled.clone();
  const delta = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[want], FACE_NORMALS[up]);
  return settled.clone().multiply(delta);
}

// —— the physics throw ————————————————————————————————————————————————————
export interface DieThrow {
  /** Advance the sim. Returns the die's current transform, and whether it's done. */
  step(): { pos: THREE.Vector3; quat: THREE.Quaternion; settled: boolean };
  dispose(): void;
}

type Rapier = typeof import("@dimforge/rapier3d-compat");
let rapierPromise: Promise<Rapier> | null = null;
/** Rapier ships as wasm and needs an async init — load it once, lazily. */
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import("@dimforge/rapier3d-compat").then(async (R) => { await R.init(); return R });
  return rapierPromise;
}

const SIZE = 0.42;       // half-extent, matching the board's die mesh
const SETTLE_SPEED = 0.06;
const MAX_STEPS = 600;   // ~10s at 60Hz — a die that never sleeps still finishes

/**
 * Throw a die onto a table at `restY`, landing near `rest`. Deterministic given
 * `rand`, so a replay could reproduce it; Ludo just uses Math.random.
 */
export async function throwDie(
  rest: THREE.Vector3,
  rand: () => number = Math.random,
): Promise<DieThrow> {
  const R = await loadRapier();
  const world = new R.World({ x: 0, y: -22, z: 0 }); // heavier than earth: dice settle fast

  // table + a low pen so a lively throw can't skitter off into the void
  world.createCollider(R.ColliderDesc.cuboid(6, 0.1, 6).setTranslation(rest.x, rest.y - 0.1 - SIZE, rest.z).setRestitution(0.35));
  for (const [dx, dz, sx, sz] of [[6, 0, 0.1, 6], [-6, 0, 0.1, 6], [0, 6, 6, 0.1], [0, -6, 6, 0.1]]) {
    world.createCollider(R.ColliderDesc.cuboid(sx, 2, sz).setTranslation(rest.x + dx, rest.y + 1, rest.z + dz));
  }

  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(rest.x - 1.8, rest.y + 3.4, rest.z - 1.1)
      .setLinvel((rand() - 0.2) * 3.5, 1.2, (rand() - 0.2) * 2.4)
      .setAngvel({ x: (rand() - 0.5) * 22, y: (rand() - 0.5) * 22, z: (rand() - 0.5) * 22 })
      .setLinearDamping(0.35)
      .setAngularDamping(0.42),
  );
  world.createCollider(R.ColliderDesc.cuboid(SIZE, SIZE, SIZE).setRestitution(0.32).setFriction(0.9), body);

  let steps = 0;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  return {
    step() {
      const done = steps >= MAX_STEPS;
      if (!done) { world.step(); steps++ }
      const t = body.translation(), r = body.rotation();
      pos.set(t.x, t.y, t.z);
      quat.set(r.x, r.y, r.z, r.w);
      const lv = body.linvel(), av = body.angvel();
      const slow =
        Math.hypot(lv.x, lv.y, lv.z) < SETTLE_SPEED && Math.hypot(av.x, av.y, av.z) < SETTLE_SPEED * 4;
      // settled only once it's slow AND has had time to actually land — a die
      // is momentarily near-motionless at the top of its arc
      return { pos, quat, settled: done || (slow && steps > 30) };
    },
    dispose() { world.free() },
  };
}
