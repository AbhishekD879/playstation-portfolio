// Photo Gallery slideshow — the classic XMB photo viewer: auto-advance with a
// slow Ken Burns drift, arrows to navigate, Esc to leave. ◈ Enhance runs
// on-device ×2 super-resolution and saves the result as a new photo; △ (or the
// delete button, pressed twice) removes a photo from the library for good.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { addPhoto, removePhoto, type PhotoRecord } from "../gamesdb";
import { labEnabled } from "../labs";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import DepthPhoto from "./DepthPhoto";
import { upscale, type EnhanceProgress } from "../enhance";

export default function Photos(props: {
  photos: PhotoRecord[];
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
  onChanged?: () => void;
}) {
  // the slideshow owns its list so deletions take effect instantly
  const [slides, setSlides] = createSignal(props.photos.map((p) => ({ p, url: URL.createObjectURL(p.blob) })));
  const [idx, setIdx] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [enhancing, setEnhancing] = createSignal<"" | "working" | "done" | "failed">("");
  const [prog, setProg] = createSignal<EnhanceProgress | null>(null);
  const [armDelete, setArmDelete] = createSignal(false); // first press arms, second deletes
  let disarm: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => slides().forEach((s) => URL.revokeObjectURL(s.url)));

  const n = () => slides().length;
  const current = () => slides()[idx()];

  async function enhance() {
    const s = current();
    if (!s || enhancing() === "working") return;
    sfx.confirm();
    setEnhancing("working");
    setProg(null);
    setPaused(true); // hold the slide while the model works
    try {
      const out = await upscale(s.p.blob, setProg);
      await addPhoto({
        id: crypto.randomUUID(),
        profileId: s.p.profileId,
        name: s.p.name.replace(/(\.[^.]+)?$/, " (enhanced)$1"),
        addedAt: Date.now(),
        blob: out,
      });
      setEnhancing("done");
      props.onChanged?.();
      setTimeout(() => setEnhancing(""), 3500);
    } catch {
      setEnhancing("failed");
      setTimeout(() => setEnhancing(""), 3500);
    } finally {
      setProg(null);
    }
  }

  // △ / the button: press once to arm, again within 3s to actually delete
  async function del() {
    if (enhancing() === "working") return;
    if (!armDelete()) {
      setArmDelete(true);
      sfx.tickV();
      if (disarm) clearTimeout(disarm);
      disarm = setTimeout(() => setArmDelete(false), 3000);
      return;
    }
    if (disarm) clearTimeout(disarm);
    setArmDelete(false);
    const s = current();
    if (!s) return;
    try {
      await removePhoto(s.p.id);
      URL.revokeObjectURL(s.url);
      const rest = slides().filter((x) => x !== s);
      setSlides(rest);
      props.onChanged?.();
      sfx.back();
      if (!rest.length) { props.onClose(); return; }
      setIdx(Math.min(idx(), rest.length - 1));
    } catch {
      sfx.deny();
    }
  }

  const move = (d: number) => {
    if (!n()) return;
    setIdx((idx() + d + n()) % n());
    setArmDelete(false);
    sfx.tickH();
  };

  let timer: ReturnType<typeof setInterval>;
  onMount(() => {
    timer = setInterval(() => { if (!paused() && n()) setIdx((i) => (i + 1) % n()); }, 5200);
    onCleanup(() => { clearInterval(timer); if (disarm) clearTimeout(disarm); });
  });

  props.bind((a) => {
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "confirm") { setPaused(!paused()); sfx.tickV(); }
    if (a === "options") void del();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="photos" onClick={() => move(1)}>
      {/* PS-style loading strip while the enhancer works */}
      <Show when={enhancing() === "working"}>
        <div class="enhance-strip"><div class="enhance-strip-fill" style={{ width: `${prog()?.pct ?? 2}%` }} /></div>
      </Show>
      {/* keyed so the ken-burns animation restarts per slide */}
      <Show when={current()} keyed>
        {(s) => <DepthPhoto class="photos-img" src={s.url} alt="" />}
      </Show>
      <div class="photos-chrome">
        <span>{idx() + 1} / {n()}{paused() ? " · paused" : ""}</span>
        <span>
          <Show when={labEnabled("enhance")}>
          <button class="ghost-btn photos-enhance" disabled={enhancing() === "working"}
            onClick={(e) => { e.stopPropagation(); enhance(); }}>
            {enhancing() === "working"
              ? (prog()?.phase === "download" ? `◈ fetching the model · ${prog()!.pct}%`
                : prog() ? `◈ enhancing · ${prog()!.pct}%`
                : "◈ warming up…")
              : enhancing() === "done" ? "◈ saved to your gallery"
              : enhancing() === "failed" ? "◈ couldn't enhance this one"
              : "◈ enhance ×2"}
          </button>
          </Show>
          <button class="ghost-btn photos-enhance" classList={{ "photos-del-armed": armDelete() }}
            onClick={(e) => { e.stopPropagation(); void del(); }}>
            {armDelete() ? "△ sure? press again" : "△ delete"}
          </button>
          {" "}←→ browse · <span class="btn-x" /> pause · △ delete · <span class="btn-o" /> back
        </span>
      </div>
    </div>
  );
}
