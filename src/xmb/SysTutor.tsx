// System City Tutor — a free-form, on-device system-design teacher. The learner
// drives: ask anything, in any order, no forced path. Reuses the AiChat stack
// (@earendil-works/pi-agent-core Agent + @mlc-ai/web-llm on WebGPU) but grounded
// in the system-design corpus (sysdesign.ts) via MiniLM retrieval. Graceful
// degradation is the point: "course notes" mode (pure retrieval, no LLM) answers
// instantly and works with no GPU; loading a model upgrades to a real dialogue.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";
import { Agent } from "@earendil-works/pi-agent-core";
import { webllmModel, webllmStreamFn } from "../piWebllm";
import { geminiAvailability, geminiModel, geminiNanoStreamFn } from "../piGemini";
import { buildSysIndex, sysRetrieve } from "../sysdesign";
import { webSearchTool } from "../aiTools";
import { setNavEnabled } from "../input";
import * as sfx from "../audio";

const MODELS = {
  smart: { id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", label: "Hermes 3 · 3B", dl: "~2 GB", blurb: "recommended — clear explanations & tool use" },
  light: { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 · 1B", dl: "~0.7 GB", blurb: "tiny & fast, for a modest GPU" },
} as const;
type ModelKey = keyof typeof MODELS | "gemini";

const TUTOR_SYS = `You are the System City tutor — a friendly, sharp teacher of software system design, living in a PlayStation-style learning console. The learner is in charge: answer exactly what they ask, in any order — there is no fixed curriculum and nothing is mandatory.

Teach ONE idea at a time in plain language, and keep replies under ~90 words. Ground every answer in the "Course notes" provided in the conversation — prefer them over your own memory, and if the notes don't cover something, say so briefly rather than inventing specifics. Use a concrete example (a URL shortener, a news feed, Kubernetes, a multi-region deploy) when it helps, then end with ONE short question inviting them to go deeper or choose what's next. Never dump a wall of text.

When the learner asks about something beyond the course notes — a specific tool, a recent development, a real company's architecture, current best practice — call web_search, then teach from what it returns and cite the link.`;

type Item = { role: "user" | "assistant" | "note"; text: string };

export default function SysTutor(props: { onClose: () => void; seed?: string }) {
  const [supported, setSupported] = createSignal<boolean | null>(null);
  const [model, setModel] = createSignal<ModelKey | null>(null);
  const [ready, setReady] = createSignal(false);
  const [progress, setProgress] = createSignal("");
  const [items, setItems] = createSignal<Item[]>([]);
  const [busy, setBusy] = createSignal(false);
  let engine: MLCEngine | null = null;
  let agent: Agent | null = null;
  let input!: HTMLInputElement;
  let scroller!: HTMLDivElement;

  const scroll = () => requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  const push = (it: Item) => { setItems((x) => [...x, it]); scroll(); };

  onMount(() => {
    setNavEnabled(false);
    buildSysIndex().catch(() => {}); // warm the retrieval index immediately
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back?.(); props.onClose(); } };
    addEventListener("keydown", esc);
    onCleanup(() => { setNavEnabled(true); removeEventListener("keydown", esc); engine?.unload?.(); });
    (async () => {
      if (props.seed) send(props.seed); // opening topic answered instantly from notes (agent not ready yet)
      // PREFER Chrome's built-in Gemini Nano; else WebGPU WebLLM; else notes-only
      const gem = await geminiAvailability();
      if (gem !== "unavailable") { setSupported(true); void bootGemini(); return; }
      const gpu = (navigator as any).gpu;
      try { setSupported(!!gpu && !!(await gpu.requestAdapter())); } catch { setSupported(false); }
    })();
    setTimeout(() => input?.focus(), 80);
  });

  // shared agent wiring for either brain (Gemini Nano or WebLLM)
  function startAgent(modelDesc: any, streamFn: any, greet: string) {
    agent = new Agent({
      initialState: { systemPrompt: TUTOR_SYS, model: modelDesc, tools: [webSearchTool()], messages: [] },
      streamFn,
      // RAG: slot the most relevant course notes in just before the question
      transformContext: async (msgs: any[]) => {
        const lastUser = [...msgs].reverse().find((m) => m.role === "user");
        if (!lastUser) return msgs;
        const q = typeof lastUser.content === "string" ? lastUser.content : lastUser.content.map((c: any) => c.text ?? "").join(" ");
        const notes = await sysRetrieve(q, 4);
        if (!notes.length) return msgs;
        const ref = { role: "user" as const, content: `Course notes (use these to ground your answer):\n${notes.map((n) => "• " + n).join("\n")}`, timestamp: Date.now() };
        const idx = msgs.lastIndexOf(lastUser);
        return [...msgs.slice(0, idx), ref, ...msgs.slice(idx)];
      },
    });
    agent.subscribe((ev: any) => {
      if (ev.type === "message_start" && ev.message?.role === "assistant") push({ role: "assistant", text: "" });
      if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
        const d = ev.assistantMessageEvent.delta;
        setItems((x) => { const o = [...x]; for (let i = o.length - 1; i >= 0; i--) if (o[i].role === "assistant") { o[i] = { ...o[i], text: o[i].text + d }; break; } return o; });
        scroll();
      }
      if (ev.type === "agent_end") setBusy(false);
    });
    setReady(true);
    setProgress("");
    push({ role: "assistant", text: greet });
  }

  async function boot(key: keyof typeof MODELS) {
    setModel(key);
    setProgress("Contacting the model hub…");
    try {
      engine = await CreateMLCEngine(MODELS[key].id, { initProgressCallback: (p) => setProgress(p.text) });
      startAgent(webllmModel(MODELS[key].id), webllmStreamFn(() => engine), "Tutor online — running on your GPU. Ask me anything about system design: “how does a CDN work?”, “explain Kubernetes”, “how do systems scale across regions?”. What do you want to dig into?");
    } catch (e) {
      setProgress(`Couldn't load the model — ${String(e).slice(0, 120)}. You can still read the course notes.`);
    }
  }

  // preferred brain — Chrome's built-in Gemini Nano (no download from us)
  async function bootGemini() {
    setModel("gemini");
    setProgress("Waking up Chrome's built-in Gemini Nano…");
    try {
      startAgent(geminiModel(), geminiNanoStreamFn((pct) => setProgress(`Downloading Gemini Nano… ${pct}%`)), "Tutor online — Chrome's built-in Gemini Nano, private &amp; on-device. Ask me anything: “how does a CDN work?”, “explain Kubernetes”, “how do systems scale across regions?”.");
    } catch { setModel(null); setReady(false); }
  }

  // notes mode: instant, grounded, no LLM needed — the usable floor
  async function answerFromNotes(q: string) {
    setBusy(true);
    const notes = await sysRetrieve(q, 3);
    setBusy(false);
    if (notes.length) push({ role: "note", text: notes.join("\n\n") });
    else push({ role: "note", text: "I don't have a note on that yet. Try a core topic — caching, sharding, load balancing, Kubernetes, CAP — or load the AI tutor above for a free-form answer." });
  }

  function send(text?: string) {
    const t = (text ?? input?.value ?? "").trim();
    if (!t || busy()) return;
    if (input) input.value = "";
    push({ role: "user", text: t });
    if (agent && ready()) {
      setBusy(true);
      agent.prompt(t).catch(() => { push({ role: "assistant", text: "…hiccup. Ask again?" }); setBusy(false); });
    } else {
      answerFromNotes(t);
    }
  }

  return (
    <div class="systut">
      <div class="systut-head">
        <div class="panel-tag">SYSTEM CITY · TUTOR</div>
        <button class="ps-act" onClick={() => { sfx.back?.(); props.onClose(); }}><span class="btn-o" /> close</button>
      </div>

      <Show when={!ready()}>
        <div class="systut-banner">
          <Show
            when={supported()}
            fallback={<span>Reading <b>course notes</b> — the live AI tutor needs WebGPU (desktop Chrome/Edge, Safari 26+, newer phones). Notes answer instantly below.</span>}
          >
            <Show when={!model()} fallback={<span class="systut-prog">{progress() || "loading the tutor…"}</span>}>
              <span>Answering from <b>course notes</b>. Want a free-form conversation? Load the on-device AI tutor:</span>
              <span class="systut-models">
                <For each={Object.entries(MODELS) as [keyof typeof MODELS, (typeof MODELS)[keyof typeof MODELS]][]}>
                  {([k, m]) => <button class="systut-load" onClick={() => { sfx.confirm?.(); boot(k); }}>{m.label} · {m.dl}</button>}
                </For>
              </span>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="systut-log" ref={scroller}>
        <Show when={!items().length}>
          <div class="systut-empty">Ask anything about system design — pick a topic or type a question. You're in charge; there's no set path.</div>
        </Show>
        <For each={items()}>
          {(it) => (
            <div class="systut-msg" classList={{ user: it.role === "user", note: it.role === "note" }}>
              <Show when={it.role === "note"}><div class="systut-note-tag">📓 course notes</div></Show>
              <div class="systut-text">{it.text || "▋"}</div>
            </div>
          )}
        </For>
        <Show when={busy()}><div class="systut-msg"><div class="systut-text">▋</div></div></Show>
      </div>

      <div class="systut-inputrow">
        <input ref={input} class="systut-input" placeholder="Ask the tutor…  e.g. how does sharding work?"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") send(); if (e.key === "Escape") { sfx.back?.(); props.onClose(); } }} />
        <button class="systut-send" onClick={() => send()} disabled={busy()}>Send</button>
      </div>
    </div>
  );
}
