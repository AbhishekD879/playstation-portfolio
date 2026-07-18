// XMB Photo Mode — snapshot the living console into a stylized 1920×1080
// card: the Wave scene as it is right now, framed with a PS-style HUD
// (wordmark, profile, category, timestamp). Entirely client-side; the PNG
// goes to the OS share sheet or straight to disk.
import { captureWave } from "./snapshot";
import { tint } from "./theme";

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

export async function composeSnapshot(info: { profile: string; category: string }): Promise<Blob | null> {
  const W = 1920, H = 1080;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d")!;

  const accentBase = tint();

  // ground: the theme's void gradient washed with the month tint — the tint
  // normally lives in CSS behind the (transparent) wave canvas
  const g = x.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, "#05060c");
  g.addColorStop(0.55, "#0a0e1c");
  g.addColorStop(1, "#05060c");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, H * 0.72, 0, W / 2, H * 0.72, W * 0.75);
  glow.addColorStop(0, accentBase);
  glow.addColorStop(1, "transparent");
  x.globalAlpha = 0.34;
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  x.globalAlpha = 1;

  const shot = captureWave();
  if (shot) {
    try {
      const img = await loadImg(shot);
      // cover-fit the scene into the frame
      const s = Math.max(W / img.width, H / img.height);
      const dw = img.width * s, dh = img.height * s;
      x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } catch { /* keep the gradient */ }
  }

  const accent = accentBase;

  // thin double frame, PS photo-mode style
  x.strokeStyle = "rgba(255,255,255,0.28)";
  x.lineWidth = 2;
  x.strokeRect(36, 36, W - 72, H - 72);
  x.strokeStyle = "rgba(255,255,255,0.10)";
  x.strokeRect(48, 48, W - 96, H - 96);

  // wordmark, top-left
  x.textBaseline = "top";
  x.fillStyle = "#fff";
  x.font = "500 40px Jost, system-ui, sans-serif";
  x.shadowColor = "rgba(0,0,0,0.6)";
  x.shadowBlur = 14;
  x.fillText("A B H I S H E K S T A T I O N", 84, 84);
  x.font = "400 22px Jost, system-ui, sans-serif";
  x.fillStyle = "rgba(255,255,255,0.72)";
  x.fillText("C O N S O L E   S N A P S H O T", 84, 140);

  // accent tick + meta line, bottom-left
  x.shadowBlur = 0;
  x.fillStyle = accent;
  x.fillRect(84, H - 152, 8, 56);
  x.fillStyle = "#fff";
  x.font = "500 30px Jost, system-ui, sans-serif";
  x.fillText(info.profile.toUpperCase(), 112, H - 152);
  x.fillStyle = "rgba(255,255,255,0.72)";
  x.font = "400 22px Jost, system-ui, sans-serif";
  const when = new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  x.fillText(`${info.category.toUpperCase()}  ·  ${when}`, 112, H - 110);

  return new Promise((res) => c.toBlob(res, "image/png"));
}

/** OS share sheet with the PNG as a real file; false if unsupported. */
export async function shareSnapshot(blob: Blob): Promise<boolean> {
  const file = new File([blob], "abhishekstation-snapshot.png", { type: "image/png" });
  if ((navigator as any).canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "AbhishekStation" } as any); return true; }
    catch { return true; } // user cancelled the sheet — still handled
  }
  return false;
}

export function downloadSnapshot(blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "abhishekstation-snapshot.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
