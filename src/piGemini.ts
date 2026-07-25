// pi.dev ↔ Chrome Built-in AI (Gemini Nano) bridge. When the browser ships the
// Prompt API, this is the PREFERRED brain — it's on-device, hardware-accelerated,
// and needs ZERO model download from us (the model is the browser's, shared
// across all sites). Same Hermes <tool_call> convention + shared parser as the
// WebLLM path (piStream.ts), so the pi-agent tool loop is identical.
import type { Context, Model } from "@earendil-works/pi-ai";
import { makeStream, toMessages } from "./piStream";

export type GeminiState = "available" | "downloadable" | "downloading" | "unavailable";

// The Prompt API is exposed as a global `LanguageModel` in Chrome 148+; older
// origin-trial builds hung it off `self.ai.languageModel`. Support both.
function getLM(): any | null {
  const g: any = globalThis;
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** Is Chrome's built-in Gemini Nano usable here? "unavailable" if the API is absent. */
export async function geminiAvailability(): Promise<GeminiState> {
  const LM = getLM();
  if (!LM) return "unavailable";
  try {
    if (typeof LM.availability === "function") {
      const a = await LM.availability();
      if (a === "available" || a === "downloadable" || a === "downloading") return a;
      return "unavailable";
    }
    // older API shape: capabilities() → { available: "readily"|"after-download"|"no" }
    if (typeof LM.capabilities === "function") {
      const c = await LM.capabilities();
      return c?.available === "readily" ? "available" : c?.available === "after-download" ? "downloadable" : "unavailable";
    }
  } catch { /* treat any probe failure as unavailable */ }
  return "unavailable";
}

export const geminiModel = (): Model<any> =>
  ({
    id: "gemini-nano",
    name: "Gemini Nano",
    api: "openai-completions",
    provider: "gemini-nano",
    baseUrl: "local://gemini-nano",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  }) as unknown as Model<any>;

/** Build a pi StreamFn backed by Chrome's on-device Gemini Nano. */
export function geminiNanoStreamFn(onDownload?: (pct: number) => void) {
  return (model: Model<any>, context: Context) =>
    makeStream(model, context, "gemini-nano", async function* () {
      const LM = getLM();
      if (!LM) throw new Error("Gemini Nano is not available in this browser.");
      // Stateless per call (matches the WebLLM path): rebuild the full context as
      // the session's initialPrompts (system first, then the alternating turns),
      // then prompt the final turn. RAG-injected context changes each turn, so
      // re-sending is correct; the ceiling is O(n) history re-ingest per turn.
      const msgs = toMessages(context);
      const input = msgs[msgs.length - 1]?.content ?? "";
      const initialPrompts = msgs.slice(0, -1);
      const session = await LM.create({
        initialPrompts,
        ...(onDownload
          ? { monitor(m: any) { m.addEventListener?.("downloadprogress", (e: any) => onDownload(Math.round((e.loaded ?? 0) * 100))); } }
          : {}),
      });
      try {
        const rs: ReadableStream<string> = session.promptStreaming(input);
        const reader = rs.getReader();
        // Chrome ≥129 streams DELTAS; older builds streamed the CUMULATIVE text.
        // Detect: if a chunk extends the accumulated string, it's cumulative.
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = String(value ?? "");
          if (chunk.startsWith(acc) && chunk.length >= acc.length) {
            const d = chunk.slice(acc.length);
            acc = chunk;
            if (d) yield d;
          } else {
            acc += chunk;
            yield chunk;
          }
        }
      } finally {
        try { session.destroy?.(); } catch { /* session already gone */ }
      }
    });
}
