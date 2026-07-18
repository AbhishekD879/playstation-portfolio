// AI Abhishek — a real agent running ON THIS DEVICE. pi.dev's agent runtime
// (pi-agent-core) drives a proper tool-calling loop; WebLLM supplies the model
// on WebGPU (Llama 3.2 1B or Hermes 3 3B). The agent can open console apps,
// search YouTube, and pop rich widgets (career, skills, contact, weather)
// right in the chat. Speak or type. No servers, no keys.
import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { CAREER, OWNER, PROJECTS, SKILLS } from "../content";
import { fetchWeather, wmo, type Weather } from "../apps";
import { webllmModel, webllmStreamFn } from "../piWebllm";
import { loadTTS, speak, stopSpeaking, ttsSupported } from "../tts";
import { clearChat, loadChat, saveChat, type StoredChat } from "../chatStore";
import { buildIndex, retrieve } from "../rag";
import { capabilitySummary, runAction } from "../consoleBus";
import { asrSupported, record } from "../asr";
import { Icon } from "./icons";
import { primaryPad, setNavEnabled } from "../input";
import * as sfx from "../audio";

// Hermes is the default (listed first) — it uses tools, memory & retrieved
// facts far more reliably than the 1B. Llama stays as the lightweight option.
const MODELS = {
  agent: { id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", label: "Hermes 3 · 3B", dl: "~1.9 GB", blurb: "recommended — smart with tools, memory & recall" },
  fast: { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 · 1B", dl: "~700 MB", blurb: "lighter & faster, for a modest GPU" },
} as const;
type ModelKey = keyof typeof MODELS;

const APPS = "doom, chess, lichess, trivia, flash, ps2, pc, guestbook, browser, visualizer, studio, code, youtube, cinema, podcasts, radio, spotify, winamp, library, wiki, dictionary, map, timemachine, art, apod, weather, tv, news, photos, trophies, whatsnew, themes";

const SYSTEM = `You are "AI Abhishek" — a friendly assistant running fully on the visitor's device, embedded in ${OWNER.name}'s PlayStation-style portfolio console. Chat naturally about anything. Keep answers concise (2-4 sentences) unless asked for depth.

You are the expert on ${OWNER.name} (${OWNER.title}, ${OWNER.location}). When you answer questions about him, use ONLY the "Reference facts" provided in the conversation — never invent details. If no reference facts are given and you don't know, say so briefly. Contact: ${OWNER.email} · ${OWNER.linkedin}.

When the user asks about his career, projects, skills, or how to reach him, CALL the matching show_* tool — the console renders a beautiful card. Add one short sentence of commentary, not a recital of the card's contents. When asked to open/play/launch something, call open_app. When asked to find or play a video, call search_youtube. Do NOT steer unrelated conversations back to Abhishek.

These requests MUST become tool calls, never prose:
- "open doom" / "play chess" → open_app
- "search lofi on youtube" / "find videos of X" / "play some music videos" → search_youtube
- "what are his skills" / "his tech stack" → show_skills
- "what has he worked on" / "his experience" → show_career
- "his projects" → show_projects
- "how do I contact/hire him" → show_contact
- "what's the weather" → get_weather`;

type Widget =
  | { t: "career" } | { t: "projects" } | { t: "skills" } | { t: "contact" }
  | { t: "weather"; data: Weather }
  | { t: "app"; app: string; ok: boolean };
type ChatItem = { kind: "msg"; role: "user" | "assistant"; text: string } | { kind: "widget"; w: Widget };

export default function AiChat(props: {
  onFirstChat: () => void;
  onCommand: (app: string, arg?: string) => boolean;
  onClose: () => void;
  profileId: string;
  consoleStatus: () => string;
}) {
  const chatKey = () => `chat:${props.profileId}`;
  let restored: StoredChat | null = null; // prior transcript + agent memory
  const [supported, setSupported] = createSignal<boolean | null>(null);
  const [ready, setReady] = createSignal(false);
  const [model, setModel] = createSignal<ModelKey | null>(null);
  const [progress, setProgress] = createSignal("");
  const [items, setItems] = createSignal<ChatItem[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [listening, setListening] = createSignal(false);
  const [voice, setVoice] = createSignal(false);
  const [voiceLoading, setVoiceLoading] = createSignal(false);
  let engine: MLCEngine | null = null;
  let agent: Agent | null = null;
  let rec: any = null;
  let input!: HTMLInputElement;
  let scroller!: HTMLDivElement;

  const scroll = () => requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  const pushItem = (it: ChatItem) => { setItems((x) => [...x, it]); scroll(); };
  const widget = (w: Widget) => pushItem({ kind: "widget", w });

  // —— the agent's hands: what it can actually do on this console ——
  const T = (name: string, label: string, description: string, parameters: any,
    execute: (params: any) => Promise<{ text: string; terminate?: boolean }>): AgentTool<any> => ({
    name, label, description, parameters,
    execute: async (_id, params) => {
      const r = await execute(params);
      return { content: [{ type: "text", text: r.text }], details: null, terminate: r.terminate };
    },
  });

  const tools: AgentTool<any>[] = [
    T("open_app", "Open app", `Open one of the console's apps. Valid names: ${APPS}.`,
      Type.Object({ app: Type.String({ description: "app name from the valid list" }) }),
      async ({ app }) => {
        const a = String(app).toLowerCase().trim();
        const ok = props.onCommand(a);
        widget({ t: "app", app: a, ok });
        if (ok) { sfx.confirm(); setTimeout(() => props.onClose(), 750); }
        return { text: ok ? `Opened ${a}.` : `No app called "${a}" on this console.`, terminate: ok };
      }),
    T("search_youtube", "YouTube search", "Search YouTube and show the results, ready to play.",
      Type.Object({ query: Type.String({ description: "what to search for" }) }),
      async ({ query }) => {
        const ok = props.onCommand("youtube-search", String(query));
        widget({ t: "app", app: `youtube — “${query}”`, ok });
        if (ok) { sfx.confirm(); setTimeout(() => props.onClose(), 750); }
        return { text: ok ? `Searching YouTube for ${query}.` : "YouTube app unavailable.", terminate: ok };
      }),
    T("show_career", "Career card", "Show Abhishek's career timeline card.",
      Type.Object({}), async () => { widget({ t: "career" }); return { text: "Career card shown.", terminate: true }; }),
    T("show_projects", "Projects card", "Show Abhishek's projects card.",
      Type.Object({}), async () => { widget({ t: "projects" }); return { text: "Projects card shown.", terminate: true }; }),
    T("show_skills", "Skills card", "Show Abhishek's skills card.",
      Type.Object({}), async () => { widget({ t: "skills" }); return { text: "Skills card shown.", terminate: true }; }),
    T("show_contact", "Contact card", "Show contact options for Abhishek (email, LinkedIn, phone).",
      Type.Object({}), async () => { widget({ t: "contact" }); return { text: "Contact card shown.", terminate: true }; }),
    T("get_weather", "Weather", "Show current weather at the visitor's location.",
      Type.Object({}), async () => {
        const data = await fetchWeather();
        widget({ t: "weather", data });
        return { text: `It's ${data.temp}° with ${wmo(data.code)[1]} in ${data.place}.`, terminate: true };
      }),
    T("console_status", "Console status", "Report this console's stats: trophies earned, games in the library, and time played. Use when the user asks what they've done here, their progress, or their trophies count.",
      Type.Object({}), async () => ({ text: props.consoleStatus(), terminate: false })),
    T("console_control", "Console control", "Operate the console: run any action from the CONSOLE ACTIONS list (settings, radio, themes, world tour, ISS, screensaver, XMB navigation…). Pass the action id plus that action's parameter, e.g. {\"action\":\"settings.theme\",\"name\":\"Crimson\"}.",
      Type.Object({
        action: Type.String({ description: "action id, e.g. settings.theme or map.world_tour" }),
        name: Type.Optional(Type.String({ description: "for app.open (app name) / settings.theme (theme name)" })),
        state: Type.Optional(Type.String({ description: "on or off — for settings.sound / settings.rumble" })),
        query: Type.Optional(Type.String({ description: "for youtube.search" })),
        format: Type.Optional(Type.String({ description: "12 or 24 — for settings.clock" })),
        minutes: Type.Optional(Type.String({ description: "for settings.screensaver" })),
        category: Type.Optional(Type.String({ description: "for xmb.goto" })),
        args: Type.Optional(Type.Object({}, { additionalProperties: true })),
      }),
      async (p: any) => {
        // models sometimes flatten args to the top level — merge them back
        const { action, args, ...flat } = p ?? {};
        const text = await runAction(String(action), { ...(args ?? {}), ...flat });
        const ok = !/^(Unknown action|Action ")/i.test(text);
        widget({ t: "app", app: String(action), ok });
        return { text, terminate: ok };
      }),
  ];

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { sfx.back(); props.onClose(); } };
    addEventListener("keydown", esc);
    // —— push-to-talk: hold N to talk (ignored while typing in the box), and
    // hold R2 (controller button 7) — polled, since nav is disabled here. ——
    const typing = () => { const t = document.activeElement?.tagName; return t === "INPUT" || t === "TEXTAREA"; };
    const kd = (e: KeyboardEvent) => { if (e.repeat || e.key.toLowerCase() !== "n" || typing()) return; e.preventDefault(); pttStart(); };
    const ku = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "n") pttEnd(); };
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    let raf = 0, r2Prev = false;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const on = !!primaryPad()?.buttons[7]?.pressed;
      if (on && !r2Prev) pttStart();
      else if (!on && r2Prev) pttEnd();
      r2Prev = on;
    };
    raf = requestAnimationFrame(poll);
    // register ALL cleanups synchronously — Solid loses the owner after an await
    onCleanup(() => {
      setNavEnabled(true);
      removeEventListener("keydown", esc);
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      cancelAnimationFrame(raf);
      rec?.abort?.();
      stopSpeaking();
      engine?.unload();
    });
    (async () => {
      restored = await loadChat(chatKey()); // prior chat, if any
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
      buildIndex().catch(() => {}); // warm the RAG index in the background
      // the control-bus manifest goes straight into the system prompt, so the
      // copilot always knows exactly what it can operate
      const SYSTEM_LIVE = `${SYSTEM}

# CONSOLE ACTIONS (invoke with the console_control tool)
${capabilitySummary()}
Examples — these MUST become console_control calls (flat JSON, no nesting):
- "turn the music on/off" → {"action":"radio.lofi"} / {"action":"radio.stop"}
- "mute" / "unmute" → {"action":"settings.sound","state":"off"} / {"action":"settings.sound","state":"on"}
- "make the console purple/red" → {"action":"settings.theme","name":"Orchid"} / {"action":"settings.theme","name":"Crimson"}
- "start the world tour" / "show me the ISS" → {"action":"map.world_tour"} / {"action":"map.iss"}
- "12 hour clock" → {"action":"settings.clock","format":"12"}
- "turn off vibration" → {"action":"settings.rumble","state":"off"}`;
      agent = new Agent({
        // seed the model's memory with the prior conversation so it remembers
        initialState: { systemPrompt: SYSTEM_LIVE, model: webllmModel(MODELS[key].id), tools, messages: (restored?.messages as any) ?? [] },
        streamFn: webllmStreamFn(() => engine),
        // RAG: pull the most relevant facts for the latest question and slot
        // them in just before it — grounds answers without bloating memory
        transformContext: async (msgs) => {
          const lastUser = [...msgs].reverse().find((m) => m.role === "user");
          if (!lastUser) return msgs;
          const q = typeof lastUser.content === "string" ? lastUser.content : lastUser.content.map((c: any) => c.text ?? "").join(" ");
          const facts = await retrieve(q, 4);
          if (!facts.length) return msgs;
          const ref = { role: "user" as const, content: `Reference facts (use only if relevant to the question):\n${facts.map((f) => "• " + f).join("\n")}`, timestamp: Date.now() };
          const idx = msgs.lastIndexOf(lastUser);
          return [...msgs.slice(0, idx), ref, ...msgs.slice(idx)];
        },
      });
      if (import.meta.env.DEV) (window as any).__agent = agent;
      agent.subscribe((ev) => {
        if (ev.type === "message_start" && (ev as any).message?.role === "assistant") {
          pushItem({ kind: "msg", role: "assistant", text: "" });
        }
        if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
          const d = ev.assistantMessageEvent.delta;
          setItems((x) => {
            const out = [...x];
            for (let i = out.length - 1; i >= 0; i--) {
              const it = out[i];
              if (it.kind === "msg" && it.role === "assistant") { out[i] = { ...it, text: it.text + d }; break; }
            }
            return out;
          });
          scroll();
        }
        if (ev.type === "message_end" && (ev as any).message?.role === "assistant") {
          // a turn that was pure tool-call leaves an empty bubble — drop it
          setItems((x) => {
            const out = [...x];
            for (let i = out.length - 1; i >= 0; i--) {
              const it = out[i];
              if (it.kind === "msg" && it.role === "assistant") {
                if (!it.text.trim()) out.splice(i, 1);
                break;
              }
            }
            return out;
          });
        }
        if (ev.type === "agent_end") {
          setBusy(false);
          persist(); // transcript + memory to IndexedDB
          if (voice()) {
            // speak the last non-empty assistant bubble
            const last = [...items()].reverse().find((it) => it.kind === "msg" && (it as any).role === "assistant" && (it as any).text.trim());
            if (last) speak((last as any).text).catch(() => {});
          }
        }
      });
      setReady(true);
      setProgress("");
      // resume the saved transcript, or greet on a fresh chat
      if (restored?.items?.length) {
        setItems(restored.items as ChatItem[]);
      } else {
        setItems([{
          kind: "msg", role: "assistant",
          text: "Online — a pi.dev agent running on your GPU. Ask about Abhishek (I'll pull up cards), or tell me things: “open doom”, “search lofi on youtube”, “what's the weather”. Tap the mic to talk.",
        }]);
      }
      setTimeout(() => scroll(), 60);
    } catch (e) {
      setProgress(`Couldn't load the model — ${String(e).slice(0, 120)}`);
    }
  }

  function persist() {
    saveChat(chatKey(), { items: items(), messages: (agent?.state.messages as unknown[]) ?? [], modelKey: model() ?? undefined });
  }

  function newChat() {
    sfx.back();
    restored = null;
    clearChat(chatKey());
    agent = null;
    setReady(false);
    setModel(null); // back to the brain picker; a fresh chat has no memory
    setItems([]);
  }

  function send(text?: string) {
    const t = (text ?? input.value).trim();
    if (!t || busy() || !agent) return;
    input.value = "";
    props.onFirstChat();
    pushItem({ kind: "msg", role: "user", text: t });
    persist(); // save the user turn immediately, in case generation is interrupted
    setBusy(true);
    agent.prompt(t).catch(() => {
      pushItem({ kind: "msg", role: "assistant", text: "…my circuits hiccuped. Try again?" });
      setBusy(false);
    });
  }

  // —— voice output: on-device TTS, downloaded on first enable ——
  async function toggleVoice() {
    if (voice()) { setVoice(false); stopSpeaking(); return; }
    sfx.tickH();
    if (!(window as any).__ttsReady) {
      setVoiceLoading(true);
      try { await loadTTS(); (window as any).__ttsReady = true; }
      catch { setVoiceLoading(false); return; }
      setVoiceLoading(false);
    }
    setVoice(true);
  }

  // —— voice input: PUSH-TO-TALK. Hold to talk, release to send. On-device
  // Whisper (private) when available, else the Web Speech API. Three ways to
  // hold the same trigger: the mic button (pointer), the N key (keyboard, when
  // you're not typing in the box), or R2 on a controller. ——
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  const micAvailable = asrSupported() || !!SR;
  let recording: { stop: () => void; done: Promise<string> } | null = null;
  let ptt = false; // a hold is currently in progress

  function pttStart() {
    if (ptt || busy() || !ready()) return; // needs a booted agent to send to
    ptt = true;
    sfx.tickH();
    setListening(true);
    if (asrSupported()) {
      recording = record();
      recording.done
        .then((text) => { setListening(false); if (text.trim()) send(text); })
        .catch(() => setListening(false));
    } else if (SR) {
      let acc = "";
      rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.onresult = (e: any) => { acc = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(""); };
      rec.onend = () => { setListening(false); if (acc.trim()) send(acc); };
      rec.onerror = () => setListening(false);
      try { rec.start(); } catch { setListening(false); }
    } else {
      ptt = false; setListening(false);
    }
  }
  function pttEnd() {
    if (!ptt) return;
    ptt = false;
    if (recording) { const r = recording; recording = null; r.stop(); } // .done transcribes + sends
    else rec?.stop?.(); // SR onend transcribes + sends
  }

  return (
    <div class="ai pad-focus-scope">
      <div class="ai-head">
        <div class="panel-tag">
          AI ABHISHEK — {model() ? `${MODELS[model()!].label} · ` : ""}PI.DEV AGENT · WEBGPU, ON-DEVICE
        </div>
        <Show when={ready() && ttsSupported()}>
          <button class="ghost-btn ai-iconbtn" classList={{ on: voice() }} title="speak replies aloud (on-device)" onClick={toggleVoice}>
            <span class="ai-ico"><Icon name="speaker" /></span>{voiceLoading() ? "voice…" : voice() ? "voice on" : "voice"}
          </button>
        </Show>
        <Show when={ready()}>
          <button class="ghost-btn ai-iconbtn" title="clear this chat's history & memory" onClick={newChat}>
            <span class="ai-ico"><Icon name="plus" /></span>new chat
          </button>
        </Show>
        <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
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
                        <span class="ai-model-name"><span class="ai-ico"><Icon name={key === "agent" ? "chip" : "lightning"} /></span>{m.label}</span>
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
                <For each={items()}>
                  {(it) => (
                    <Switch>
                      <Match when={it.kind === "msg"}>
                        <div class="ai-msg" classList={{ user: (it as any).role === "user" }}>
                          {(it as any).text || "▋"}
                        </div>
                      </Match>
                      <Match when={it.kind === "widget"}>
                        <AiWidget w={(it as any).w} />
                      </Match>
                    </Switch>
                  )}
                </For>
                <Show when={busy()}><div class="ai-msg ai-thinking">▋</div></Show>
              </div>
              <Show when={listening()}>
                <div class="ai-listening"><span class="ai-listening-dot" />Listening… <span class="ai-listening-dim">release to send</span></div>
              </Show>
              <div class="ai-inputrow">
                <input
                  ref={input}
                  class="ai-input"
                  placeholder={busy() ? "thinking…" : listening() ? "listening… release to send" : micAvailable ? "Hold N or R2 to talk · or click here to type" : "Ask: open doom · his skills · what's the weather"}
                  disabled={busy()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") send();
                    if (e.key === "Escape") { sfx.back(); props.onClose(); }
                  }}
                />
                <Show when={micAvailable}>
                  <button
                    class="ai-mic"
                    classList={{ listening: listening() }}
                    title="Hold to talk (or hold N / R2)"
                    onPointerDown={(e) => { e.preventDefault(); pttStart(); }}
                    onPointerUp={pttEnd}
                    onPointerLeave={(e) => { if (e.buttons) pttEnd(); }}
                    onPointerCancel={pttEnd}
                    onContextMenu={(e) => e.preventDefault()}
                  ><span class="ai-ico"><Icon name="mic" /></span></button>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

