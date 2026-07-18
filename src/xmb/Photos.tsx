// Photo Gallery slideshow — the classic XMB photo viewer: auto-advance with a
// slow Ken Burns drift, arrows to navigate, Esc to leave. ◈ Enhance runs
// on-device ×2 super-resolution; ◈ Cutout lifts the subject off the
// background (RMBG); ◈ Isolate keeps only what you click (SlimSAM). All three
// save results as new photos. △ (pressed twice) deletes a photo for good.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { addPhoto, removePhoto, type PhotoRecord } from "../gamesdb";
import { labEnabled } from "../labs";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import DepthPhoto from "./DepthPhoto";
import { upscale, type EnhanceProgress } from "../enhance";
import { cutout, isolate, type CutProgress } from "../cutout";

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
  const [job, setJob] = createSignal<"" | "working" | "done" | "failed">(""); // cutout/isolate
  const [jobKind, setJobKind] = createSignal<"cutout" | "isolate">("cutout");
  const [jprog, setJprog] = createSignal<CutProgress | null>(null);
  const [picking, setPicking] = createSignal(false); // isolate: waiting for the click
  const [armDelete, setArmDelete] = createSignal(false); // first press arms, second deletes
  let disarm: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => slides().forEach((s) => URL.revokeObjectURL(s.url)));

  const n = () => slides().length;
  const current = () => slides()[idx()];
  const busy = () => enhancing() === "working" || job() === "working";

  async function enhance() {
    const s = current();
    if (!s || busy()) return;
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

  async function runCut(kind: "cutout" | "isolate", pt?: [number, number]) {
    const s = current();
    if (!s || busy()) return;
    sfx.confirm();
    setJobKind(kind);
    setJob("working");
    setJprog(null);
    setPaused(true);
    try {
      const out = kind === "cutout" ? await cutout(s.p.blob, setJprog) : await isolate(s.p.blob, pt!, setJprog);
      await addPhoto({
        id: crypto.randomUUID(),
        profileId: s.p.profileId,
        name: s.p.name.replace(/(\.[^.]+)?$/, kind === "cutout" ? " (cutout)$1" : " (isolated)$1"),
        addedAt: Date.now(),
        blob: out,
      });
      setJob("done");
      props.onChanged?.();
      setTimeout(() => setJob(""), 3500);
    } catch {
      setJob("failed");
      setTimeout(() => setJob(""), 3500);
    } finally {
      setJprog(null);
    }
  }

  // isolate: turn the click into image-space coordinates (object-fit: contain)
  function pickPoint(e: MouseEvent) {
    const s = current();
    // measure BEFORE de-arming — setPicking(false) unmounts the overlay synchronously
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPicking(false);
    if (!s || !r.width || !r.height) return;
    const im = new Image();
    im.onload = () => {
      // ponytail: assumes the ken-burns drift has settled at scale(1.06)
      const kb = 1.06;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const clickX = cx + (e.clientX - cx) / kb, clickY = cy + (e.clientY - cy) / kb;
      const scale = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
      const ox = r.left + (r.width - im.naturalWidth * scale) / 2;
      const oy = r.top + (r.height - im.naturalHeight * scale) / 2;
      const px = (clickX - ox) / scale, py = (clickY - oy) / scale;
      if (px < 0 || py < 0 || px > im.naturalWidth || py > im.naturalHeight) { sfx.deny(); return; }
      void runCut("isolate", [Math.round(px), Math.round(py)]);
    };
    im.onerror = () => sfx.deny();
    im.src = s.url;
  }

  const jobText = (kind: "cutout" | "isolate", idle: string) => {
    if (jobKind() !== kind || !job()) return idle;
    if (job() === "working") {
      const p = jprog();
      return p?.phase === "download" ? `◈ fetching the model · ${p.pct}%` : p ? `◈ working · ${p.pct}%` : "◈ warming up…";
    }
    return job() === "done" ? "◈ saved to your gallery" : "◈ couldn't do this one";
  };

  // △ / the button: press once to arm, again within 3s to actually delete
  async function del() {
    if (busy()) return;
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
    if (picking()) { if (a === "back") { setPicking(false); sfx.back(); } return; }
    if (a === "left") move(-1);
    if (a === "right") move(1);
    if (a === "confirm") { setPaused(!paused()); sfx.tickV(); }
    if (a === "options") void del();
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="photos" onClick={() => move(1)}>
      {/* PS-style loading strip while a model works */}
      <Show when={busy()}>
        <div class="enhance-strip"><div class="enhance-strip-fill" style={{ width: `${(enhancing() === "working" ? prog()?.pct : jprog()?.pct) ?? 2}%` }} /></div>
      </Show>
      {/* keyed so the ken-burns animation restarts per slide */}
      <Show when={current()} keyed>
        {(s) => <DepthPhoto class="photos-img" src={s.url} alt="" />}
      </Show>
      {/* Click-to-Mask: one click picks the subject to keep */}
      <Show when={picking()}>
        <div class="photos-pick" onClick={(e) => { e.stopPropagation(); pickPoint(e); }}>
          <div class="photos-pick-hint">CLICK THE THING TO KEEP · ◯ CANCEL</div>
        </div>
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
          <Show when={labEnabled("cutout")}>
          <button class="ghost-btn photos-enhance" disabled={busy()}
            onClick={(e) => { e.stopPropagation(); void runCut("cutout"); }}>
            {jobText("cutout", "◈ cutout")}
          </button>
          </Show>
          <Show when={labEnabled("clickmask")}>
          <button class="ghost-btn photos-enhance" disabled={busy()}
            onClick={(e) => { e.stopPropagation(); setPicking(true); setPaused(true); sfx.tickV(); }}>
            {picking() ? "◈ click the subject…" : jobText("isolate", "◈ isolate")}
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
