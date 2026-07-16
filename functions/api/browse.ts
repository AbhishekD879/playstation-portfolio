// Reader browser backend — server-side fetch + sanitize. Scripts/embeds are
// stripped (CSP enforces it twice), links are rewritten to stay inside the
// reader, images/styles load directly. Rate-limited per IP via the GB KV so
// this is a reading tool, not an open proxy. ?q= searches DuckDuckGo.
interface Env {
  GB: KVNamespace;
}

const abs = (u: string, base: string) => { try { return new URL(u, base).href; } catch { return ""; } };
const prox = (u: string) => (u && /^https?:/.test(u) ? `/api/browse?url=${encodeURIComponent(u)}` : u);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ip = request.headers.get("cf-connecting-ip") ?? "?";
  const rlKey = `br:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const n = parseInt((await env.GB.get(rlKey)) ?? "0", 10);
  if (n > 40) return new Response("Rate limit — one page at a time.", { status: 429 });
  await env.GB.put(rlKey, String(n + 1), { expirationTtl: 120 });

  const p = new URL(request.url).searchParams;
  let target = p.get("url") ?? "";
  const q = p.get("q");
  if (q) target = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
  if (!/^https?:\/\//i.test(target)) return new Response("Bad URL", { status: 400 });

  let up: Response;
  try {
    up = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; AbhishekStation reader)", accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
    });
  } catch {
    return new Response("<body style='background:#0a0e18;color:#ccc;font-family:sans-serif;padding:40px'>That site refused the connection.</body>",
      { status: 502, headers: { "content-type": "text/html" } });
  }

  const ct = up.headers.get("content-type") ?? "";
  const base = up.url;
  const headers = {
    "content-type": ct || "text/html; charset=utf-8",
    "cross-origin-embedder-policy": "credentialless",
    "content-security-policy": "default-src https: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'",
    "cache-control": "no-store",
  };
  if (!ct.includes("text/html")) return new Response(up.body, { headers });

  const strip = { element: (e: any) => e.remove() };
  return new HTMLRewriter()
    .on("script, iframe, object, embed, frame, noscript", strip)
    .on("*", {
      element(e: any) {
        const drop: string[] = [];
        for (const [name] of e.attributes) if (String(name).toLowerCase().startsWith("on")) drop.push(name);
        drop.forEach((a) => e.removeAttribute(a));
      },
    })
    .on("a", {
      element(e: any) {
        const h = e.getAttribute("href");
        if (h && !h.startsWith("#")) e.setAttribute("href", prox(abs(h, base)));
        e.removeAttribute("target");
      },
    })
    .on("img", {
      element(e: any) {
        const s = e.getAttribute("src");
        if (s) e.setAttribute("src", abs(s, base));
        e.removeAttribute("srcset");
        e.removeAttribute("loading");
      },
    })
    .on("link", {
      element(e: any) {
        const h = e.getAttribute("href");
        if (h) e.setAttribute("href", abs(h, base));
      },
    })
    .transform(new Response(up.body, { headers }));
};
