// Watch Party — pluggable video sources. Each supported kind gets a small
// ADAPTER exposing the same play/pause/seek/getTime interface, so the room's
// sync engine talks to one shape no matter what's playing. What syncs:
//   • yt    — YouTube (IFrame Player API)
//   • vimeo — Vimeo (Player SDK)
//   • file  — a direct video file (.mp4/.webm/.ogg/.mov …) via <video>
//   • hls   — an HLS stream (.m3u8) via hls.js (native on Safari)
// DRM services (Netflix/Disney+/…) and arbitrary pages can't be controlled or
// even embedded, so resolveSource() returns null for them (the UI says why).
import Hls from "hls.js";

export type SourceKind = "yt" | "vimeo" | "file" | "hls" | "cobrowse";
export interface Source { kind: SourceKind; ref: string } // ref = video id (yt/vimeo), a URL (file/hls), or a Hyperbeam embed_url (cobrowse)

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d{6,})/;
const stripQuery = (u: string) => u.split(/[?#]/)[0];

/** Turn whatever the user pasted into a playable Source, or null if we can't sync it. */
export function resolveSource(input: string): Source | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[\w-]{11}$/.test(raw)) return { kind: "yt", ref: raw };       // bare YouTube id
  const yt = raw.match(YT_RE); if (yt) return { kind: "yt", ref: yt[1] };
  const vm = raw.match(VIMEO_RE); if (vm) return { kind: "vimeo", ref: vm[1] };
  if (/^https?:\/\//i.test(raw)) {
    const path = stripQuery(raw).toLowerCase();
    if (path.endsWith(".m3u8")) return { kind: "hls", ref: raw };
    if (/\.(mp4|webm|ogg|ogv|mov|m4v)$/.test(path)) return { kind: "file", ref: raw };
  }
  return null;
}

// Some links need an async lookup (an Internet Archive item page → its actual
// video file). Try the instant/local detection first, then Archive.org.
export async function resolveSourceAsync(input: string): Promise<Source | null> {
  const direct = resolveSource(input);
  if (direct) return direct;
  const m = input.trim().match(/archive\.org\/(?:details|embed)\/([^/?#]+)/i);
  if (m) return resolveArchive(m[1]);
  return null;
}

// archive.org/details/<id> → its best direct video file. Internet Archive is a
// legal home for out-of-copyright / public-domain films (exactly the old movies
// OTT drops), and its metadata + downloads are CORS-open, so we can play + sync
// them like any direct file. Prefers an .mp4 derivative, then webm/ogv.
async function resolveArchive(id: string): Promise<Source | null> {
  try {
    const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const j = await r.json() as { files?: { name: string; format?: string }[] };
    const files = j.files ?? [];
    const pick = files.find((f) => /\.mp4$/i.test(f.name)) ?? files.find((f) => /\.(webm|ogv|ogg)$/i.test(f.name));
    if (!pick) return null;
    const path = pick.name.split("/").map(encodeURIComponent).join("/");
    return { kind: "file", ref: `https://archive.org/download/${encodeURIComponent(id)}/${path}` };
  } catch { return null; }
}

export const sourceToken = (s: Source) => `${s.kind}:${s.ref}`;
/** Parse a stored token back to a Source. A bare (untagged) value is a legacy YouTube id. */
export function parseToken(token: string): Source {
  const m = token.match(/^(yt|vimeo|file|hls|cobrowse):([\s\S]+)$/);
  return m ? { kind: m[1] as SourceKind, ref: m[2] } : { kind: "yt", ref: token };
}
export const kindLabel = (k: SourceKind) => ({ yt: "YouTube", vimeo: "Vimeo", file: "video file", hls: "live stream", cobrowse: "shared browser" }[k]);

// —— SDK loaders (once each) ————————————————————————————————————————————————
let ytApi: Promise<any> | null = null;
function loadYT(): Promise<any> {
  return (ytApi ??= new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) { resolve(w.YT); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true; document.head.appendChild(s);
  }));
}
let vimeoApi: Promise<any> | null = null;
function loadVimeo(): Promise<any> {
  return (vimeoApi ??= new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Vimeo?.Player) { resolve(w.Vimeo); return; }
    const s = document.createElement("script"); s.src = "https://player.vimeo.com/api/player.js"; s.async = true;
    s.onload = () => resolve((window as any).Vimeo); s.onerror = reject; document.head.appendChild(s);
  }));
}

