// Video Player — local files on the big screen, PS style. Pick any video you
// own; it plays full-bleed with console controls (✕ play/pause · ←→ seek ·
// △ fullscreen), the audio rides the master bus so the reactive backdrops
// dance to your movie, and the screen holds awake while it plays.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { audioContext, masterBus } from "../audio";
import * as sfx from "../audio";
import type { NavAction } from "../input";
import { holdWakeLock } from "../wakelock";
import { Icon } from "./icons";

export default function VideoPlayer(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [name, setName] = createSignal("");
  const [playing, setPlaying] = createSignal(false);
  const [pos, setPos] = createSignal(0);
  const [dur, setDur] = createSignal(0);
  const [chrome, setChrome] = createSignal(true); // controls fade like a real player
  let fileInput!: HTMLInputElement;
  let video!: HTMLVideoElement;
  let wrap!: HTMLDivElement;
  let url = "";
  let raf = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseLock: (() => void) | null = null;
  let routed = false;

  const poke = () => {
    setChrome(true);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (playing()) setChrome(false); }, 2800);
  };

  function routeAudio() {
    if (routed) return;
    routed = true;
    try {
      const ctx = audioContext();
      ctx.createMediaElementSource(video).connect(masterBus());
    } catch { /* element already routed or ctx blocked — native audio still plays */ }
  }

  function load(f: File) {
    sfx.confirm();
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    video.src = url;
    routeAudio();
    void video.play().then(() => { setPlaying(true); releaseLock ??= holdWakeLock(); }).catch(() => {});
    poke();
    cancelAnimationFrame(raf);
    const tick = () => { raf = requestAnimationFrame(tick); setPos(video.currentTime || 0); };
    raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (!video.src) { fileInput.click(); return; }
    if (video.paused) { void video.play(); setPlaying(true); releaseLock ??= holdWakeLock(); }
    else { video.pause(); setPlaying(false); releaseLock?.(); releaseLock = null; }
    poke();
    sfx.tickV();
  }

  const seek = (d: number) => { if (video.src) { video.currentTime = Math.max(0, Math.min(dur(), video.currentTime + d)); poke(); sfx.tickH(); } };

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void (wrap as any).requestFullscreen?.({ navigationUI: "hide" });
    poke();
  }

  onMount(() => {
    video.addEventListener("loadedmetadata", () => setDur(video.duration || 0));
    video.addEventListener("ended", () => { setPlaying(false); setChrome(true); releaseLock?.(); releaseLock = null; });
    onCleanup(() => {
      cancelAnimationFrame(raf);
      if (hideTimer) clearTimeout(hideTimer);
      video.pause();
      releaseLock?.();
      if (url) URL.revokeObjectURL(url);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    });
  });

  props.bind((a) => {
    if (a === "confirm") toggle();
    if (a === "left") seek(-10);
    if (a === "right") seek(10);
    if (a === "options") fullscreen();
    if (a === "up" || a === "down") poke();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div class="vidapp" ref={wrap} onPointerMove={poke} onClick={() => { if (video.src) toggle(); }}>
      <video ref={video} class="vidapp-video" playsinline />

      <Show when={!name()}>
        <div class="vidapp-empty">
          <div class="vidapp-glyph"><Icon name="film" /></div>
          <div class="ps2-big">Play a video from this device</div>
          <p class="karaoke-note">Any format your browser can decode — it never leaves this machine. The console's backdrops react to its soundtrack.</p>
          <button class="ps2-launch" onClick={(e) => { e.stopPropagation(); fileInput.click(); }}>▶ &nbsp;PICK A VIDEO</button>
        </div>
      </Show>

      <Show when={name()}>
        <div class="vidapp-chrome" classList={{ hidden: !chrome() }} onClick={(e) => e.stopPropagation()}>
          <div class="vidapp-title">{name()}</div>
          <div class="karaoke-seek" onClick={(e) => { if (!dur()) return; const r = e.currentTarget.getBoundingClientRect(); video.currentTime = ((e.clientX - r.left) / r.width) * dur(); poke(); }}>
            <div class="karaoke-seek-fill" style={{ width: `${dur() ? (pos() / dur()) * 100 : 0}%` }} />
          </div>
          <div class="vidapp-bar">
            <span class="karaoke-time">{mmss(pos())} / {mmss(dur())}</span>
            <span class="vidapp-btns">
              <button class="ghost-btn" onClick={() => seek(-10)}>⏴⏴ 10s</button>
              <button class="ghost-btn karaoke-play" onClick={toggle}>{playing() ? "❚❚ pause" : "▶ play"}</button>
              <button class="ghost-btn" onClick={() => seek(10)}>10s ⏵⏵</button>
              <button class="ghost-btn" onClick={fullscreen}>⛶ fullscreen</button>
              <button class="ghost-btn" onClick={() => fileInput.click()}>⏏ change video</button>
            </span>
          </div>
        </div>
      </Show>

      <div class="panel-hint guide-hint vidapp-hint" classList={{ hidden: !chrome() }}>
        <span class="btn-x" /> play/pause · ←→ seek · △ fullscreen · <span class="btn-o" /> back
      </div>
      <input type="file" ref={fileInput} hidden accept="video/*"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) load(f); }} />
    </div>
  );
}
