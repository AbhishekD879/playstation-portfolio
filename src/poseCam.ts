// Camera → body landmarks, for the Pose Off party game.
//
// Separate from gestures.ts (which runs a HandLandmarker for crossbar
// navigation) because the two use different models and would fight over the
// camera; only one is ever active at a time.
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Pt } from "./pose";

export interface PoseCam {
  video: HTMLVideoElement;
  /** Most recent 33 landmarks, or null when nobody is in frame. */
  landmarks(): Pt[] | null;
  stop(): void;
}

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/** Open the camera and start tracking one body. Throws if the camera is denied. */
export async function startPoseCam(): Promise<PoseCam> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  let landmarker: PoseLandmarker | null = null;
  try {
    const files = await FilesetResolver.forVisionTasks(WASM);
    landmarker = await PoseLandmarker.createFromOptions(files, {
      // "lite" on purpose: this runs beside a live camera preview on whatever
      // laptop is acting as the console, and the full model buys accuracy the
      // game's 55° tolerance doesn't need.
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      numPoses: 1,
      runningMode: "VIDEO",
    });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }

  let latest: Pt[] | null = null;
  let raf = 0;
  let lastTs = -1;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!landmarker || video.readyState < 2) return;
    const ts = performance.now();
    // MediaPipe rejects a non-increasing timestamp in VIDEO mode
    if (ts <= lastTs) return;
    lastTs = ts;
    try {
      const res = landmarker.detectForVideo(video, ts);
      latest = (res.landmarks?.[0] as Pt[] | undefined) ?? null;
    } catch { /* a dropped frame is not worth tearing the game down */ }
  };
  raf = requestAnimationFrame(loop);

  return {
    video,
    landmarks: () => latest,
    stop() {
      cancelAnimationFrame(raf);
      landmarker?.close();
      landmarker = null;
      stream.getTracks().forEach((t) => t.stop());
      latest = null;
    },
  };
}
