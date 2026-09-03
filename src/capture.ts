// The SHARE button — a rolling clip buffer over anything on screen.
//
// Every PlayStation has a Share button; ours keeps the last 15 seconds of
// whatever canvas or video is playing and hands it back as a clip or a GIF,
// stamped with the console's own chrome so the artifact is recognisably from
// here. The visitor does something cool in DOOM, taps Share, and walks away
// with something they can post.
//
// ★ Why WebCodecs and not MediaRecorder. We buffer ENCODED chunks, not frames.
// 15s of raw 640x480 RGBA at 30fps is ~550 MB; the same window as VP9 is ~3 MB.
// MediaRecorder can't do this at all: its output is one opaque WebM stream with
// the header welded to the front, so "just keep the tail" produces a file with
// broken duration that seeks wrong. WebCodecs hands us individual chunks and —
// crucially — lets us FORCE a keyframe every second, so the ring can always be
// trimmed to a decodable boundary and muxed into a genuinely valid file.
//
// ponytail: video only. Emulator audio lives in an AudioContext we can't tap
// generically, and GIFs are silent anyway. `audio` slots into the muxer options
// the day a caller can hand us an AudioNode.
import { Muxer, ArrayBufferTarget } from "webm-muxer";

export const CLIP_SECONDS = 15;
const FPS = 30;
const KEY_EVERY = FPS; // one keyframe per second == one trim point per second
const MAX_W = 960; // clips are for sharing, not archiving
const RING_BYTES = 96 << 20; // hard memory ceiling, independent of the time window

type Src = HTMLCanvasElement | HTMLVideoElement;
export interface Chunk { data: Uint8Array; key: boolean; ts: number }

/**
 * Trim a chunk ring to the newest `windowUs` that still BEGINS ON A KEYFRAME.
 * Pure so it can be tested without a GPU — see capture.test.ts. Getting this
 * wrong doesn't throw, it silently produces a clip that opens to garbage, which
 * is exactly the kind of bug that ships.
 */
export function trimWindow(ring: Chunk[], windowUs: number): Chunk[] {
  if (!ring.length) return [];
  const cutoff = ring[ring.length - 1].ts - windowUs;
  let start = -1;
  for (let i = 0; i < ring.length; i++) {
    if (!ring[i].key) continue;
    if (ring[i].ts <= cutoff) start = i;      // latest keyframe at or before the cutoff
    else { if (start < 0) start = i; break }  // window starts before any keyframe: take the first
  }
  return start < 0 ? [] : ring.slice(start);
}

export interface ClipHandle {
  /** seconds currently buffered — drives the Share button's readiness */
  seconds(): number;
  saveClip(): Promise<Blob | null>;
  saveGif(): Promise<Blob | null>;
  stop(): void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const srcSize = (s: Src) =>
  s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : { w: s.width, h: s.height };

/** Codec preference: VP9 encodes retro pixel art far cleaner at the same size. */
async function pickCodec(w: number, h: number) {
  for (const [codec, mkv] of [["vp09.00.10.08", "V_VP9"], ["vp8", "V_VP8"]] as const) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: FPS });
      if (supported) return { codec, mkv };
    } catch { /* try the next one */ }
  }
  return null;
}