export interface PlayerCbs { onReady: () => void; onPlay: () => void; onPause: () => void; onEnded: () => void }
export interface Adapter {
  kind: SourceKind;
  load(ref: string, start: number, autoplay: boolean): void;
  play(): void; pause(): void; seek(sec: number): void;
  getTime(): number; playing(): boolean; isReady(): boolean;
  destroy(): void;
}

// Each adapter mounts its own element into `container` and cleans it up on destroy.
export function createAdapter(kind: SourceKind, container: HTMLElement, cbs: PlayerCbs): Adapter {
  if (kind === "yt") return ytAdapter(container, cbs);
  if (kind === "vimeo") return vimeoAdapter(container, cbs);
  if (kind === "cobrowse") return cobrowseAdapter(container, cbs);
  return htmlAdapter(kind, container, cbs); // file | hls
}

// A Hyperbeam shared browser: just embed the session — Hyperbeam streams the one
// real browser and handles multi-user control, so there's nothing to play/seek/
// sync on our side (the sync engine no-ops for this kind). ref = the embed_url.
function cobrowseAdapter(container: HTMLElement, cbs: PlayerCbs): Adapter {
  const frame = document.createElement("iframe");
  frame.className = "wp-cobrowse";
  // The console is cross-origin isolated (COEP, for the PS2 emulator's threads),
  // which otherwise BLOCKS a third-party iframe → "refused to connect". The
  // `credentialless` attribute loads it in a cookie-less context that's exempt
  // from COEP embedding rules (same trick the YouTube app uses). Hyperbeam auths
  // via the token in the embed URL, not cookies, so this is fine. (Chromium only;
  // Safari has no credentialless — the "open in a new tab" fallback covers it.)
  frame.setAttribute("credentialless", "");
  frame.allow = "autoplay; fullscreen; clipboard-read; clipboard-write; encrypted-media; microphone; camera";
  container.appendChild(frame);
  let loaded = false;
  return {
    kind: "cobrowse",
    load: (ref) => { if (!loaded) { loaded = true; frame.src = ref; cbs.onReady(); cbs.onPlay(); } },
    play: () => {}, pause: () => {}, seek: () => {},
    getTime: () => 0, playing: () => true, isReady: () => loaded,
    destroy: () => { container.innerHTML = ""; },
  };
}

function ytAdapter(container: HTMLElement, cbs: PlayerCbs): Adapter {
  let yt: any = null, ready = false, pending: { ref: string; start: number; autoplay: boolean } | null = null;
  const mount = document.createElement("div"); container.appendChild(mount);
  loadYT().then((YT) => {
    yt = new YT.Player(mount, {
      width: "100%", height: "100%",
      playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => { ready = true; if (pending) { const p = pending; pending = null; api.load(p.ref, p.start, p.autoplay); } cbs.onReady(); },
        onStateChange: (e: any) => { if (e.data === 1) cbs.onPlay(); else if (e.data === 2) cbs.onPause(); else if (e.data === 0) cbs.onEnded(); },
      },
    });
  });
  const api: Adapter = {
    kind: "yt",
    load: (ref, start, autoplay) => { if (!ready) { pending = { ref, start, autoplay }; return; } const o = { videoId: ref, startSeconds: Math.max(0, start) }; autoplay ? yt.loadVideoById(o) : yt.cueVideoById(o); },
    play: () => yt?.playVideo?.(), pause: () => yt?.pauseVideo?.(), seek: (s) => yt?.seekTo?.(s, true),
    getTime: () => yt?.getCurrentTime?.() ?? 0, playing: () => yt?.getPlayerState?.() === 1, isReady: () => ready,
    destroy: () => { try { yt?.destroy?.(); } catch { /* noop */ } container.innerHTML = ""; },
  };
  return api;
}

