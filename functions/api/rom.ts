// Relay for free-game downloads whose host sends no CORS header (mamedev.org).
// Deliberately not a proxy: the host must be on the allow-list, the scheme must
// be https, redirects are not followed off-list, and the body is capped. The
// same per-IP rate limit as the reader uses (GB KV), so this stays a download
// button, not an open relay.
interface Env {
  GB: KVNamespace;
}

// keep in sync with RELAY_HOSTS in src/freegames.ts
const ALLOWED_HOSTS = new Set(["www.mamedev.org", "mamedev.org"]);
const MAX_BYTES = 64 * 1024 * 1024;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ip = request.headers.get("cf-connecting-ip") ?? "?";
  const rlKey = `rom:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const n = parseInt((await env.GB.get(rlKey)) ?? "0", 10);
  if (n > 30) return new Response("Rate limit — a few downloads a minute is plenty.", { status: 429 });
  await env.GB.put(rlKey, String(n + 1), { expirationTtl: 120 });

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try { target = new URL(raw); } catch { return new Response("Bad URL", { status: 400 }); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) return new Response("Host not allowed", { status: 403 });

  let up: Response;
  try {
    up = await fetch(target.href, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; AbhishekStation downloads)" } });
  } catch {
    return new Response("Upstream refused", { status: 502 });
  }
  if (up.status >= 300 && up.status < 400) return new Response("Upstream redirected", { status: 502 });
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