export function clipSupported() {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/** Every canvas/video in the top document AND in same-origin iframes. The PS2
 *  emulator runs in its own same-origin frame (so its input bridge and module
 *  are reachable), and until this looked inside frames the upscaler never found
 *  it — "ps2" sat in UPSCALE_APPS and silently did nothing. Cross-origin frames
 *  throw on contentDocument and are skipped. */
function captureCandidates(): Src[] {
  const out: Src[] = [...document.querySelectorAll<Src>("canvas, video")];
  for (const f of document.querySelectorAll("iframe")) {
    try {
      const doc = f.contentDocument;
      if (doc) out.push(...doc.querySelectorAll<Src>("canvas, video"));
    } catch { /* cross-origin: not ours to read */ }
  }
  return out;
}

/** Compose an element's rect through every same-origin frame up to the top
 *  document. getBoundingClientRect() inside an iframe is relative to THAT
 *  frame's viewport, so an overlay positioned in the top page must add each
 *  frame element's own offset. */
export function composeRect(inner: DOMRect, frames: DOMRect[]): { left: number; top: number; width: number; height: number } {
  let left = inner.left, top = inner.top;
  for (const f of frames) { left += f.left; top += f.top; }
  return { left, top, width: inner.width, height: inner.height };
}

/** The box a source actually PAINTS inside its element when CSS scales it with
 *  object-fit: contain — the emulator's canvas fills its frame and letterboxes
 *  the 4:3 picture inside, so covering the element rect stretched the upscaled
 *  image to the frame's aspect. Pure, so the letterbox maths is testable. */
export function fitRect(
  box: { left: number; top: number; width: number; height: number },
  srcW: number, srcH: number, objectFit: string,
): { left: number; top: number; width: number; height: number } {
  if (objectFit !== "contain" || !srcW || !srcH || !box.width || !box.height) return box;
  const scale = Math.min(box.width / srcW, box.height / srcH);
  const width = srcW * scale, height = srcH * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

export function sourceViewportRect(el: Element): { left: number; top: number; width: number; height: number } {
  const frames: DOMRect[] = [];
  let win: Window | null = el.ownerDocument.defaultView;
  while (win && win !== window) {
    const fe = win.frameElement;
    if (!fe) break;
    frames.push(fe.getBoundingClientRect());
    win = win.parent === win ? null : win.parent;
  }
  const box = composeRect(el.getBoundingClientRect(), frames);
  // a canvas/video scaled with object-fit: contain paints smaller than its box
  const { w, h } = srcSize(el as Src);
  const fit = (el.ownerDocument.defaultView ?? window).getComputedStyle(el).objectFit;
  return fitRect(box, w, h, fit);
}

/**
 * The biggest thing actually drawing pixels right now. Every capture surface we
 * have — EmulatorJS, Play!, Ruffle, xash3d, DOOM, the video player, and the
 * WebRTC <video> a spectator is watching — is a plain canvas or video in the top
 * document or a same-origin iframe, so one scan covers all of them and no app
 * needs to register itself. Cross-origin iframes are unreachable by design.
 */
export function findCaptureSource(): Src | null {
  let best: Src | null = null, bestArea = 0;
  for (const el of captureCandidates()) {
    // Console chrome is not app content. The living background (.wave-bg /
    // .fluid-canvas) is a full-screen canvas, so on area alone it beats every
    // real app view — and worse, the upscaler would then HIDE the console's own
    // background. Our own upscaled output is excluded for the same reason:
    // picking it up would feed the upscaler its own result.
    if (el.closest(".wave-bg") || el.classList.contains("fluid-canvas") || el.classList.contains("upscale-out")) continue;
    const { w, h } = srcSize(el);
    if (w < 64 || h < 64) continue;                     // sparklines, icons, thumbnails
    if (el instanceof HTMLVideoElement && el.readyState < 2) continue;
    const r = sourceViewportRect(el);
    if (r.width < 120 || r.height < 90) continue;       // not the main view
    if ((el.ownerDocument.defaultView ?? window).getComputedStyle(el).visibility === "hidden") continue;
    const area = r.width * r.height;
    if (area > bestArea) { best = el; bestArea = area }
  }
  return best;
}

/**
 * Start buffering `src`. Returns null when the browser has no WebCodecs or the
 * source hasn't sized itself yet — callers treat that as "Share unavailable".
 */
export async function startClipBuffer(src: Src, opts: { label: () => string }): Promise<ClipHandle | null> {
  if (!clipSupported()) return null;
  const first = srcSize(src);
  if (!first.w || !first.h) return null;

  const scale = Math.min(1, MAX_W / first.w);
  const W = even(first.w * scale);
  const H = even(first.h * scale);

  const picked = await pickCodec(W, H);
  if (!picked) return null;

  // The compositor is what actually gets encoded: source frame + console chrome.
  const stage = document.createElement("canvas");
  stage.width = W; stage.height = H;
  const g = stage.getContext("2d", { alpha: false })!;

  const ring: Chunk[] = [];
  let bytes = 0;
  let decoderConfig: VideoDecoderConfig | null = null;
  let frames = 0;
  let stopped = false;
  const t0 = performance.now();

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) decoderConfig = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      ring.push({ data, key: chunk.type === "key", ts: chunk.timestamp });
      bytes += data.byteLength;
      prune();
    },
    error: () => { stopped = true },
  });
  encoder.configure({ codec: picked.codec, width: W, height: H, framerate: FPS, bitrate: 4_000_000 });

  // Drop whole groups-of-pictures off the front: never strand a delta frame
  // without its keyframe, or the muxed clip starts with garbage.
  function prune() {
    const latest = ring[ring.length - 1].ts;
    const floor = latest - (CLIP_SECONDS + 2) * 1e6;
    while (ring.length > 1) {
      let next = -1;
      for (let i = 1; i < ring.length; i++) if (ring[i].key) { next = i; break }
      if (next < 0) break;
      const overTime = ring[next].ts <= floor;
      const overMem = bytes > RING_BYTES;
      if (!overTime && !overMem) break;
      for (const c of ring.splice(0, next)) bytes -= c.data.byteLength;
    }
  }

  function chrome() {
    const tint = getComputedStyle(document.documentElement).getPropertyValue("--xmb-tint").trim() || "#4a7fc8";
    const bar = Math.max(26, Math.round(H * 0.075));
    const pad = Math.round(bar * 0.5);
    const scrim = g.createLinearGradient(0, H - bar * 2, 0, H);
    scrim.addColorStop(0, "rgba(6,7,12,0)");
    scrim.addColorStop(1, "rgba(6,7,12,0.82)");
    g.fillStyle = scrim;
    g.fillRect(0, H - bar * 2, W, bar * 2);

    g.fillStyle = tint;                       // accent hairline, the console's tell
    g.fillRect(0, H - bar, W, 1);

    const size = Math.max(9, Math.round(bar * 0.34));
    g.font = `500 ${size}px Jost, system-ui, sans-serif`;
    g.textBaseline = "middle";
    const y = H - bar / 2 + 1;

    g.fillStyle = "rgba(242,245,250,0.92)";
    g.letterSpacing = `${(size * 0.18).toFixed(2)}px`;
    g.fillText("ABHISHEKSTATION", pad, y);
    const wordmark = g.measureText("ABHISHEKSTATION").width;

    g.letterSpacing = "0px";
    g.fillStyle = tint;
    g.fillText("·", pad + wordmark + pad * 0.6, y);
    g.fillStyle = "rgba(242,245,250,0.6)";
    g.fillText(opts.label(), pad + wordmark + pad * 1.2, y); // live: the game title lands after boot
  }

  // Pull frames on a clock rather than per-rAF: the display may be 120 Hz and we
  // only ever want FPS. Skipping when the encoder is backed up keeps a slow GPU
  // from turning into unbounded latency.
  let acc = 0, last = performance.now(), raf = 0;
  const pump = () => {
    if (stopped) return;
    raf = requestAnimationFrame(pump);
    const now = performance.now();
    acc += now - last; last = now;
    if (acc < 1000 / FPS) return;
    acc = Math.min(acc % (1000 / FPS), 1000 / FPS);
    if (encoder.state !== "configured" || encoder.encodeQueueSize > 4) return;

    const { w, h } = srcSize(src);
    if (!w || !h) return;
    // letterbox rather than stretch — a squashed clip looks broken
    const k = Math.min(W / w, H / h);
    const dw = w * k, dh = h * k;
    g.fillStyle = "#06070c"; g.fillRect(0, 0, W, H);
    try { g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch { return }
    chrome();

    const frame = new VideoFrame(stage, { timestamp: Math.round((now - t0) * 1000) });
    try { encoder.encode(frame, { keyFrame: frames % KEY_EVERY === 0 }) } finally { frame.close() }
    frames++;
  };
  raf = requestAnimationFrame(pump);

  const window_ = () => trimWindow(ring, CLIP_SECONDS * 1e6);

  async function saveClip(): Promise<Blob | null> {
    if (encoder.state === "configured") await encoder.flush();
    const win = window_();
    if (win.length < 2) return null;
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: picked!.mkv, width: W, height: H, frameRate: FPS },
      // clips are built in one go from a buffer we already hold
      streaming: false,
    });
    const base = win[0].ts;
    for (const c of win) {
      muxer.addVideoChunk(
        // rebased to zero: a clip that starts at t=94s confuses every player
        new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: c.ts - base, data: c.data }),
        undefined,
        c.ts - base,
      );
    }
    muxer.finalize();
    return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/webm" });
  }

  // GIF re-decodes the ring we already hold rather than keeping a second raw
  // buffer — the whole point of the encoded ring is that it's the only copy.
  async function saveGif(): Promise<Blob | null> {
    if (!decoderConfig) return null;
    if (encoder.state === "configured") await encoder.flush();
    const win = window_();
    if (win.length < 2) return null;

    const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
    const GIF_FPS = 10, GIF_SECONDS = 8, GIF_W = 320;
    const gw = even(GIF_W), gh = even((H / W) * GIF_W);
    const small = document.createElement("canvas");
    small.width = gw; small.height = gh;
    const sg = small.getContext("2d", { willReadFrequently: true })!;

    const from = win[win.length - 1].ts - GIF_SECONDS * 1e6;
    const gif = GIFEncoder();
    const step = 1e6 / GIF_FPS;
    let nextAt = -Infinity;

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (frame.timestamp >= from && frame.timestamp >= nextAt) {
            nextAt = frame.timestamp + step;
            sg.drawImage(frame, 0, 0, gw, gh);
            const rgba = sg.getImageData(0, 0, gw, gh).data;
            const palette = quantize(rgba, 256);
            gif.writeFrame(applyPalette(rgba, palette), gw, gh, { palette, delay: Math.round(1000 / GIF_FPS) });
          }
        } finally { frame.close() }
      },
      error: () => {},
    });
    decoder.configure(decoderConfig);
    // decode the whole window: inter-frame prediction means we can't start late
    for (const c of win) {
      decoder.decode(new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: c.ts, data: c.data }));
    }
    await decoder.flush();
    decoder.close();
    gif.finish();
    const bytes2 = gif.bytes();
    return bytes2.length ? new Blob([bytes2 as BlobPart], { type: "image/gif" }) : null;
  }

  return {
    seconds: () => (ring.length < 2 ? 0 : Math.min(CLIP_SECONDS, (ring[ring.length - 1].ts - ring[0].ts) / 1e6)),
    saveClip,
    saveGif,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try { if (encoder.state !== "closed") encoder.close() } catch { /* already gone */ }
      ring.length = 0; bytes = 0;
    },
  };
}

