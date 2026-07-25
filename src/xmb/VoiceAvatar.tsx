// "Talk to Abhishek" — a voice avatar you speak to and it answers aloud, fully
// on-device. Pipeline: mic → Whisper (STT) → pi-agent on GEMINI NANO (grounded
// in the portfolio via RAG) → Kokoro (TTS) → a stylized lip-synced 3D head.
// GEMINI-NANO-ONLY: only Nano is fast enough for natural sub-second turns, so
// the whole experience is gated on it (shows an honest notice otherwise).
// Two ways to talk: hold-to-talk (press & hold, or Space) — always works — and
// an optional hands-free mode via silero VAD (self-hosted in /vad/).
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { Agent } from "@earendil-works/pi-agent-core";
import { geminiAvailability, geminiModel, geminiNanoStreamFn } from "../piGemini";
import { webSearchTool } from "../aiTools";
import { buildIndex, retrieve } from "../rag";
import { record, transcribe } from "../asr";
import { speakWithLipSync, stopSpeaking, loadTTS } from "../tts";
import { OWNER } from "../content";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

type VState = "checking" | "nogem" | "idle" | "listening" | "thinking" | "speaking" | "error";

const SYSTEM = `You ARE ${OWNER.name} — ${OWNER.title} based in ${OWNER.location} — speaking in the FIRST PERSON as yourself to a visitor (often a recruiter) who is talking to you out loud. This is a SPOKEN conversation, so:
- Keep every reply to 1-3 short sentences. No lists, no markdown, no headings — it will be read aloud.
- Warm, confident, natural — like talking, not writing.
- Answer using ONLY the "Reference facts" provided in the conversation when the question is about your work/career/projects/skills; never invent details. If you don't know, say so briefly and offer what you do know.
- For general questions, answer helpfully and briefly. You can web_search for current facts, then answer in one spoken sentence.
Contact: ${OWNER.email}.`;

const STATE_COLOR: Record<string, number> = {
  idle: 0x5aa2ff, listening: 0x4fd6e6, thinking: 0xffb648, speaking: 0x56d69a, error: 0xff6257,
};

