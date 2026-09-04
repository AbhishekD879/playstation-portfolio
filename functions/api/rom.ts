// Relay for free-game downloads whose host sends no CORS header (mamedev.org,
// GitHub release assets). Deliberately not a proxy: every hop — the URL and
// each redirect target — must be https and on the allow-list (GitHub only for
// release-download paths), and the body is capped. The same per-IP rate limit
// as the reader uses (GB KV), so this stays a download button, not an open relay.
interface Env {
  GB: KVNamespace;
}

// keep in sync with RELAY_HOSTS in src/freegames.ts (freegames.test.mjs checks the names appear here)
const ALLOWED: Record<string, RegExp | null> = {
  "www.mamedev.org": /^\/roms\//,
  "mamedev.org": /^\/roms\//,
  "github.com": /^\/[\w.-]+\/[\w.-]+\/releases\/(latest\/)?download\//,
  "release-assets.githubusercontent.com": null,
  "objects.githubusercontent.com": null,
};
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_HOPS = 4;

const allowed = (u: URL) => u.protocol === "https:" && u.hostname in ALLOWED && (ALLOWED[u.hostname]?.test(u.pathname) ?? true);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ip = request.headers.get("cf-connecting-ip") ?? "?";
  const rlKey = `rom:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const n = parseInt((await env.GB.get(rlKey)) ?? "0", 10);
  if (n > 30) return new Response("Rate limit — a few downloads a minute is plenty.", { status: 429 });
  await env.GB.put(rlKey, String(n + 1), { expirationTtl: 120 });

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("Bad URL", { status: 400 }); }
  if (!allowed(target)) return new Response("Host not allowed", { status: 403 });

  let up: Response | undefined;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    try {
      up = await fetch(target.href, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; AbhishekStation downloads)" } });
    } catch {
      return new Response("Upstream refused", { status: 502 });
    }
    if (up.status < 300 || up.status >= 400) break;
    const loc = up.headers.get("location");
    if (!loc) return new Response("Upstream redirected nowhere", { status: 502 });
    try { target = new URL(loc, target); } catch { return new Response("Bad redirect", { status: 502 }); }
    if (!allowed(target)) return new Response("Redirect off the allow-list", { status: 403 });
    up = undefined;
  }
  if (!up) return new Response("Too many redirects", { status: 502 });
  if (!up.ok) return new Response(`Upstream ${up.status}`, { status: 502 });
  const len = parseInt(up.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BYTES) return new Response("Too large", { status: 413 });

  return new Response(up.body, {
    headers: {
      "content-type": up.headers.get("content-type") ?? "application/octet-stream",
      "content-length": up.headers.get("content-length") ?? "",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": request.headers.get("origin") ?? "*",
      "cross-origin-resource-policy": "same-origin",
    },
  });
};
