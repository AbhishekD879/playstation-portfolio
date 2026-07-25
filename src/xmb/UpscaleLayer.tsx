// Puts the upscaled picture where the original one was.
//
// Mounted once by XMB, like ShareBar: it finds the app's main canvas, hides it,
// and pins an upscaled canvas over exactly the same rectangle. Apps stay
// completely unaware — no emulator had to be modified for this, which is the
// only way one feature could cover eight of them.
import { createEffect, on, onCleanup } from "solid-js";
import { findCaptureSource } from "../capture";
import { startUpscale, upscaleSupported, type UpscaleHandle } from "../upscale";
import { upscale } from "../theme";

/** Apps whose main view is a game/video screen worth upscaling. */
const UPSCALE_APPS = new Set([
  "doom", "doomrtx", "flash", "ps2", "cs", "pc", "scummvm",
  "rpgmaker", "renpy", "godot", "unity", "html5",
  "videoplayer", "cinema", "retrojoin", "consoletv",
  "ps2home", "ps1home", "psphome", "retrohome",
]);

export default function UpscaleLayer(props: { app: string | null }) {
  let handle: UpscaleHandle | null = null;
  let hidden: HTMLElement | null = null;
  let ro: ResizeObserver | null = null;
  let raf = 0;

  const teardown = () => {
    cancelAnimationFrame(raf);
    ro?.disconnect(); ro = null;
    handle?.output.remove();
    handle?.stop(); handle = null;
    // always give the original its visibility back, even on an error path —
    // a stuck-invisible emulator is a far worse bug than no upscaling
    if (hidden) { hidden.style.visibility = ""; hidden = null }
  };

  createEffect(on(() => [props.app, upscale()] as const, ([app, mode]) => {
    teardown();
    if (!app || !UPSCALE_APPS.has(app) || mode === "off" || !upscaleSupported()) return;

    let dead = false, tries = 0;
    const arm = async () => {
      if (dead) return;
      const src = findCaptureSource();
      if (!src) { if (++tries < 40) setTimeout(arm, 500); return } // still booting
      const h = await startUpscale(src, mode);
      if (dead || !h) { h?.stop(); return }
      handle = h;

      // ★ Where the overlay goes in the DOM decides whether it covers the app's
      // own UI. Appending to <body> puts it above everything, which hid Console
      // TV's header and live strip. Inserting it as the source's NEXT SIBLING
      // with no z-index makes it paint exactly where the source painted, so all
      // the chrome the app draws over its video keeps working untouched.
      const out = h.output;
      out.className = "upscale-out";
      hidden = src as unknown as HTMLElement;
      // `position: fixed` is only viewport-relative when no ancestor is
      // transformed; under a transform it resolves against that ancestor and
      // our rect maths would be silently offset. Detect it and bail to body.
      let anc: HTMLElement | null = hidden.parentElement;
      let transformed = false;
      while (anc && anc !== document.body) {
        const cs = getComputedStyle(anc);
        if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none") { transformed = true; break }
        anc = anc.parentElement;
      }
      if (transformed || !hidden.parentElement) {
        out.classList.add("upscale-out-detached");
        document.body.appendChild(out);
      } else {
        hidden.parentElement.insertBefore(out, hidden.nextSibling);
      }
      hidden.style.visibility = "hidden";

      const place = () => {
        const r = (hidden as HTMLElement).getBoundingClientRect();
        out.style.left = `${r.left}px`;
        out.style.top = `${r.top}px`;
        out.style.width = `${r.width}px`;
        out.style.height = `${r.height}px`;
      };
      place();
      // rAF-follow rather than resize/scroll listeners: emulators resize their
      // canvas from inside their own loop, with no event we could hook.
      const follow = () => { if (!dead) { place(); raf = requestAnimationFrame(follow) } };
      raf = requestAnimationFrame(follow);
      ro = new ResizeObserver(place);
      ro.observe(hidden);
    };
    void arm();
    onCleanup(() => { dead = true });
  }));

  onCleanup(teardown);
  return null;
}
