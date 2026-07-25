// Shared pi.dev (pi-agent-core) tools — used by every place the on-device LLM
// runs (AiChat, SysTutor). The bridge in piWebllm.ts renders each tool's
// signature into the prompt and parses the model's <tool_call>; the agent runs
// execute() and feeds the result back, so the model answers WITH the results.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { webSearch, type WebResult } from "./websearch";

/** Give the model live web access. onResults lets a UI show the source chips. */
export function webSearchTool(onResults?: (query: string, results: WebResult[]) => void): AgentTool<any> {
  return {
    name: "web_search",
    label: "Web search",
    description: "Search the live web for current events, recent facts, documentation, prices, or anything you're unsure about or that happened after your training. Returns the top results with titles, snippets and links.",
    parameters: Type.Object({ query: Type.String({ description: "the search query" }) }),
    execute: async (_id: string, params: any) => {
      const q = String(params?.query ?? "").trim();
      const results = await webSearch(q, 5);
      onResults?.(q, results);
      const text = results.length
        ? `Web results for "${q}":\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`).join("\n")}\n\nAnswer the user's question using these results, and cite the source link(s) you relied on. If they don't cover it, say so.`
        : `The web search for "${q}" returned nothing. Tell the user the search came up empty and answer from your own knowledge if you can.`;
      return { content: [{ type: "text", text }], details: null, terminate: false };
    },
  };
}