/**
 * Hand the clip to the OS share sheet when we can (that's the viral loop on a
 * phone), otherwise fall back to a download. Returns how it went so the UI can
 * say something true.
 */
export async function shareBlob(blob: Blob, name: string): Promise<"shared" | "saved"> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean;
    userActivation?: { isActive: boolean };
  };
  // ★ navigator.share() needs TRANSIENT user activation, and building the clip
  // (flush + mux) can easily outlive the ~5s window the tap bought us. Calling
  // it late doesn't just fail — in some environments the promise never settles
  // at all, which strands the UI on "saving…". So: only reach for the share
  // sheet while activation is genuinely still live, and even then race a
  // timeout so a wedged sheet can't hold the button hostage.
  const activationLive = nav.userActivation ? nav.userActivation.isActive : true;
  if (activationLive && nav.canShare?.({ files: [file] })) {
    try {
      await Promise.race([
        navigator.share({ files: [file], title: "AbhishekStation" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("share-timeout")), 20_000)),
      ]);
      return "shared";
    } catch (e) {
      // AbortError means they closed the sheet on purpose — don't then also
      // dump a file in their downloads folder. Anything else: fall through.
      if ((e as Error)?.name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}

export const clipName = (label: string, ext: string) =>
  `abhishekstation-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip"}.${ext}`;