export default function VoiceAvatar(props: { onClose: () => void }) {
  const [state, setState] = createSignal<VState>("checking");
  const [handsFree, setHandsFree] = createSignal(false);
  const [caption, setCaption] = createSignal(""); // what the visitor said
  const [reply, setReply] = createSignal("");      // what the avatar answered
  const [hint, setHint] = createSignal("");
  let wrap!: HTMLDivElement;
  let agent: Agent | null = null;
  let replyBuf = "";
  let mouth = 0;                 // 0..1 lip-sync level, read by the render loop
  let rec: { stop: () => void; done: Promise<string> } | null = null;
  let vad: any = null;
  let holding = false;
  const busy = () => ["thinking", "speaking"].includes(state());

  // ——— the on-device brain (Gemini Nano only) ———
  function buildAgent() {
    agent = new Agent({
      initialState: { systemPrompt: SYSTEM, model: geminiModel(), tools: [webSearchTool()], messages: [] },
      streamFn: geminiNanoStreamFn(),
      transformContext: async (msgs: any[]) => {
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        if (!lastUser) return msgs;
        const q = typeof lastUser.content === "string" ? lastUser.content : lastUser.content.map((c: any) => c.text ?? "").join(" ");
        const facts = await retrieve(q, 4);
        if (!facts.length) return msgs;
        const ref = { role: "user" as const, content: `Reference facts (use only if relevant):\n${facts.map((f) => "• " + f).join("\n")}`, timestamp: Date.now() };
        const idx = msgs.lastIndexOf(lastUser);
        return [...msgs.slice(0, idx), ref, ...msgs.slice(idx)];
      },
    });
    agent.subscribe((ev: any) => {
      if (ev.type === "message_start" && ev.message?.role === "assistant") replyBuf = "";
      if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") { replyBuf += ev.assistantMessageEvent.delta; setReply(replyBuf); }
      if (ev.type === "agent_end") { const t = replyBuf.trim(); if (t) void speakReply(t); else setState("idle"); }
    });
  }

  // ——— voice loop ———
  async function onUtterance(text: string) {
    const t = (text || "").trim();
    if (!t) { setState("idle"); return; }
    setCaption(t);
    setReply("");
    replyBuf = "";
    setState("thinking");
    if (!agent) { setState("error"); setHint("Tutor not ready."); return; }
    agent.prompt(t).catch(() => { setState("idle"); setHint("Hmm, that hiccuped — try again."); });
  }

  async function speakReply(text: string) {
    setState("speaking");
    try { await speakWithLipSync(text, (v) => { mouth = v; }); }
    catch { /* tts failed — still show the caption */ }
    mouth = 0;
    setState("idle");
  }

  // hold-to-talk (press & hold the button or Space) — always available
  async function startHold() {
    if (holding || state() === "checking" || state() === "nogem") return;
    if (busy()) stopSpeaking(); // barge-in
    holding = true;
    setState("listening");
    sfx.tickH?.();
    try { rec = record(); } catch { holding = false; setState("idle"); setHint("Mic blocked — allow microphone access."); }
  }
  async function endHold() {
    if (!holding || !rec) return;
    holding = false;
    setState("thinking");
    const r = rec; rec = null;
    r.stop();
    try { await onUtterance(await r.done); } catch { setState("idle"); }
  }

  // hands-free (silero VAD, self-hosted assets in /vad/) — optional
  async function toggleHandsFree() {
    if (handsFree()) { setHandsFree(false); try { vad?.pause?.(); vad?.destroy?.(); } catch { /* gone */ } vad = null; if (!busy()) setState("idle"); return; }
    setHint("Starting hands-free…");
    try {
      const { MicVAD } = await import("@ricky0123/vad-web");
      vad = await MicVAD.new({
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        onSpeechStart: () => { if (busy()) stopSpeaking(); setState("listening"); },
        onSpeechEnd: async (audio: Float32Array) => { setState("thinking"); await onUtterance(await transcribe(audio)); },
      } as any);
      vad.start();
      setHandsFree(true);
      setHint("Hands-free on — just talk.");
    } catch {
      setHandsFree(false);
      setHint("Hands-free unavailable here — use hold-to-talk.");
    }
  }

  onMount(() => {
    setNavEnabled(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { sfx.back?.(); props.onClose(); return; }
      const typing = (document.activeElement?.tagName ?? "") === "INPUT";
      if (e.code === "Space" && !e.repeat && !typing && !handsFree()) { e.preventDefault(); void startHold(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space" && !handsFree()) { e.preventDefault(); void endHold(); } };
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKeyUp);

    // ——— stylized 3D head (procedural — mirrors Board3D dispose pattern) ———
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.45, 8.2);
    camera.lookAt(0, 0.15, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xdfe9ff, 1.2); key.position.set(3, 5, 6); scene.add(key);
    const rim = new THREE.PointLight(0x5aa2ff, 6, 20); rim.position.set(0, 0, 4); scene.add(rim);

    const head = new THREE.Group(); scene.add(head);
    const skin = new THREE.MeshStandardMaterial({ color: 0x16233b, roughness: 0.5, metalness: 0.2, emissive: 0x5aa2ff, emissiveIntensity: 0.35 });
    const face = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 3), skin);
    face.scale.set(1, 1.12, 0.92); head.add(face);
    // eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xeaf2ff, emissive: 0xbcd6ff, emissiveIntensity: 0.6, roughness: 0.2 });
    const eyeGeo = new THREE.SphereGeometry(0.17, 20, 20);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.5, 0.28, 1.32);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.5, 0.28, 1.32);
    head.add(eyeL, eyeR);
    // mouth — a bar whose height tracks the TTS amplitude
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1c, emissive: 0x4fd6e6, emissiveIntensity: 0.5, roughness: 0.4 });
    const mouthMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.16), mouthMat);
    mouthMesh.position.set(0, -0.42, 1.28); head.add(mouthMesh);
    // halo — state color glow
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.5, 48), new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    halo.position.z = -0.8; scene.add(halo);

    const target = new THREE.Color(STATE_COLOR.idle);
    createEffect(() => { target.setHex(STATE_COLOR[state()] ?? STATE_COLOR.idle); });

    let disposed = false;
    const t0 = performance.now();
    let blink = 0, nextBlink = 1.5;
    const cur = new THREE.Color(STATE_COLOR.idle);
    const render = (now: number) => {
      if (disposed) return;
      const t = (now - t0) / 1000;
      cur.lerp(target, 0.08);
      skin.emissive.copy(cur); (halo.material as THREE.MeshBasicMaterial).color.copy(cur); rim.color.copy(cur);
      // idle presence: gentle bob + sway; lean in a touch while listening
      head.position.y = Math.sin(t * 1.1) * 0.05;
      head.rotation.y = Math.sin(t * 0.5) * 0.12;
      head.rotation.x = (state() === "listening" ? -0.06 : 0) + Math.sin(t * 0.8) * 0.02;
      // blink
      if (t > nextBlink) { blink = 1; nextBlink = t + 1.5 + Math.random() * 3; }
      blink = Math.max(0, blink - 0.14);
      const eo = 1 - blink; eyeL.scale.y = eo; eyeR.scale.y = eo;
      // mouth: amplitude when speaking, a soft pulse when thinking, closed otherwise
      const open = state() === "speaking" ? 0.12 + mouth * 1.9
        : state() === "thinking" ? 0.12 + (Math.sin(t * 9) * 0.5 + 0.5) * 0.35
        : state() === "listening" ? 0.2 : 0.12;
      mouthMesh.scale.y = open / 0.12;
      skin.emissiveIntensity = 0.3 + (state() === "speaking" ? mouth * 0.5 : 0.12) + Math.sin(t * 2) * 0.03;
      renderer.render(scene, camera);
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const size = () => { const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); };
    size();
    const ro = new ResizeObserver(size); ro.observe(wrap);

    // ——— boot: Gemini gate + warm the models ———
    (async () => {
      const gem = await geminiAvailability();
      if (gem === "unavailable") { setState("nogem"); return; }
      buildIndex().catch(() => {});
      loadTTS().catch(() => {});
      buildAgent();
      setState("idle");
      setHint("Hold the mic (or Space) and ask me anything.");
    })();

    onCleanup(() => {
      disposed = true;
      setNavEnabled(true);
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKeyUp);
      ro.disconnect();
      stopSpeaking();
      try { rec?.stop(); } catch { /* none */ }
      try { vad?.destroy?.(); } catch { /* none */ }
      [eyeGeo, mouthMesh.geometry, face.geometry, halo.geometry].forEach((g) => (g as any).dispose?.());
      renderer.dispose();
    });
  });

  return (
    <div class="vox">
      <div class="vox-scene" ref={wrap} />

      <div class="vox-top">
        <div class="vox-brand"><span class="vox-dot" classList={{ [state()]: true }} /> TALK TO {OWNER.name.split(" ")[0].toUpperCase()}</div>
        <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose(); }}><span class="btn-o" /> back</button>
      </div>

      <Show when={state() === "nogem"}>
        <div class="vox-gate">
          <div class="vox-gate-big">Voice needs Chrome's built-in Gemini Nano</div>
          <p>The talking avatar runs its brain on <b>Gemini Nano</b> — only it's fast enough for a natural, sub-second spoken conversation, and it keeps everything on your device. It's built into recent Chrome/Edge (desktop). On other browsers, use the text chat in <b>AI Abhishek</b> instead.</p>
        </div>
      </Show>

      <Show when={state() !== "nogem" && state() !== "checking"}>
        <div class="vox-captions">
          <Show when={caption()}><div class="vox-you"><span>you</span>{caption()}</div></Show>
          <Show when={reply()}><div class="vox-me"><span>{OWNER.name.split(" ")[0].toLowerCase()}</span>{reply()}</div></Show>
        </div>

        <div class="vox-controls">
          <div class="vox-status" data-s={state()}>
            {state() === "listening" ? "listening…" : state() === "thinking" ? "thinking…" : state() === "speaking" ? "speaking…" : hint() || "ready"}
          </div>
          <button
            class="vox-mic" classList={{ live: state() === "listening", off: handsFree() }}
            disabled={handsFree()}
            onPointerDown={(e) => { e.preventDefault(); void startHold(); }}
            onPointerUp={(e) => { e.preventDefault(); void endHold(); }}
            onPointerLeave={(e) => { if ((e as any).buttons) void endHold(); }}
            onPointerCancel={() => void endHold()}
            onContextMenu={(e) => e.preventDefault()}
          >🎙️</button>
          <button class="vox-ghost" classList={{ on: handsFree() }} onClick={() => void toggleHandsFree()}>
            {handsFree() ? "hands-free: on" : "hands-free"}
          </button>
        </div>
      </Show>

      <Show when={state() === "checking"}><div class="vox-gate"><div class="vox-gate-big">Warming up…</div></div></Show>
    </div>
  );
}
