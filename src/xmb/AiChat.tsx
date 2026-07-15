// AI Abhishek — a real LLM running ON THIS DEVICE via WebGPU. Two brains:
// Llama 3.2 1B (fast, ~700 MB) or Hermes 3 3B (Nous Research's agent-tuned
// model, ~1.9 GB) which can also OPERATE the console — open apps, play radio,
// change themes — through a simple command protocol. No servers, no keys.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";
import { CAREER, OWNER, PROJECTS, SKILLS } from "../content";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

const MODELS = {
  fast: { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 1B", dl: "~700 MB", blurb: "quick answers, light on the GPU" },
  agent: { id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", label: "Hermes 3 · 3B", dl: "~1.9 GB", blurb: "smarter — and it can drive the console" },
} as const;
type ModelKey = keyof typeof MODELS;

// console apps the agent may open — keep ids in sync with XMB's executor
const APPS = "doom, chess, lichess, trivia, flash, youtube, cinema, podcasts, radio, spotify, winamp, library, wiki, dictionary, map, timemachine, art, apod, weather, tv, news, photos, trophies, whatsnew, themes";

function systemPrompt(agentic: boolean) {
  return `You are "AI Abhishek" — a friendly, capable general-purpose assistant running fully on the visitor's device, embedded in ${OWNER.name}'s portfolio console. Chat naturally about anything: code, career advice, trivia, ideas. Keep answers concise (2-5 sentences) unless asked for depth.

You are also the expert on ${OWNER.name} (${OWNER.title}, ${OWNER.location}). When someone asks about him — who he is, what he's done, what he can build, whether to hire him — use ONLY these facts, never invented ones:
${CAREER.map((c) => `- ${c.tag}: ${c.title}. ${c.bullets.join(" ")}`).join("\n")}
Projects: ${PROJECTS.map((p) => p.title).join(", ")}.
Skills: ${SKILLS.map((s) => `${s.name}: ${s.items.join("/")}`).join("; ")}.

Services he can offer: agentic AI systems & LLM workflow design, voice-AI tooling & prompt-optimization pipelines, RAG systems, full-stack product engineering, test automation. Contact: ${OWNER.email} · ${OWNER.linkedin}.

Do NOT steer unrelated conversations back to Abhishek — just be helpful.${agentic ? `

CONSOLE CONTROL: you can operate this console. When — and only when — the user asks you to open, play, launch, or show something the console has, reply with EXACTLY one line and nothing else:
<command>{"app":"NAME"}</command>
where NAME is one of: ${APPS}.
Examples: "play doom" → <command>{"app":"doom"}</command> · "put some music on" → <command>{"app":"radio"}</command> · "show me old websites" → <command>{"app":"timemachine"}</command>.
For everything else, reply with normal text and no command tags.` : ""}`;
}

type Msg = { role: "user" | "assistant"; text: string };

export default function AiChat(props: {
  onFirstChat: () => void;
  onCommand: (app: string) => boolean;
  onClose: () => void;
}) {
  const [supported, setSupported] = createSignal<boolean | null>(null);
  const [ready, setReady] = createSignal(false);
  const [model, setModel] = createSignal<ModelKey | null>(null);
  const [progress, setProgress] = createSignal("");
  const [msgs, setMsgs] = createSignal<Msg[]>([]);
  const [busy, setBusy] = createSignal(false);
  let engine: MLCEngine | null = null;
  let input!: HTMLInputElement;
  let scroller!: HTMLDivElement;

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    // register ALL cleanups synchronously — Solid loses the owner after an await
    onCleanup(() => {
      setNavEnabled(true);
      removeEventListener("keydown", esc);
      engine?.unload();
    });
    (async () => {
      const gpu = (navigator as any).gpu;
      if (!gpu) { setSupported(false); return; }
      try {
        setSupported(!!(await gpu.requestAdapter()));
      } catch {
        setSupported(false);
      }
    })();
  });

  async function boot(key: ModelKey) {
    setModel(key);
    setProgress("Contacting the model hub…");
    try {
      engine = await CreateMLCEngine(MODELS[key].id, {
        initProgressCallback: (p) => setProgress(p.text),
      });
      setReady(true);
      setProgress("");
      setMsgs([{
        role: "assistant",
        text: key === "agent"
          ? "Hermes online — running on your GPU. Ask me about Abhishek, or tell me to do things: “open doom”, “put some radio on”, “show the art gallery”."
          : "Hi — I'm a 1B model running entirely on your GPU. Ask me anything about Abhishek's work.",
      }]);
      setTimeout(() => input?.focus(), 60);
    } catch (e) {
      setProgress(`Couldn't load the model — ${String(e).slice(0, 120)}`);
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy() || !engine) return;
    input.value = "";
    props.onFirstChat();
    setMsgs((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const chunks = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt(model() === "agent") },
          ...msgs().filter((m) => m.text).map((m) => ({ role: m.role, content: m.text })),
          { role: "user", content: text },
        ] as any,
        stream: true,
        max_tokens: 260,
        temperature: 0.7,
      });
      let full = "";
      for await (const c of chunks) {
        const delta = c.choices[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          setMsgs((m) => {
            const out = [...m];
            out[out.length - 1] = { role: "assistant", text: full };
            return out;
          });
          scroller.scrollTop = scroller.scrollHeight;
        }
      }
      // did the agent issue a console command?
      const cmd = full.match(/<command>\s*({[^}]*})\s*<\/command>/);
      if (cmd) {
        let app = "";
        try { app = JSON.parse(cmd[1]).app?.toLowerCase?.() ?? ""; } catch { /* malformed */ }
        const ok = app && props.onCommand(app);
        setMsgs((m) => [
          ...m.slice(0, -1),
          { role: "assistant", text: ok ? `🕹 On it — opening ${app}.` : `I tried to open “${app}” but couldn't find it on this console.` },
        ]);
        if (ok) setTimeout(() => props.onClose(), 650); // hand the stage to the app
      }
    } catch {
      setMsgs((m) => [...m.slice(0, -1), { role: "assistant", text: "…my circuits hiccuped. Try again?" }]);
    }
    setBusy(false);
  }

  return (
    <div class="ai">
      <div class="ai-head">
        <div class="panel-tag">
          AI ABHISHEK — {model() ? `${MODELS[model()!].label} · ` : ""}WEBGPU, ON-DEVICE, NO SERVER
        </div>
        <button class="ghost-btn" onClick={() => { sfx.back(); props.onClose(); }}>✕ close</button>
      </div>

      <Show when={supported() !== null} fallback={<div class="guide-loading">Checking your GPU…</div>}>
        <Show
          when={supported()}
          fallback={
            <div class="ai-gate">
              <div class="ai-gate-big">This device can't run the on-device AI.</div>
              <p>It needs WebGPU — available on desktop Chrome/Edge 113+, recent Firefox, Safari 26+, and newer Android/iOS devices. Everything else on the console works fine without it.</p>
            </div>
          }
        >
          <Show
            when={model()}
            fallback={
              <div class="ai-gate">
                <div class="ai-gate-big">Pick a brain</div>
                <p>Both run fully on your GPU — downloaded once, cached, nothing you type leaves this device. Not recommended on mobile data.</p>
                <div class="ai-models">
                  <For each={Object.entries(MODELS) as [ModelKey, (typeof MODELS)[ModelKey]][]}>
                    {([key, m]) => (
                      <button class="ai-model-card" onClick={() => { sfx.confirm(); boot(key); }}>
                        <span class="ai-model-name">{key === "agent" ? "🤖 " : "⚡ "}{m.label}</span>
                        <span class="ai-model-dl">{m.dl}</span>
                        <span class="ai-model-blurb">{m.blurb}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            <Show when={ready()} fallback={<div class="guide-loading ai-progress">{progress()}</div>}>
              <div class="ai-log" ref={scroller}>
                <For each={msgs()}>
                  {(m) => (
                    <div class="ai-msg" classList={{ user: m.role === "user" }}>
                      {m.text || "▋"}
                    </div>
                  )}
                </For>
              </div>
              <input
                ref={input}
                class="ai-input"
                placeholder={busy() ? "thinking…" : model() === "agent" ? "Ask anything — or tell me to open something…" : "Ask about Abhishek's work…"}
                disabled={busy()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") send();
                  if (e.key === "Escape") { sfx.back(); props.onClose(); }
                }}
              />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