function htmlAdapter(kind: SourceKind, container: HTMLElement, cbs: PlayerCbs): Adapter {
  const video = document.createElement("video");
  video.controls = true; video.playsInline = true; video.className = "wp-video-el";
  container.appendChild(video);
  let hls: Hls | null = null, ready = false;
  const markReady = () => { if (!ready) { ready = true; cbs.onReady(); } };
  video.addEventListener("canplay", markReady);
  video.addEventListener("playing", cbs.onPlay);
  video.addEventListener("pause", cbs.onPause);
  video.addEventListener("ended", cbs.onEnded);
  const setSrc = (ref: string) => {
    hls?.destroy(); hls = null;
    if (kind === "hls" && !video.canPlayType("application/vnd.apple.mpegurl") && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 20 }); hls.loadSource(ref); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, markReady);
    } else {
      video.src = ref; // native (direct file, or Safari HLS)
    }
  };
  let curRef = "";
  return {
    kind,
    load: (ref, start, autoplay) => { if (ref !== curRef) { curRef = ref; ready = false; setSrc(ref); } if (start) { try { video.currentTime = start; } catch { /* not seekable yet */ } } autoplay ? video.play().catch(() => {}) : video.pause(); },
    play: () => video.play().catch(() => {}), pause: () => video.pause(), seek: (s) => { try { video.currentTime = s; } catch { /* noop */ } },
    getTime: () => video.currentTime || 0, playing: () => !video.paused && !video.ended, isReady: () => ready,
    destroy: () => { hls?.destroy(); video.removeAttribute("src"); video.load?.(); container.innerHTML = ""; },
  };
}

function vimeoAdapter(container: HTMLElement, cbs: PlayerCbs): Adapter {
  let vp: any = null, ready = false, lastTime = 0, isPlaying = false;
  let pending: { ref: string; start: number; autoplay: boolean } | null = null;
  loadVimeo().then((Vimeo) => {
    vp = new Vimeo.Player(container, { id: undefined, controls: true, responsive: false, width: 640 });
    vp.on("play", () => { isPlaying = true; cbs.onPlay(); });
    vp.on("pause", () => { isPlaying = false; cbs.onPause(); });
    vp.on("ended", () => { isPlaying = false; cbs.onEnded(); });
    vp.on("timeupdate", (d: any) => { lastTime = d.seconds || 0; });
    vp.on("seeked", (d: any) => { lastTime = d.seconds || 0; });
    ready = true; cbs.onReady();
    if (pending) { const p = pending; pending = null; api.load(p.ref, p.start, p.autoplay); }
  }).catch(() => {});
  const api: Adapter = {
    kind: "vimeo",
    load: (ref, start, autoplay) => {
      if (!ready) { pending = { ref, start, autoplay }; return; }
      vp.loadVideo(Number(ref)).then(() => { if (start) vp.setCurrentTime(start).catch(() => {}); autoplay ? vp.play().catch(() => {}) : vp.pause().catch(() => {}); }).catch(() => {});
    },
    play: () => vp?.play?.().catch(() => {}), pause: () => vp?.pause?.().catch(() => {}), seek: (s) => { lastTime = s; vp?.setCurrentTime?.(s).catch(() => {}); },
    getTime: () => lastTime, playing: () => isPlaying, isReady: () => ready,
    destroy: () => { try { vp?.destroy?.(); } catch { /* noop */ } container.innerHTML = ""; },
  };
  return api;
}
