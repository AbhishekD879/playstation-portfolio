// Web search backend for the on-device LLM's `web_search` tool. The browser
// can't hit a search engine directly (no CORS, no key), so this same-origin
// Pages Function fetches DuckDuckGo server-side (no API key needed — same
// source the reader's ?q= already uses) and parses it into clean JSON
// [{title,url,snippet}] the model can reason over. Same-origin gated + rate
// limited via the guestbook KV so it isn't an open scraping proxy.
interface Env { GB: KVNamespace }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const originOk = (o: string | null) =>
  !o || /^http:\/\/localhost:\d+$/.test(o) || /^https:\/\/([a-z0-9-]+\.)?abhishekstation\.pages\.dev$/.test(o);

// strip tags + decode the handful of entities DDG emits
const clean = (s: string) =>
  s.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

// DDG wraps result links as //duckduckgo.com/l/?uddg=<encoded real url>
const realUrl = (href: string): string => {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  if (href.startsWith("//")) return "https:" + href;
  return href;
};

interface Hit { title: string; url: string; snippet: string }

function parseHtml(html: string, max: number): Hit[] {
  const anchors = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  const out: Hit[] = [];
  for (let i = 0; i < anchors.length && out.length < max; i++) {
    const url = realUrl(anchors[i][1]);
    const title = clean(anchors[i][2]);
    if (!/^https?:\/\//.test(url) || !title) continue;
    out.push({ title, url, snippet: clean(snips[i]?.[1] ?? "") });
  }
  return out;
}

// lite.duckduckgo.com fallback — plainer markup, direct links, its own snippet cells
function parseLite(html: string, max: number): Hit[] {
  const links = [...html.matchAll(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)];
  const out: Hit[] = [];
  for (let i = 0; i < links.length && out.length < max; i++) {
    const url = realUrl(links[i][1]);
    const title = clean(links[i][2]);
    if (!/^https?:\/\//.test(url) || !title) continue;
    out.push({ title, url, snippet: clean(snips[i]?.[1] ?? "") });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AbhishekStation)", accept: "text/html,*/*" },
    redirect: "follow",
  });
  return r.ok ? await r.text() : "";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!originOk(request.headers.get("Origin"))) return json({ error: "forbidden origin" }, 403);

  const p = new URL(request.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 300);
  const max = Math.min(8, Math.max(1, parseInt(p.get("n") ?? "5", 10) || 5));
  if (!q) return json({ error: "missing query" }, 400);

  // rate limit per IP (reuse the guestbook KV, like the reader)
  const ip = request.headers.get("cf-connecting-ip") ?? "?";
  const rlKey = `srch:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const n = parseInt((await env.GB?.get(rlKey)) ?? "0", 10);
  if (n > 30) return json({ error: "rate limit — slow down" }, 429);
  await env.GB?.put(rlKey, String(n + 1), { expirationTtl: 120 });

  try {
    let hits = parseHtml(await fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q)), max);
    if (!hits.length) hits = parseLite(await fetchText("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q)), max);
    return json({ query: q, results: hits });
  } catch {
    return json({ query: q, results: [], error: "search unavailable" }, 502);
  }
};
