// Body pose matching — the EyeToy game the console was missing.
//
// MediaPipe's PoseLandmarker gives 33 body keypoints. Scoring a pose from raw
// point positions doesn't work: a tall person, a short person and someone
// standing closer all produce completely different coordinates for the same
// shape. So we score JOINT ANGLES instead, which are invariant to where you
// stand, how big you are, and where the camera is — the only thing they encode
// is the shape you're making, which is exactly what the game is about.
//
// The maths lives here, away from the DOM, because "does this pose match" is
// the part that can be quietly wrong.

/** The MediaPipe BlazePose landmark indices we care about. */
export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
} as const;

export interface Pt { x: number; y: number; visibility?: number }

/** Angle ABC in degrees, at vertex B. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * The six joints that define a pose's silhouette. Two per limb: the bend at the
 * elbow/knee, and where the limb is aimed relative to the torso.
 */
export const JOINTS = ["lElbow", "rElbow", "lArm", "rArm", "lKnee", "rKnee"] as const;
export type Joint = (typeof JOINTS)[number];
export type PoseAngles = Record<Joint, number>;

/** Reduce 33 landmarks to the six angles that describe the shape. */
export function anglesOf(lm: Pt[]): PoseAngles | null {
  if (!lm || lm.length < 29) return null;
  const p = (i: number) => lm[i];
  return {
    lElbow: angleAt(p(LM.lShoulder), p(LM.lElbow), p(LM.lWrist)),
    rElbow: angleAt(p(LM.rShoulder), p(LM.rElbow), p(LM.rWrist)),
    // arm direction: elbow, about the shoulder, relative to the hip — this is
    // what separates "arms up" from "arms out" when both elbows are straight
    lArm: angleAt(p(LM.lElbow), p(LM.lShoulder), p(LM.lHip)),
    rArm: angleAt(p(LM.rElbow), p(LM.rShoulder), p(LM.rHip)),
    lKnee: angleAt(p(LM.lHip), p(LM.lKnee), p(LM.lAnkle)),
    rKnee: angleAt(p(LM.rHip), p(LM.rKnee), p(LM.rAnkle)),
  };
}

/** How confident MediaPipe is about the joints we actually score. */
export function poseVisible(lm: Pt[]): boolean {
  if (!lm || lm.length < 29) return false;
  const need = [LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lHip, LM.rHip];
  return need.every((i) => (lm[i]?.visibility ?? 1) > 0.5);
}

export interface TargetPose {
  id: string;
  name: string;
  /** Angles in degrees. Only listed joints are scored — legs are ignored for
   *  seated players unless a pose actually depends on them. */
  want: Partial<PoseAngles>;
  /** A rough stick figure for the on-screen silhouette, in a 0-1 box. */
  figure: [number, number][][];
}

// Poses chosen to be clearly distinct from one another in angle space, so the
// scorer can't confuse two of them, and doable in a living room.
export const POSES: TargetPose[] = [
  {
    id: "t", name: "T-Pose",
    want: { lElbow: 175, rElbow: 175, lArm: 90, rArm: 90 },
    figure: [[[0.5, 0.16], [0.5, 0.58]], [[0.14, 0.3], [0.86, 0.3]], [[0.5, 0.58], [0.34, 0.92]], [[0.5, 0.58], [0.66, 0.92]]],
  },
  {
    id: "y", name: "Y — Arms Up",
    want: { lElbow: 172, rElbow: 172, lArm: 150, rArm: 150 },
    figure: [[[0.5, 0.16], [0.5, 0.58]], [[0.5, 0.24], [0.18, 0.05]], [[0.5, 0.24], [0.82, 0.05]], [[0.5, 0.58], [0.34, 0.92]], [[0.5, 0.58], [0.66, 0.92]]],
  },
  {
    id: "flex", name: "Double Biceps",
    want: { lElbow: 45, rElbow: 45, lArm: 95, rArm: 95 },
    figure: [[[0.5, 0.16], [0.5, 0.58]], [[0.5, 0.28], [0.2, 0.3]], [[0.2, 0.3], [0.24, 0.08]], [[0.5, 0.28], [0.8, 0.3]], [[0.8, 0.3], [0.76, 0.08]], [[0.5, 0.58], [0.34, 0.92]], [[0.5, 0.58], [0.66, 0.92]]],
  },
  {
    id: "teapot", name: "Little Teapot",
    want: { lElbow: 40, rElbow: 172, lArm: 70, rArm: 130 },
    figure: [[[0.5, 0.16], [0.5, 0.58]], [[0.5, 0.28], [0.26, 0.42]], [[0.26, 0.42], [0.5, 0.5]], [[0.5, 0.28], [0.86, 0.12]], [[0.5, 0.58], [0.34, 0.92]], [[0.5, 0.58], [0.66, 0.92]]],
  },
  {
    id: "salute", name: "Salute",
    want: { lElbow: 168, rElbow: 38, lArm: 20, rArm: 105 },
    figure: [[[0.5, 0.16], [0.5, 0.58]], [[0.5, 0.28], [0.42, 0.62]], [[0.5, 0.28], [0.76, 0.3]], [[0.76, 0.3], [0.6, 0.13]], [[0.5, 0.58], [0.34, 0.92]], [[0.5, 0.58], [0.66, 0.92]]],
  },
  {
    id: "star", name: "Star Jump",
    want: { lElbow: 172, rElbow: 172, lArm: 140, rArm: 140, lKnee: 170, rKnee: 170 },
    figure: [[[0.5, 0.16], [0.5, 0.55]], [[0.5, 0.24], [0.12, 0.08]], [[0.5, 0.24], [0.88, 0.08]], [[0.5, 0.55], [0.2, 0.94]], [[0.5, 0.55], [0.8, 0.94]]],
  },
];

/** Beyond this many degrees off, a joint scores nothing. */
export const JOINT_TOLERANCE = 55;

/**
 * 0-100 for how well `lm` matches `target`. Each scored joint contributes
 * equally, falling off linearly to zero at the tolerance.
 */
export function scorePose(lm: Pt[], target: TargetPose): number {
  const got = anglesOf(lm);
  if (!got) return 0;
  const joints = Object.keys(target.want) as Joint[];
  if (!joints.length) return 0;
  let sum = 0;
  for (const j of joints) {
    const diff = Math.abs(got[j] - (target.want[j] as number));
    sum += Math.max(0, 1 - diff / JOINT_TOLERANCE);
  }
  return Math.round((sum / joints.length) * 100);
}

/** Which pose the body is currently closest to — used for live feedback. */
export function bestMatch(lm: Pt[]): { pose: TargetPose; score: number } | null {
  const got = anglesOf(lm);
  if (!got) return null;
  let best = POSES[0], bestScore = -1;
  for (const p of POSES) {
    const s = scorePose(lm, p);
    if (s > bestScore) { best = p; bestScore = s }
  }
  return { pose: best, score: bestScore };
}

/** Points awarded for a held pose, so a near-miss still feels rewarded. */
export const pointsFor = (score: number) => (score < 40 ? 0 : Math.round(score * 10));
