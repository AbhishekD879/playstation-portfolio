// Studio — a playable Web Audio synth + step-sequencer drum machine, with
// WebMIDI keyboard input. Everything is synthesized live (no samples) and
// routed through the shared master bus, so the Music Visualizer reacts to it.
// Play with: on-screen keys, your computer keyboard (A–L row), a MIDI device,
// or a gamepad face button.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { audioContext, masterBus } from "../audio";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

type Wave = OscillatorType;
const WAVES: Wave[] = ["sawtooth", "square", "triangle", "sine"];

// two octaves from C4; computer-keyboard row maps onto the white/black keys
const KEYS = [
  { n: "C", midi: 60, sharp: false, kb: "a" }, { n: "C#", midi: 61, sharp: true, kb: "w" },
  { n: "D", midi: 62, sharp: false, kb: "s" }, { n: "D#", midi: 63, sharp: true, kb: "e" },
  { n: "E", midi: 64, sharp: false, kb: "d" },
  { n: "F", midi: 65, sharp: false, kb: "f" }, { n: "F#", midi: 66, sharp: true, kb: "t" },
  { n: "G", midi: 67, sharp: false, kb: "g" }, { n: "G#", midi: 68, sharp: true, kb: "y" },
  { n: "A", midi: 69, sharp: false, kb: "h" }, { n: "A#", midi: 70, sharp: true, kb: "u" },
  { n: "B", midi: 71, sharp: false, kb: "j" },
  { n: "C", midi: 72, sharp: false, kb: "k" }, { n: "C#", midi: 73, sharp: true, kb: "o" },
  { n: "D", midi: 74, sharp: false, kb: "l" },
];
const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const DRUMS = ["Kick", "Snare", "Hat", "Clap"] as const;
const STEPS = 16;

