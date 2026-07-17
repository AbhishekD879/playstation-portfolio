// Karaoke — load any song you own and sing it yourself. Vocals are removed
// with the classic DSP trick: studio vocals sit dead-center in the stereo
// field, so subtracting the channels (L−R) cancels them while the band plays
// on. Bass is center-panned too, so a low-pass of the original is mixed back
// underneath. A slider blends between the full song and the karaoke cut.
// Runs on the console's master audio bus — the Visualizer and the Reactive
// backgrounds pulse along with it. Everything local; nothing is uploaded.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { audioContext, masterBus } from "../audio";
import * as sfx from "../audio";
import type { NavAction } from "../input";

export default function Karaoke(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [name, setName] = createSignal("");
  const [playing, setPlaying] = createSignal(false);
  const [cut, setCut] = createSignal(0.9); // 0 = full song, 1 = full vocal cut
  const [pos, setPos] = createSignal(0);
  const [dur, setDur] = createSignal(0);
  let fileInput!: HTMLInputElement;
  let audio: HTMLAudioElement | null = null;
  let url = "";
  let wet: GainNode | null = null;
  let dry: GainNode | null = null;
  let raf = 0;

  function buildGraph(el: HTMLAudioElement) {
    const ctx = audioContext();
    const src = ctx.createMediaElementSource(el);

    // dry path: the untouched song
    dry = ctx.createGain();
    src.connect(dry);

    // wet path: karaoke cut = (L − R) + low-passed original bass
    wet = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    src.connect(split);
    const inv = ctx.createGain();
    inv.gain.value = -1;
    const sum = ctx.createGain();
    sum.gain.value = 0.9;
    split.connect(sum, 0);            // L
    split.connect(inv, 1); inv.connect(sum); // −R → vocals (center) cancel
    sum.connect(wet);
    const bass = ctx.createBiquadFilter();
    bass.type = "lowpass";
    bass.frequency.value = 130;       // keep the (centered) bass under the cut
    src.connect(bass);
    bass.connect(wet);

    dry.connect(masterBus());
    wet.connect(masterBus());
    applyMix();
  }

  function applyMix() {
    if (!wet || !dry) return;
    const k = cut();
    wet.gain.value = k;
    dry.gain.value = 1 - k;
  }

  function load(f: File) {
    sfx.confirm();
    stop();
    url = URL.createObjectURL(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => setDur(audio!.duration || 0));
    audio.addEventListener("ended", () => setPlaying(false));
    buildGraph(audio);
    void audio.play().then(() => setPlaying(true)).catch(() => {});
    const tick = () => { raf = requestAnimationFrame(tick); if (audio) setPos(audio.currentTime); };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (!audio) { fileInput.click(); return; }
    if (audio.paused) { void audio.play(); setPlaying(true); }
    else { audio.pause(); setPlaying(false); }
    sfx.tickV();
  }

  function seek(delta: number) {
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(dur(), audio.currentTime + delta));
    sfx.tickH();
  }

  function stop() {
    cancelAnimationFrame(raf);
    audio?.pause();
    audio = null;
    if (url) { URL.revokeObjectURL(url); url = ""; }
    setPlaying(false); setPos(0); setDur(0);
  }

  onMount(() => onCleanup(stop));

  props.bind((a) => {
    if (a === "confirm") toggle();
    if (a === "left") seek(-5);
    if (a === "right") seek(5);
    if (a === "up") { setCut(Math.min(1, cut() + 0.1)); applyMix(); sfx.tickV(); }
    if (a === "down") { setCut(Math.max(0, cut() - 0.1)); applyMix(); sfx.tickV(); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div class="karaoke">
      <div class="guide-head">
        <div class="panel-tag">KARAOKE — VOCALS OUT, YOU IN</div>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>
      <div class="karaoke-stage">
        <Show
          when={name()}
          fallback={
            <div class="karaoke-empty">
              <div class="karaoke-mic">🎤</div>
              <div class="ps2-big">Drop in a song you own</div>
              <p class="karaoke-note">Studio vocals sit center-stage in the stereo mix — the console cancels them live and leaves the band playing. Works best on stereo studio recordings.</p>
              <button class="ps2-launch" onClick={() => fileInput.click()}>♪ &nbsp;PICK A SONG</button>
            </div>
          }
        >
          <div class="karaoke-now">
            <div class="karaoke-title">{name()}</div>
            <div class="karaoke-time">{mmss(pos())} / {mmss(dur())}</div>
            <div class="karaoke-seek" onClick={(e) => { if (!audio || !dur()) return; const r = e.currentTarget.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * dur(); }}>
              <div class="karaoke-seek-fill" style={{ width: `${dur() ? (pos() / dur()) * 100 : 0}%` }} />
            </div>
            <div class="karaoke-controls">
              <button class="ghost-btn" onClick={() => seek(-10)}>⏪ 10s</button>
              <button class="ghost-btn karaoke-play" onClick={toggle}>{playing() ? "⏸ pause" : "▶ sing"}</button>
              <button class="ghost-btn" onClick={() => seek(10)}>10s ⏩</button>
              <button class="ghost-btn" onClick={() => fileInput.click()}>♪ change song</button>
            </div>
            <div class="karaoke-mix">
              <span class="karaoke-mix-label">FULL SONG</span>
              <input type="range" min="0" max="100" value={Math.round(cut() * 100)}
                onInput={(e) => { setCut(+e.currentTarget.value / 100); applyMix(); }} />
              <span class="karaoke-mix-label">VOCALS CUT</span>
            </div>
          </div>
        </Show>
      </div>
      <div class="panel-hint guide-hint"><span class="btn-x" /> play/pause · ←→ seek · ↑↓ vocal cut · <span class="btn-o" /> back</div>
      <input type="file" ref={fileInput} hidden accept="audio/*"
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) load(f); }} />
    </div>
  );
}
