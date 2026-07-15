// Time Machine — browse the old web. Type any site, pick a year, and the
// Wayback Machine serves the nearest snapshot straight into the console.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { setNavEnabled } from "../input";

const YEARS = Array.from({ length: new Date().getFullYear() - 1996 + 1 }, (_, i) => 1996 + i);

export default function TimeMachine(props: { onClose: () => void }) {
  const [year, setYear] = createSignal(2003);
  const [dest, setDest] = createSignal<string | null>(null);
  let input!: HTMLInputElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); });
    setTimeout(() => input?.focus(), 60);
  });

  function go() {
    let url = input.value.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) url = "http://" + url;
    sfx.confirm();
    setDest(`https://web.archive.org/web/${year()}0615/${url}`);
  }

  return (
    <div class="tm">
      <Show
        when={!dest()}
        fallback={
          <div class="fullapp">
            <iframe credentialless={true} class="fullapp-frame" src={dest()!} title="Time Machine" />
            <button class="session-eject" onClick={() => { sfx.back(); setDest(null); }}>⏏ RETURN TO {year()}… ER, NOW</button>
          </div>
        }
      >
        <div class="tm-console">
          <div class="panel-tag">TIME MACHINE — POWERED BY THE WAYBACK MACHINE</div>
          <div class="tm-title">Browse the old web</div>
          <input
            ref={input}
            class="modal-input tm-input"
            placeholder="apple.com · yahoo.com · geocities.com · your-first-website.com"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") go();
              if (e.key === "ArrowLeft") { setYear(Math.max(YEARS[0], year() - 1)); sfx.tickH(); }
              if (e.key === "ArrowRight") { setYear(Math.min(YEARS.at(-1)!, year() + 1)); sfx.tickH(); }
              if (e.key === "Escape") { sfx.back(); props.onClose(); }
            }}
          />
          <div class="tm-year">
            <span class="tm-arrow" onClick={() => { setYear(Math.max(YEARS[0], year() - 1)); sfx.tickH(); }}>◀</span>
            <span class="tm-year-num">{year()}</span>
            <span class="tm-arrow" onClick={() => { setYear(Math.min(YEARS.at(-1)!, year() + 1)); sfx.tickH(); }}>▶</span>
          </div>
          <div class="modal-hint">←→ pick the year · ENTER — engage · Esc — stay in the present</div>
        </div>
      </Show>
    </div>
  );
}
