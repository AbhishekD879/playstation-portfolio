// pi.dev ↔ WebLLM bridge. Supplies a StreamFn from an in-browser MLC engine
// (Llama 3.2 / Hermes 3 on WebGPU). The shared parser/streamer lives in
// piStream.ts; this file only turns the engine's token stream into deltas.
import type { Context, Model } from "@earendil-works/pi-ai";
import type { MLCEngine } from "@mlc-ai/web-llm";
import { makeStream, toMessages } from "./piStream";

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

/** Build a pi StreamFn backed by a live MLC engine. */
export function webllmStreamFn(getEngine: () => MLCEngine | null) {
  return (model: Model<any>, context: Context) =>
    makeStream(model, context, "webllm", async function* () {
      const engine = getEngine();
      if (!engine) throw new Error("Model not loaded.");
      const chunks = await engine.chat.completions.create({
        messages: toMessages(context) as any,
        stream: true,
        temperature: 0.2, // tool-calling wants determinism, tiny models doubly so
        max_tokens: 640,
      });
      for await (const c of chunks) yield c.choices[0]?.delta?.content ?? "";
    });
}
