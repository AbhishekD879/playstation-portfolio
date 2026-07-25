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
import { holdWakeLock } from "../wakelock";
import { Icon } from "./icons";
import { SingScore, centsOff, hzToMidi, noteName, rankFor, trackPitch, type PitchTap } from "../pitch";

export default function Karaoke(props: { onClose: () => void; bind: (nav: (a: NavAction) => void) => void }) {
  const [name, setName] = createSignal("");
  const [playing, setPlaying] = createSignal(false);
  const [cut, setCut] = createSignal(0.9); // 0 = full song, 1 = full vocal cut
  const [pos, setPos] = createSignal(0);
  const [dur, setDur] = createSignal(0);
  let fileInput!: HTMLInputElement;
  let audio: HTMLAudioElement | null = null;
  let lastFile: File | null = null;
  let url = "";
  let wet: GainNode | null = null;
  let dry: GainNode | null = null;
  let raf = 0;

  // —— scoring ————————————————————————————————————————————————————————————
  // The reference melody is extracted from the song itself: the karaoke cut is
  // (L−R), so the vocal is what that cut REMOVES — the centre channel. Tracking
  // pitch on a high-passed centre gives a target line for any song, with no
  // note chart to author. That's the only reason "drop in any file" can score.
  const [scoring, setScoring] = createSignal(false);
  const [micErr, setMicErr] = createSignal("");
  const [live, setLive] = createSignal<{ sung: number | null; target: number | null; cents: number }>(
    { sung: null, target: null, cents: 0 },
  );
  const [pct, setPct] = createSignal(0);
  const [streak, setStreak] = createSignal(0);
  const score = new SingScore();
  let micTap: PitchTap | null = null;
  let refTap: PitchTap | null = null;
  let micStream: MediaStream | null = null;
  let ribbon: HTMLCanvasElement | undefined;
  // rolling history for the ribbon: newest last
  const trail: { sung: number | null; target: number | null }[] = [];
  const TRAIL = 220;

  // —— real (model) vocal separation ————————————————————————————————————
  // The L−R trick above is instant but crude. This runs a Spleeter U-Net and
  // gives a genuine split, which buys two things: the band survives the vocal
  // removal intact, AND the isolated vocal becomes a far cleaner pitch
  // reference than a high-passed centre channel could ever be.
  const [stemState, setStemState] = createSignal<"off" | "working" | "ready" | "failed">("off");
  const [stemNote, setStemNote] = createSignal("");
  let stemAccomp: AudioBuffer | null = null;
  let stemVocals: AudioBuffer | null = null;
  let srcA: AudioBufferSourceNode | null = null;   // accompaniment (audible)
  let srcV: AudioBufferSourceNode | null = null;   // vocals (silent; pitch reference)
  let bufStartedAt = 0;   // ctx.currentTime when the pair started
  let bufOffset = 0;      // where in the song that start corresponded to
  let bufPlaying = false;

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

    // The vocal reference tap. (L+R)/2 is the centre channel — vocals plus
    // bass and kick — so a high-pass at 160 Hz drops the rhythm section and
    // leaves something YIN can lock onto. Never connected to any output: this
    // is analysis only and must not colour what the singer hears.
    const mid = ctx.createGain();
    mid.gain.value = 0.5;
    split.connect(mid, 0);
    split.connect(mid, 1);
    const voxHP = ctx.createBiquadFilter();
    voxHP.type = "highpass";
    voxHP.frequency.value = 160;
    mid.connect(voxHP);
    refSource = voxHP;

    applyMix();
  }
  let refSource: AudioNode | null = null;

  // —— stem transport ——
  // AudioBufferSourceNodes can't pause, so "pause" means stop and remember
  // where we were; "play" means build a fresh pair from that offset. Both
  // sources always start on the same timestamp, so they can't drift apart.
  function stopBuffers() {
    // Detach BEFORE stopping: stop() fires onended asynchronously, and by the
    // time it lands a seek has usually already started a new pair — the stale
    // handler would then park the freshly-started playback at the end.
    if (srcA) srcA.onended = null;
    try { srcA?.stop(); srcV?.stop() } catch { /* not started */ }
    srcA = srcV = null;
    bufPlaying = false;
  }

  function playBuffers(offset: number) {
    if (!stemAccomp || !stemVocals) return;
    const ctx = audioContext();
    stopBuffers();
    // pressing play at the very end restarts, the way a finished track should
    const dur2 = stemAccomp.duration;
    bufOffset = offset >= dur2 - 0.1 ? 0 : Math.max(0, Math.min(dur2 - 0.05, offset));
    srcA = ctx.createBufferSource(); srcA.buffer = stemAccomp;
    srcV = ctx.createBufferSource(); srcV.buffer = stemVocals;
    srcA.connect(masterBus());
    // the vocal stem is analysed, never heard — that's the whole point
    const mute = ctx.createGain(); mute.gain.value = 0;
    srcV.connect(mute); mute.connect(ctx.destination);
    refSource = srcV;
    // re-point an already-running pitch tap at the new source
    if (scoring()) { refTap?.stop(); void trackPitch(ctx, srcV).then((t) => { refTap = t }) }
    const at = ctx.currentTime + 0.05;
    srcA.start(at, bufOffset);
    srcV.start(at, bufOffset);
    bufStartedAt = at;
    bufPlaying = true;
    // Park the playhead at the END when the track finishes. Leaving bufOffset
    // where playback STARTED made a finished song jump back to wherever you
    // last hit play, which reads as the transport being broken.
    srcA.onended = () => {
      if (!bufPlaying) return;              // a stop()/seek supersedes this
      bufPlaying = false;
      bufOffset = dur2;
      setPos(dur2);
      setPlaying(false);
    };
    setPlaying(true);
  }

  const bufPos = () =>
    bufPlaying ? Math.max(0, audioContext().currentTime - bufStartedAt) + bufOffset : bufOffset;

  async function runSeparation() {
    if (!audio || stemState() === "working") return;
    const file = lastFile;
    if (!file) { setStemNote("load a song first"); return }
    setStemState("working");
    setStemNote("starting…");
    try {
      const ctx = audioContext();
      await ctx.resume().catch(() => {});
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      const { separateStems } = await import("../stems");
      const out = await separateStems(ctx, decoded, (p) => {
        const label = p.stage === "model" ? "downloading the model" : p.stage === "analyse" ? "analysing"
          : p.stage === "separate" ? "separating" : "rebuilding audio";
        setStemNote(`${label} — ${p.pct}%`);
      });
      stemVocals = out.vocals;
      stemAccomp = out.accompaniment;
      // hand playback over from the <audio> element to the stems
      const at = audio.currentTime;
      audio.pause();
      if (dry) dry.gain.value = 0;
      if (wet) wet.gain.value = 0;
      setStemState("ready");
      setStemNote("");
      setDur(stemAccomp.duration);
      playBuffers(at);
      sfx.confirm();
    } catch (e) {
      setStemState("failed");
      setStemNote(`couldn't separate that track — ${String((e as Error)?.message ?? e).slice(0, 90)}`);
    }
  }

  async function startScoring() {
    if (scoring()) return;
    setMicErr("");
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        // every one of these would fight a pitch tracker: AGC pumps the level,
        // noise suppression eats sustained tones, and echo cancellation would
        // try to remove the backing track we WANT bleeding in
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setMicErr("no microphone — allow mic access to be scored");
      return;
    }
    const ctx = audioContext();
    await ctx.resume().catch(() => {});
    const mic = ctx.createMediaStreamSource(micStream);
    micTap = await trackPitch(ctx, mic);
    if (refSource) refTap = await trackPitch(ctx, refSource);
    if (!micTap) { setMicErr("this browser can't run the pitch tracker"); stopScoring(); return }
    score.reset();
    trail.length = 0;
    setScoring(true);
    sfx.confirm();
  }

  function stopScoring() {
    micTap?.stop(); micTap = null;
    refTap?.stop(); refTap = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    setScoring(false);
  }

  /** One scoring frame — called from the same rAF that drives the position. */
  function sampleVoice() {
    if (!scoring()) return;
    const m = micTap?.latest();
    const r = refTap?.latest();
    // clarity gate: YIN reports a number even for noise, and an unfiltered
    // reading turns breath and cymbals into "notes"
    const sung = m && m.hz > 0 && m.clarity > 0.6 ? hzToMidi(m.hz) : null;
    const target = r && r.hz > 0 && r.clarity > 0.55 ? hzToMidi(r.hz) : null;
    score.push(sung, target);
    setPct(score.percent);
    setStreak(score.currentStreak);
    setLive({ sung, target, cents: sung !== null && target !== null ? centsOff(sung, target) : 0 });
    trail.push({ sung, target });
    if (trail.length > TRAIL) trail.shift();
    drawRibbon();
  }

  function drawRibbon() {
    const c = ribbon;
    if (!c) return;
    const w = c.width, h = c.height;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);

    // Fold everything into one octave. Absolute pitch would send the line off
    // the top the moment someone sings in a different register than the
    // original — and by our own scoring rules that's a correct performance.
    const y = (midi: number) => h - (((midi % 12) + 12) % 12) / 12 * h;
    const step = w / TRAIL;

    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.lineWidth = 1;
    for (let i = 0; i <= 12; i += 3) {
      const yy = h - (i / 12) * h;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke();
    }

    const tint = getComputedStyle(document.documentElement).getPropertyValue("--xmb-tint").trim() || "#4a7fc8";
    // the original's line, drawn first so the singer's sits on top of it
    g.lineWidth = 5; g.lineCap = "round"; g.strokeStyle = "rgba(255,255,255,0.22)";
    trail.forEach((p, i) => {
      if (p.target === null) return;
      const x = i * step;
      g.beginPath(); g.moveTo(x, y(p.target)); g.lineTo(x + step, y(p.target)); g.stroke();
    });
    // the singer, coloured by whether it's a hit
    g.lineWidth = 3;
    trail.forEach((p, i) => {
      if (p.sung === null) return;
      const hit = p.target !== null && Math.abs(centsOff(p.sung, p.target)) < 100;
      g.strokeStyle = hit ? tint : "rgba(255,138,61,0.85)";
      const x = i * step;
      g.beginPath(); g.moveTo(x, y(p.sung)); g.lineTo(x + step, y(p.sung)); g.stroke();
    });
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
    lastFile = f;
    url = URL.createObjectURL(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => setDur(audio!.duration || 0));
    audio.addEventListener("ended", () => setPlaying(false));
    buildGraph(audio);
    void audio.play().then(() => setPlaying(true)).catch(() => {});
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (stemState() === "ready") setPos(bufPos());
      else if (audio) setPos(audio.currentTime);
      sampleVoice();
    };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (stemState() === "ready") {
      if (bufPlaying) { const at = bufPos(); stopBuffers(); bufOffset = at; setPlaying(false); }
      else playBuffers(bufOffset);
      sfx.tickV();
      return;
    }
    if (!audio) { fileInput.click(); return; }
    if (audio.paused) { void audio.play(); setPlaying(true); }
    else { audio.pause(); setPlaying(false); }
    sfx.tickV();
  }

  function seek(delta: number) {
    if (stemState() === "ready") {
      const at = Math.max(0, Math.min(dur(), bufPos() + delta));
      if (bufPlaying) playBuffers(at); else bufOffset = at;
      setPos(at);
      sfx.tickH();
      return;
    }
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(dur(), audio.currentTime + delta));
    sfx.tickH();
  }

  /** Absolute seek — used by the scrub bar, which both modes share. */
  function seekTo(t: number) {
    if (stemState() === "ready") {
      const at = Math.max(0, Math.min(dur(), t));
      if (bufPlaying) playBuffers(at); else bufOffset = at;
      setPos(at);
      return;
    }
    if (audio) audio.currentTime = Math.max(0, Math.min(dur(), t));
  }

  function stop() {
    cancelAnimationFrame(raf);
    stopScoring();
    stopBuffers();
    stemAccomp = stemVocals = null;
    setStemState("off"); setStemNote("");
    refSource = null;
    audio?.pause();
    audio = null;
    if (url) { URL.revokeObjectURL(url); url = ""; }
    setPlaying(false); setPos(0); setDur(0);
  }

  onMount(() => {
    const releaseLock = holdWakeLock(); // singers don't want the screen dimming mid-verse
    onCleanup(() => { releaseLock(); stop(); });
  });

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
              <div class="karaoke-mic"><Icon name="mic" /></div>
              <div class="ps2-big">Drop in a song you own</div>
              <p class="karaoke-note">Studio vocals sit center-stage in the stereo mix — the console cancels them live and leaves the band playing. Works best on stereo studio recordings.</p>
              <button class="ps2-launch" onClick={() => fileInput.click()}>▶ &nbsp;PICK A SONG</button>
            </div>
          }
        >
          <div class="karaoke-now">
            <div class="karaoke-title">{name()}</div>
            <div class="karaoke-time">{mmss(pos())} / {mmss(dur())}</div>
            <div class="karaoke-seek" onClick={(e) => { if (!dur()) return; const r = e.currentTarget.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * dur()); }}>
              <div class="karaoke-seek-fill" style={{ width: `${dur() ? (pos() / dur()) * 100 : 0}%` }} />
            </div>
            <div class="karaoke-controls">
              <button class="ghost-btn" onClick={() => seek(-10)}>⏴⏴ 10s</button>
              <button class="ghost-btn karaoke-play" onClick={toggle}>{playing() ? "❚❚ pause" : "▶ sing"}</button>
              <button class="ghost-btn" onClick={() => seek(10)}>10s ⏵⏵</button>
              <button class="ghost-btn" onClick={() => fileInput.click()}>⏏ change song</button>
            </div>
            <Show when={stemState() !== "ready"}>
              <div class="karaoke-mix">
                <span class="karaoke-mix-label">FULL SONG</span>
                <input type="range" min="0" max="100" value={Math.round(cut() * 100)}
                  onInput={(e) => { setCut(+e.currentTarget.value / 100); applyMix(); }} />
                <span class="karaoke-mix-label">VOCALS CUT</span>
              </div>
            </Show>

            {/* —— real separation —— */}
            <div class="stem">
              <Show when={stemState() === "ready"} fallback={
                <div class="stem-off">
                  <button class="ps-act" disabled={stemState() === "working"} onClick={() => void runSeparation()}>
                    <span class="btn-s" /> {stemState() === "working" ? "separating…" : "remove vocals properly"}
                  </button>
                  <span class="stem-hint">
                    The slider cancels anything centred in the mix — quick, but it thins the drums and
                    bass. This runs a real separation model instead and leaves the band intact.
                    First run downloads ~39 MB, then it's cached.
                  </span>
                  <Show when={stemNote()}>
                    <span class="stem-prog" classList={{ bad: stemState() === "failed" }}>{stemNote()}</span>
                  </Show>
                </div>
              }>
                <div class="stem-on">
                  <span class="stem-badge">SEPARATED</span>
                  <span class="stem-hint">
                    Backing track only — the vocal is gone, and the isolated vocal is now
                    the pitch reference for scoring.
                  </span>
                </div>
              </Show>
            </div>

            {/* —— scoring —— */}
            <div class="sing">
              <Show
                when={scoring()}
                fallback={
                  <div class="sing-off">
                    <button class="ps-act" onClick={() => void startScoring()}>
                      <span class="btn-t" /> score my singing
                    </button>
                    <span class="sing-hint">
                      Uses your microphone and follows the original vocal line. Nothing is recorded or uploaded.
                    </span>
                    <Show when={micErr()}><span class="sing-err">{micErr()}</span></Show>
                  </div>
                }
              >
                <div class="sing-head">
                  <span class="sing-pct">{pct()}<i>%</i></span>
                  <span class="sing-rank">{rankFor(pct())}</span>
                  <Show when={streak() > 8}><span class="sing-streak">{streak()} in a row</span></Show>
                  <span class="sing-notes">
                    <Show when={live().target !== null} fallback={<i>no vocal</i>}>
                      <b>{noteName(live().target!)}</b>
                      <Show when={live().sung !== null} fallback={<i>· sing!</i>}>
                        <span classList={{ flat: live().cents < -30, sharp: live().cents > 30 }}>
                          {live().cents > 30 ? "sharp" : live().cents < -30 ? "flat" : "on pitch"}
                        </span>
                      </Show>
                    </Show>
                  </span>
                  <button class="ps-act" onClick={stopScoring}>stop</button>
                </div>
                <canvas class="sing-ribbon" ref={ribbon} width={880} height={120} />
              </Show>
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