export default function Studio(props: { onClose: () => void }) {
  const [wave, setWave] = createSignal<Wave>("sawtooth");
  const [playing, setPlaying] = createSignal(false);
  const [bpm, setBpm] = createSignal(110);
  const [active, setActive] = createSignal<Set<number>>(new Set()); // lit keys
  const [step, setStep] = createSignal(-1);
  const [midiName, setMidiName] = createSignal<string | null>(null);
  // drum grid: DRUMS × STEPS booleans
  const [grid, setGrid] = createSignal<boolean[][]>(
    DRUMS.map((_, r) => Array.from({ length: STEPS }, () => r === 2 && false)),
  );

  let ctx: AudioContext;
  let bus: GainNode; // studio sub-mix → master (so the visualizer taps it)
  const voices = new Map<number, { osc: OscillatorNode; gain: GainNode }>();
  let seqTimer: ReturnType<typeof setInterval> | null = null;
  let midiAccess: any = null;

  // —— synth voices ——
  function noteOn(midi: number) {
    if (voices.has(midi)) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave();
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.01); // quick attack
    osc.connect(gain).connect(bus);
    osc.start(t);
    voices.set(midi, { osc, gain });
    setActive((s) => new Set(s).add(midi));
  }
  function noteOff(midi: number) {
    const v = voices.get(midi);
    if (!v) return;
    const t = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + 0.12); // release tail
    v.osc.stop(t + 0.14);
    voices.delete(midi);
    setActive((s) => { const n = new Set(s); n.delete(midi); return n; });
  }

  // —— drum synthesis (all from oscillators + noise) ——
  function hit(kind: number, t: number) {
    if (kind === 0) { // kick
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(bus); o.start(t); o.stop(t + 0.18);
    } else { // snare / hat / clap — filtered noise bursts
      const dur = kind === 2 ? 0.05 : 0.18;
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = kind === 2 ? 8000 : kind === 3 ? 2000 : 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(kind === 2 ? 0.4 : 0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(hp).connect(g).connect(bus); src.start(t); src.stop(t + dur);
    }
  }

  // —— the sequencer ——
  function toggleSeq() {
    if (playing()) { if (seqTimer) clearInterval(seqTimer); seqTimer = null; setPlaying(false); setStep(-1); return; }
    setPlaying(true);
    let s = 0;
    const tick = () => {
      const t = ctx.currentTime + 0.02;
      grid().forEach((row, r) => { if (row[s]) hit(r, t); });
      setStep(s);
      s = (s + 1) % STEPS;
    };
    tick();
    seqTimer = setInterval(tick, (60 / bpm()) / 4 * 1000); // 16th notes
  }
  // restart the interval when tempo changes mid-play
  function setTempo(v: number) {
    setBpm(v);
    if (playing() && seqTimer) { clearInterval(seqTimer); toggleSeq(); toggleSeq(); }
  }
  const toggleCell = (r: number, c: number) =>
    setGrid((g) => g.map((row, ri) => (ri === r ? row.map((v, ci) => (ci === c ? !v : v)) : row)));

  onMount(() => {
    setNavEnabled(false);
    ctx = audioContext();
    bus = ctx.createGain();
    bus.gain.value = 0.8;
    bus.connect(masterBus()); // → master (muted with console, tapped by the visualizer)

    const kbDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = KEYS.find((x) => x.kb === e.key.toLowerCase());
      if (k) { e.preventDefault(); noteOn(k.midi); }
      if (e.key === "Escape") { sfx.back(); props.onClose(); }
    };
    const kbUp = (e: KeyboardEvent) => {
      const k = KEYS.find((x) => x.kb === e.key.toLowerCase());
      if (k) noteOff(k.midi);
    };
    addEventListener("keydown", kbDown);
    addEventListener("keyup", kbUp);

    // —— WebMIDI ——
    (navigator as any).requestMIDIAccess?.().then((access: any) => {
      midiAccess = access;
      const wire = () => {
        let name: string | null = null;
        access.inputs.forEach((inp: any) => {
          name = inp.name;
          inp.onmidimessage = (m: any) => {
            const [cmd, note, vel] = m.data;
            if ((cmd & 0xf0) === 0x90 && vel > 0) noteOn(note);
            else if ((cmd & 0xf0) === 0x80 || ((cmd & 0xf0) === 0x90 && vel === 0)) noteOff(note);
          };
        });
        setMidiName(name);
      };
      wire();
      access.onstatechange = wire;
    }).catch(() => {});

    onCleanup(() => {
      setNavEnabled(true);
      removeEventListener("keydown", kbDown);
      removeEventListener("keyup", kbUp);
      if (seqTimer) clearInterval(seqTimer);
      voices.forEach((_, m) => noteOff(m));
      if (midiAccess) midiAccess.inputs.forEach((i: any) => (i.onmidimessage = null));
      try { bus.disconnect(); } catch { /* already gone */ }
    });
  });

  return (
    <div class="studio">
      <div class="studio-bar">
        <div class="panel-tag">STUDIO — SYNTH · DRUM MACHINE · MIDI</div>
        <Show when={midiName()}><span class="studio-midi">🎹 {midiName()}</span></Show>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <div class="studio-body">
        {/* drum machine */}
        <div class="studio-drums">
          <div class="studio-transport">
            <button class="ps2-launch studio-play" onClick={toggleSeq}>{playing() ? "■ stop" : "▶ play"}</button>
            <label class="studio-bpm">{bpm()} BPM
              <input type="range" min="70" max="180" value={bpm()} onInput={(e) => setTempo(+e.currentTarget.value)} />
            </label>
          </div>
          <For each={DRUMS}>
            {(name, r) => (
              <div class="studio-row">
                <span class="studio-rowname">{name}</span>
                <div class="studio-cells">
                  <For each={Array.from({ length: STEPS })}>
                    {(_, c) => (
                      <button
                        class="studio-cell"
                        classList={{ on: grid()[r()][c()], beat: c() % 4 === 0, cursor: step() === c() }}
                        onClick={() => toggleCell(r(), c())}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* synth keyboard */}
        <div class="studio-synth">
          <div class="studio-waves">
            <For each={WAVES}>
              {(w) => <button class="ghost-btn" classList={{ on: wave() === w }} onClick={() => setWave(w)}>{w}</button>}
            </For>
          </div>
          <div class="studio-keys">
            <For each={KEYS}>
              {(k) => (
                <button
                  class="studio-key"
                  classList={{ sharp: k.sharp, lit: active().has(k.midi) }}
                  onPointerDown={() => noteOn(k.midi)}
                  onPointerUp={() => noteOff(k.midi)}
                  onPointerLeave={() => active().has(k.midi) && noteOff(k.midi)}
                >
                  <span class="studio-keylabel">{k.kb.toUpperCase()}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="panel-hint guide-hint">play the keys (A–L row) · plug in MIDI · <span class="btn-o" /> close</div>
    </div>
  );
}
