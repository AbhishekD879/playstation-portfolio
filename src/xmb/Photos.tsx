// Photo Gallery slideshow — the classic XMB photo viewer: auto-advance with a
// slow Ken Burns drift, arrows to navigate, Esc to leave. ✨ Enhance runs
// on-device ×2 super-resolution and saves the result as a new photo.
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { addPhoto, type PhotoRecord } from "../gamesdb";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import DepthPhoto from "./DepthPhoto";
import { upscale } from "../enhance";

export default function Photos(props: {
  photos: PhotoRecord[];
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  onEnhanced?: () => void;
}) {
  const [idx, setIdx] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [enhancing, setEnhancing] = createSignal<"" | "working" | "done" | "failed">("");
  const urls = props.photos.map((p) => URL.createObjectURL(p.blob));
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));

  async function enhance() {
    const p = props.photos[idx()];
    if (!p || enhancing() === "working") return;
    sfx.confirm();
    setEnhancing("working");
    setPaused(true); // hold the slide while the model works
    try {
      const out = await upscale(p.blob);
      await addPhoto({
        id: crypto.randomUUID(),
        profileId: p.profileId,
        name: p.name.replace(/(\.[^.]+)?$/, " (enhanced)$1"),
        addedAt: Date.now(),
        blob: out,
      });
      setEnhancing("done");
      props.onEnhanced?.();
      setTimeout(() => setEnhancing(""), 3500);
    } catch {
      setEnhancing("failed");
      setTimeout(() => setEnhancing(""), 3500);
    }
  }

  const n = () => props.photos.length;
  const move = (d: number) => {
    setIdx((idx() + d + n()) % n());
    sfx.tickH();
  };

  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => { if (!paused()) setIdx((i) => (i + 1) % n()); }, 5200);
    onCleanup(() => clearInterval(timer));
  });

  props.bind((a) => {
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "confirm") { setPaused(!paused()); sfx.tickV(); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="photos" onClick={() => move(1)}>
      {/* keyed so the ken-burns animation restarts per slide */}
      <Show when={urls[idx()]} keyed>
        {(u) => <DepthPhoto class="photos-img" src={u} alt="" />}
      </Show>
      <div class="photos-chrome">
        <span>{idx() + 1} / {n()}{paused() ? " · paused" : ""}</span>
        <span>
          <button class="ghost-btn photos-enhance" disabled={enhancing() === "working"}
            onClick={(e) => { e.stopPropagation(); enhance(); }}>
            {enhancing() === "working" ? "✨ enhancing… (on-device AI)"
              : enhancing() === "done" ? "✨ saved to your gallery"
              : enhancing() === "failed" ? "✨ couldn't enhance this one"
              : "✨ enhance ×2"}
          </button>
          {" "}←→ browse · <span class="btn-x" /> pause · <span class="btn-o" /> back
        </span>
      </div>
    </div>
  );
}
