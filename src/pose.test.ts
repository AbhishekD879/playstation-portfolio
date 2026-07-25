// Self-check for pose matching. Run: npx tsx src/pose.test.ts
//
// The claim worth proving: scoring is invariant to body size and screen
// position. If it isn't, the game silently favours whoever stands in the right
// spot, which is the kind of unfairness nobody would ever report as a bug.
import { strict as assert } from "node:assert";
import { JOINTS, LM, POSES, anglesOf, angleAt, bestMatch, pointsFor, scorePose, type Pt } from "./pose";

// —— angleAt ——
assert.equal(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
assert.equal(Math.round(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 180);
assert.equal(Math.round(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 0);
assert.equal(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 0, "degenerate input must not NaN");

/**
 * Build a skeleton from a body description, so tests read as poses rather than
 * coordinate soup. `scale` and the offsets are what let us prove invariance.
 */
function body(opts: {
  armAngle: number;   // degrees from straight-down, outward (both arms)
  elbowBend: number;  // 0 = straight (both arms)
  // per-side overrides — Teapot and Salute are deliberately asymmetric, so a
  // symmetric-only helper could never express them
  lArmAngle?: number; lElbowBend?: number;
  rArmAngle?: number; rElbowBend?: number;
  scale?: number; ox?: number; oy?: number;
}): Pt[] {
  const s = opts.scale ?? 1, ox = opts.ox ?? 0, oy = opts.oy ?? 0;
  const lm: Pt[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 1 }));
  const P = (i: number, x: number, y: number) => { lm[i] = { x: ox + x * s, y: oy + y * s, visibility: 1 } };

  P(LM.nose, 0.5, 0.10);
  P(LM.lShoulder, 0.40, 0.25); P(LM.rShoulder, 0.60, 0.25);
  P(LM.lHip, 0.43, 0.55);      P(LM.rHip, 0.57, 0.55);
  P(LM.lKnee, 0.42, 0.75);     P(LM.rKnee, 0.58, 0.75);
  P(LM.lAnkle, 0.42, 0.95);    P(LM.rAnkle, 0.58, 0.95);

  // arm: shoulder → elbow at `armAngle` from straight down, then forearm bent
  const rad = (d: number) => (d * Math.PI) / 180;
  const UP = 0.18, FORE = 0.18;
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? LM.lShoulder : LM.rShoulder;
    const el = side < 0 ? LM.lElbow : LM.rElbow;
    const wr = side < 0 ? LM.lWrist : LM.rWrist;
    const shx = (lm[sh].x - ox) / s, shy = (lm[sh].y - oy) / s;
    const armAngle = (side < 0 ? opts.lArmAngle : opts.rArmAngle) ?? opts.armAngle;
    const elbowBend = (side < 0 ? opts.lElbowBend : opts.rElbowBend) ?? opts.elbowBend;
    // 0° = straight down; positive swings outward (away from the midline)
    const ex = shx + side * Math.sin(rad(armAngle)) * UP;
    const ey = shy + Math.cos(rad(armAngle)) * UP;
    P(el, ex, ey);
    // forearm continues the upper-arm direction, rotated by the bend
    const dir = armAngle + elbowBend;
    P(wr, ex + side * Math.sin(rad(dir)) * FORE, ey + Math.cos(rad(dir)) * FORE);
  }
  return lm;
}

// —— anglesOf produces all six joints, and nothing is NaN ——
{
  const a = anglesOf(body({ armAngle: 90, elbowBend: 0 }))!;
  assert.ok(a, "angles computed");
  for (const j of JOINTS) assert.ok(Number.isFinite(a[j]), `${j} must be finite, got ${a[j]}`);
}

// —— ★ INVARIANCE: same shape, different size and position → same angles ——
{
  const small = anglesOf(body({ armAngle: 90, elbowBend: 0, scale: 0.4, ox: 0.05, oy: 0.02 }))!;
  const big = anglesOf(body({ armAngle: 90, elbowBend: 0, scale: 1.0, ox: 0, oy: 0 }))!;
  const shifted = anglesOf(body({ armAngle: 90, elbowBend: 0, scale: 0.7, ox: 0.3, oy: 0.25 }))!;
  for (const j of JOINTS) {
    assert.ok(Math.abs(small[j] - big[j]) < 0.5, `${j}: size changed the angle (${small[j]} vs ${big[j]})`);
    assert.ok(Math.abs(shifted[j] - big[j]) < 0.5, `${j}: position changed the angle`);
  }
}

// —— a T-pose scores far higher on T than on arms-up ——
{
  const tPose = body({ armAngle: 90, elbowBend: 0 });
  const t = POSES.find((p) => p.id === "t")!;
  const y = POSES.find((p) => p.id === "y")!;
  const st = scorePose(tPose, t), sy = scorePose(tPose, y);
  assert.ok(st > 80, `a real T-pose should score high on T, got ${st}`);
  assert.ok(st > sy + 20, `T (${st}) must beat Y (${sy}) clearly`);
  assert.equal(bestMatch(tPose)!.pose.id, "t", "bestMatch should identify a T-pose");
}

// —— arms straight up matches Y, not T ——
{
  const yPose = body({ armAngle: 155, elbowBend: 0 });
  assert.equal(bestMatch(yPose)!.pose.id, "y", "arms up should read as Y");
  assert.ok(scorePose(yPose, POSES.find((p) => p.id === "y")!) > 75);
}

// —— a bent-elbow pose beats a straight-arm one on Double Biceps ——
{
  const flexed = body({ armAngle: 95, elbowBend: 130 });
  const straight = body({ armAngle: 95, elbowBend: 0 });
  const flex = POSES.find((p) => p.id === "flex")!;
  assert.ok(scorePose(flexed, flex) > scorePose(straight, flex) + 20, "elbow bend must matter");
}

// —— scores stay in range, and garbage input scores zero rather than throwing ——
for (const p of POSES) {
  for (const arm of [0, 45, 90, 135, 180]) {
    for (const bend of [0, 60, 120]) {
      const s = scorePose(body({ armAngle: arm, elbowBend: bend }), p);
      assert.ok(s >= 0 && s <= 100, `${p.id}: score ${s} out of range`);
    }
  }
}
assert.equal(scorePose([], POSES[0]), 0);
assert.equal(anglesOf([]), null);
assert.equal(bestMatch([]), null);

// —— ★ every pose is REACHABLE by some real body, including the asymmetric ones ——
// A pose nobody can hit would be an unwinnable round, and the only way to find
// that is to actually search the space of bodies.
for (const p of POSES) {
  let best = 0, bestAt = "";
  for (let la = 0; la <= 180; la += 10) {
    for (let lb = 0; lb <= 160; lb += 20) {
      for (let ra = 0; ra <= 180; ra += 10) {
        for (let rb = 0; rb <= 160; rb += 20) {
          const s2 = scorePose(
            body({ armAngle: 0, elbowBend: 0, lArmAngle: la, lElbowBend: lb, rArmAngle: ra, rElbowBend: rb }),
            p,
          );
          if (s2 > best) { best = s2; bestAt = `L${la}/${lb} R${ra}/${rb}` }
        }
      }
    }
  }
  assert.ok(best > 70, `${p.id} is unreachable — best was ${best} at ${bestAt}`);
}

// —— points ——
assert.equal(pointsFor(0), 0);
assert.equal(pointsFor(39), 0, "below the floor scores nothing");
assert.equal(pointsFor(100), 1000);
assert.ok(pointsFor(80) > pointsFor(60));

console.log("pose: matching ok");
