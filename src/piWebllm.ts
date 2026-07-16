// pi.dev agent runtime ↔ WebLLM bridge. pi-agent-core drives the tool loop;
// this file supplies its StreamFn from an in-browser MLC engine (Llama 3.2 /
// Hermes 3 on WebGPU). Tool calls use the Hermes <tool_call> JSON convention,
// parsed here into pi's typed ToolCall blocks — no servers, no API keys.
import * as piai from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
// the class is a runtime export, but the package's duplicate `export type`
// re-export makes TS treat the name as type-only — grab the value dynamically
const EventStreamCls = (piai as any).AssistantMessageEventStream;
import type { MLCEngine } from "@mlc-ai/web-llm";

export const webllmModel = (id: string): Model<any> =>
  ({
    id,
    name: id,
    api: "openai-completions",
    provider: "webllm",
    baseUrl: "local://webllm",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 640,
  }) as unknown as Model<any>;

const zeroUsage = () => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function toolsSection(tools: Tool[] | undefined): string {
  if (!tools?.length) return "";
  // compact signatures, NOT raw JSON schemas — small models parrot schema
  // fields ("type", "properties") into their arguments if they ever see them
  const specs = tools.map((t) => {
    const props = (t.parameters as any)?.properties ?? {};
    const sig = Object.entries(props)
      .map(([k, v]: [string, any]) => `${k}: ${v?.description ?? v?.type ?? "string"}`)
      .join(", ");
    return `- ${t.name}(${sig}) — ${t.description}`;
  }).join("\n");
  return `

# Tools
You can call tools. To call one, output EXACTLY one line — the literal tags with a small JSON object between them:
<tool_call>{"name": "TOOL_NAME", "arguments": {"param": "value"}}</tool_call>
Example — user says "play doom", you output:
<tool_call>{"name": "open_app", "arguments": {"app": "doom"}}</tool_call>
The arguments object holds ONLY the parameter values. Never invent tool names. Available tools:
${specs}
Call a tool ONLY when the user's request matches it; otherwise just answer normally in plain text.`;
}

const textOf = (content: string | { type: string; text?: string }[]): string =>
  typeof content === "string" ? content : content.map((c) => ("text" in c ? c.text : "")).filter(Boolean).join("\n");

/** pi Context → OpenAI-shaped messages WebLLM understands. */
function toWebllmMessages(context: Context): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  out.push({ role: "system", content: (context.systemPrompt ?? "") + toolsSection(context.tools) });
  for (const m of context.messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: textOf(m.content as any) });
    } else if (m.role === "assistant") {
      const text = m.content.filter((c) => c.type === "text").map((c: any) => c.text).join("\n");
      const calls = m.content.filter((c): c is ToolCall => c.type === "toolCall")
        .map((c) => `<tool_call>${JSON.stringify({ name: c.name, arguments: c.arguments })}</tool_call>`)
        .join("\n");
      out.push({ role: "assistant", content: [text, calls].filter(Boolean).join("\n") });
    } else if (m.role === "toolResult") {
      // small local models handle tool output best as a plain user turn
      out.push({
        role: "user",
        content: `<tool_response>${JSON.stringify({ tool: m.toolName, isError: m.isError, content: m.content.map((c: any) => c.text ?? "").join("\n") })}</tool_response>`,
      });
    }
  }
  return out;
}

const CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/** Build a pi StreamFn backed by a live MLC engine. */
export function webllmStreamFn(getEngine: () => MLCEngine | null) {
  return (model: Model<any>, context: Context): AssistantMessageEventStream => {
    const stream: AssistantMessageEventStream = new EventStreamCls();
    const base = (): AssistantMessage => ({
      role: "assistant", content: [], api: "openai-completions" as any, provider: "webllm" as any,
      model: model.id, usage: zeroUsage(), stopReason: "stop", timestamp: Date.now(),
    });

    (async () => {
      const engine = getEngine();
      if (!engine) {
        stream.push({ type: "error", reason: "error", error: { ...base(), stopReason: "error", errorMessage: "Model not loaded." } });
        return;
      }
      try {
        stream.push({ type: "start", partial: base() });
        const chunks = await engine.chat.completions.create({
          messages: toWebllmMessages(context) as any,
          stream: true,
          temperature: 0.2, // tool-calling wants determinism, tiny models doubly so
          max_tokens: 640,
        });

        let full = "";
        let emitted = 0;
        let textStarted = false;
        const partial = () => {
          const p = base();
          p.content = [{ type: "text", text: full.slice(0, emitted) }];
          return p;
        };
        for await (const c of chunks) {
          full += c.choices[0]?.delta?.content ?? "";
          // stream text up to (but never inside) a tool call; hold back a tag's
          // worth of chars so a "<tool_call>" split across chunks can't leak.
          // Small models often emit BARE JSON calls (no tags) — if the reply
          // opens as JSON or a fence, hold everything for the final parse.
          const opensAsJson = /^[{`<]/.test(full.trimStart());
          const callAt = full.indexOf("<tool_call");
          const safe = opensAsJson ? 0 : callAt !== -1 ? callAt : Math.max(emitted, full.length - 12);
          if (safe > emitted) {
            if (!textStarted) { textStarted = true; stream.push({ type: "text_start", contentIndex: 0, partial: partial() }); }
            const delta = full.slice(emitted, safe);
            emitted = safe;
            stream.push({ type: "text_delta", contentIndex: 0, delta, partial: partial() });
          }
        }

        // final parse: prose + any tool calls
        const calls: ToolCall[] = [];
        let malformed = false;
        const toolByName = new Map((context.tools ?? []).map((t) => [t.name, t]));
        const addCall = (p: any): boolean => {
          if (typeof p?.name !== "string") return false;
          let args = p.arguments ?? p.parameters ?? {};
          // tiny models pad arguments with schema junk — strip those keys, but
          // KEEP unknown ones (models also flatten nested args to the top level;
          // tools like console_control merge them back)
          const JUNK = new Set(["type", "properties", "required", "parameters", "description", "additionalProperties"]);
          if (args && typeof args === "object") {
            args = Object.fromEntries(Object.entries(args).filter(([k]) => !JUNK.has(k)));
          }
          calls.push({ type: "toolCall", id: `call_${Date.now().toString(36)}_${calls.length}`, name: p.name, arguments: args });
          return true;
        };
        // largest balanced {...} starting at the first brace — survives trailing garbage
        const balanced = (s: string): string | null => {
          const start = s.indexOf("{");
          if (start === -1) return null;
          let d = 0;
          for (let i = start; i < s.length; i++) {
            if (s[i] === "{") d++;
            else if (s[i] === "}" && --d === 0) return s.slice(start, i + 1);
          }
          return null;
        };
        // parse with escalating repairs: balanced slice → strip trailing junk
        // (stray ">" etc.) → quote bare keys ({name:"x"} → {"name":"x"}) →
        // close any dangling braces
        const parseLoose = (s: string): any => {
          let js = (balanced(s) ?? s).trim();
          try { return JSON.parse(js); } catch { /* try repair */ }
          js = js.slice(0, js.lastIndexOf("}") + 1);
          if (!js) return null;
          js = js.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
          const open = (js.match(/\{/g) ?? []).length - (js.match(/\}/g) ?? []).length;
          try { return JSON.parse(js + "}".repeat(Math.max(0, open))); } catch { return null; }
        };
        let text = full.replace(CALL_RE, (_, json) => {
          const p = parseLoose(json);
          if (!p || !addCall(p)) malformed = true;
          return "";
        }).replace(/<\/?tool_call>/g, "").trim();
        if (!calls.length) {
          // tolerate tag-less calls: a bare JSON object or a ```json fence
          const known = new Set(toolByName.keys());
          const bare = (text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)?.[1] ?? text).trim();
          if (bare.startsWith("{")) {
            const p = parseLoose(bare);
            if (known.has(p?.name) && addCall(p)) text = "";
          }
          // salvage the attribute mangle: <tool_call name="open_app" arguments="doom">
          const attr = text.match(/<tool_call\s+name="([\w-]+)"([^>]*)>?/);
          if (!calls.length && attr && known.has(attr[1])) {
            const tool = (context.tools ?? []).find((t) => t.name === attr[1])!;
            const props = Object.keys((tool.parameters as any)?.properties ?? {});
            const vals = [...attr[2].matchAll(/(\w+)="([^"]*)"/g)].filter(([, k]) => !["parameters", "type"].includes(k));
            const args: Record<string, string> = {};
            for (const [, k, v] of vals) if (props.includes(k)) args[k] = v;
            // a lone unlabeled value + a single-param schema → pair them up
            if (!Object.keys(args).length && props.length === 1 && vals[0]) args[props[0]] = vals[0][2];
            addCall({ name: attr[1], arguments: args });
            text = "";
          }
          // salvage the tool-name-as-tag mangle: <show_contact>{...}</show_contact>
          if (!calls.length) {
            for (const name of known) {
              const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)(?:</${name}>|$)`);
              const m = text.match(re);
              if (m) {
                const inner = parseLoose(m[1] ?? "");
                addCall({ name, arguments: inner && typeof inner === "object" && !("name" in inner) ? inner : {} });
                text = text.replace(re, "").trim();
                break;
              }
            }
          }
        }

        if ((import.meta as any).env?.DEV) (globalThis as any).__lastLLM = full;
        if (!text && !calls.length && malformed) {
          text = "I tried to use a tool but fumbled the format — ask me again?";
        }
        const msg = base();
        msg.content = [
          ...(text ? [{ type: "text" as const, text }] : []),
          ...calls,
        ];
        if (text) {
          if (!textStarted) stream.push({ type: "text_start", contentIndex: 0, partial: msg });
          if (text.length > emitted) stream.push({ type: "text_delta", contentIndex: 0, delta: text.slice(emitted), partial: msg });
          stream.push({ type: "text_end", contentIndex: 0, content: text, partial: msg });
        }
        calls.forEach((tc, i) => stream.push({ type: "toolcall_end", contentIndex: (text ? 1 : 0) + i, toolCall: tc, partial: msg }));
        msg.stopReason = calls.length ? "toolUse" : "stop";
        stream.push({ type: "done", reason: msg.stopReason as any, message: msg });
      } catch (e) {
        stream.push({ type: "error", reason: "error", error: { ...base(), stopReason: "error", errorMessage: String(e).slice(0, 200) } });
      }
    })();

    return stream;
  };
}
