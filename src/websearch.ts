// Client for the same-origin /api/search Pages Function (DuckDuckGo → JSON).
// Powers the on-device LLM's web_search tool. Best-effort: returns [] on any
// failure so the agent can fall back to its own knowledge.
export interface WebResult { title: string; url: string; snippet: string }

export async function webSearch(query: string, n = 5): Promise<WebResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&n=${n}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.results) ? (d.results as WebResult[]).slice(0, n) : [];
  } catch {
    return [];
  }
}
