// Photo Gallery slideshow — the classic XMB photo viewer: auto-advance with a
// slow Ken Burns drift, arrows to navigate, Esc to leave.
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { PhotoRecord } from "../gamesdb";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import DepthPhoto from "./DepthPhoto";

export default function Photos(props: {
  photos: PhotoRecord[];
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const [idx, setIdx] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const urls = props.photos.map((p) => URL.createObjectURL(p.blob));
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));

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
        <span>←→ browse · <span class="btn-x" /> pause · <span class="btn-o" /> back</span>
      </div>
    </div>
  );
}