// —— the widgets: portfolio cards that pop right into the conversation ——
function AiWidget(props: { w: Widget }) {
  const w = props.w;
  return (
    <Switch>
      <Match when={w.t === "app"}>
        <div class="ai-widget ai-w-app"><span class="ai-ico"><Icon name="gamepad" /></span>{(w as any).ok ? `Launching ${(w as any).app}…` : `Couldn't find “${(w as any).app}”`}</div>
      </Match>
      <Match when={w.t === "career"}>
        <div class="ai-widget">
          <div class="ai-w-title">CAREER</div>
          <For each={CAREER}>
            {(c) => (
              <div class="ai-w-row">
                <div class="ai-w-tag">{c.tag}</div>
                <div><div class="ai-w-strong">{c.title}</div><div class="ai-w-dim">{c.bullets[0]}</div></div>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={w.t === "projects"}>
        <div class="ai-widget">
          <div class="ai-w-title">PROJECTS</div>
          <For each={PROJECTS}>
            {(p) => (
              <div class="ai-w-row">
                <div><div class="ai-w-strong">{p.title}</div><div class="ai-w-dim">{p.meta} — {p.bullets[0]}</div></div>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={w.t === "skills"}>
        <div class="ai-widget">
          <div class="ai-w-title">SKILLS</div>
          <For each={SKILLS}>
            {(s) => (
              <div class="ai-w-skill">
                <span class="ai-w-tag">{s.name}</span>
                <span class="ai-w-chips"><For each={s.items}>{(i) => <span class="ai-w-chip">{i}</span>}</For></span>
              </div>
            )}
          </For>
        </div>
      </Match>
      <Match when={w.t === "contact"}>
        <div class="ai-widget ai-w-contactrow">
          <a class="ps2-launch ai-w-btn" href={`mailto:${OWNER.email}`}><span class="ai-ico"><Icon name="mail" /></span>Email</a>
          <a class="ps2-launch ai-w-btn" href={OWNER.linkedin} target="_blank"><span class="ai-ico"><Icon name="link" /></span>LinkedIn</a>
          <a class="ps2-launch ai-w-btn" href={`tel:${OWNER.phone.replace(/\s/g, "")}`}><span class="ai-ico"><Icon name="phone" /></span>Call</a>
        </div>
      </Match>
      <Match when={w.t === "weather"}>
        <div class="ai-widget">
          <div class="ai-w-title">WEATHER — {(w as any).data.place.toUpperCase()}</div>
          <div class="ai-w-weathernow">{wmo((w as any).data.code)[0]} {(w as any).data.temp}° <span class="ai-w-dim">wind {(w as any).data.wind} km/h</span></div>
          <div class="ai-w-days">
            <For each={(w as any).data.days.slice(0, 3)}>
              {(d: any) => <span class="ai-w-chip">{d.day} {wmo(d.code)[0]} {d.min}–{d.max}°</span>}
            </For>
          </div>
        </div>
      </Match>
    </Switch>
  );
}
