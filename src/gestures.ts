// Camera navigation (beta) — MediaPipe HandLandmarker, fully on-device.
// Swipe an open hand to move the XMB; pinch (thumb+index) to confirm.
// EyeToy walked so this could wave.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { NavAction } from "./input";

let landmarker: HandLandmarker | null = null;
let video: HTMLVideoElement | null = null;
let stream: MediaStream | null = null;
let raf = 0;
let onAction: ((a: NavAction) => void) | null = null;

let lastX = 0, lastY = 0, lastT = 0, cooldown = 0, pinchHeld = false;

export async function startGestures(handler: (a: NavAction) => void): Promise<HTMLVideoElement> {
  onAction = handler;
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
  video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const files = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );
  landmarker = await HandLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    numHands: 1,
    runningMode: "VIDEO",
  });

  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!landmarker || !video || video.readyState < 2) return;
    const now = performance.now();
    const res = landmarker.detectForVideo(video, now);
    const lm = res.landmarks?.[0];
    if (!lm) { lastT = 0; return; }

    // pinch: thumb tip (4) to index tip (8)
    const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) < 0.055;
    if (pinch && !pinchHeld && now > cooldown) {
      pinchHeld = true;
      cooldown = now + 700;
      onAction?.("confirm");
    }
    if (!pinch) pinchHeld = false;

    // swipe: wrist (0) velocity — camera is mirrored, so flip X
    const x = 1 - lm[0].x, y = lm[0].y;
    if (lastT) {
      const dt = (now - lastT) / 1000;
      const vx = (x - lastX) / dt, vy = (y - lastY) / dt;
      if (now > cooldown) {
        if (Math.abs(vx) > 1.1 && Math.abs(vx) > Math.abs(vy) * 1.6) {
          onAction?.(vx > 0 ? "right" : "left");
          cooldown = now + 550;
        } else if (Math.abs(vy) > 1.1 && Math.abs(vy) > Math.abs(vx) * 1.6) {
          onAction?.(vy > 0 ? "down" : "up");
          cooldown = now + 550;
        }
      }
    }
    lastX = x; lastY = y; lastT = now;
  };
  raf = requestAnimationFrame(loop);
  return video;
}

export function stopGestures() {
  cancelAnimationFrame(raf);
  landmarker?.close();
  landmarker = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video = null;
  onAction = null;
}
