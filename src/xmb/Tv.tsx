// Live TV player — HLS streams via hls.js (native HLS on Safari).
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import Hls from "hls.js";

export default function Tv(props: { url: string; label: string; onClose: () => void }) {
  const [state, setState] = createSignal<"tuning" | "live" | "offline">("tuning");
  const [quality, setQuality] = createSignal("");
  let video!: HTMLVideoElement;
  let hls: Hls | null = null;

  onMount(() => {
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = props.url;
      video.play().catch(() => {});
      video.onplaying = () => setState("live");
      video.onerror = () => setState("offline");
    } else if (Hls.isSupported()) {
      // generous startup bandwidth estimate so ABR starts near the top rung
      // instead of the 240p ramp-up crawl
      hls = new Hls({ maxBufferLength: 20, abrEwmaDefaultEstimate: 4_500_000 });
      hls.loadSource(props.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        const h = hls?.levels[data.level]?.height;
        if (h) setQuality(`${h}p`);
      });
      video.onplaying = () => setState("live");
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setState("offline");
      });
    } else {
      setState("offline");
    }
    onCleanup(() => {
      hls?.destroy();
      video.src = "";
    });
  });

  return (
    <div class="tv">
      <video ref={video} class="tv-video" muted={false} playsinline controls={false} />
      <div class="tv-chrome">
        <div class="tv-label">
          <span class="tv-live" classList={{ on: state() === "live" }}>● {state() === "live" ? "LIVE" : state() === "tuning" ? "TUNING" : "OFFLINE"}</span>
          {props.label}
          <Show when={quality()}><span class="tv-quality">{quality()}</span></Show>
        </div>
        <button class="ps-act" onClick={props.onClose}><span class="btn-o" /> back</button>
      </div>
      <Show when={state() === "tuning"}>
        <div class="tv-msg">Tuning in…</div>
      </Show>
      <Show when={state() === "offline"}>
        <div class="tv-msg">
          <div class="tv-msg-big">📡 Channel offline</div>
          <div>This stream isn't answering right now — public feeds come and go. Try another channel.</div>
        </div>
      </Show>
    </div>
  );
}
