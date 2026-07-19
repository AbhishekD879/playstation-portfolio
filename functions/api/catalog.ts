// Free & Open catalog store — Cloudflare Pages Function backed by KV.
//   GET  /api/catalog  → PUBLIC: the owner-published custom entries (the public
//                        app merges these onto the built-in curated list).
//   POST /api/catalog  → ADMIN: replaces the entry set. Gated by Cloudflare
//                        Access — we verify the CF_Authorization JWT (signed by
//                        your Access team) so a direct POST that didn't pass
//                        Access is rejected. Requires two env vars set in the
//                        Pages project (Settings → Variables):
//                          ACCESS_TEAM_DOMAIN  e.g. "abhishekstation" (the part
//                            before .cloudflareaccess.com)
//                          ACCESS_AUD          the Access application's AUD tag
//                        Until both are set, writes are refused (fail-safe).
interface Env {
  GB: KVNamespace;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

type Entry = { id: string; name: string; url: string; note: string; category: string };
const KEY = "catalog:v1";
const MAX = 2000;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.GB.get(KEY);
  return json({ entries: raw ? JSON.parse(raw) : [] });
};

// —— Cloudflare Access JWT verification (RS256 against the team's JWKS) ————————
function b64urlBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlStr = (s: string) => new TextDecoder().decode(b64urlBytes(s));

async function verifiedEmail(request: Request, env: Env): Promise<string | null> {
  const team = env.ACCESS_TEAM_DOMAIN, aud = env.ACCESS_AUD;
  if (!team || !aud) return null; // not configured → deny (fail-safe)
  const cookie = request.headers.get("Cookie") || "";
  const cm = cookie.match(/CF_Authorization=([^;]+)/);
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion") || (cm ? cm[1] : "");
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header: { kid?: string }, payload: { aud?: string | string[]; exp?: number; email?: string };
  try { header = JSON.parse(b64urlStr(h)); payload = JSON.parse(b64urlStr(p)); } catch { return null; }
  const certs = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`).then((r) => r.json() as Promise<{ keys: JsonWebKey[] & { kid?: string }[] }>).catch(() => null);
  const jwk = certs?.keys?.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload.email || "admin";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifiedEmail(request, env);
  if (!email) return json({ error: "unauthorized — put /admin + this route behind Cloudflare Access and set ACCESS_TEAM_DOMAIN / ACCESS_AUD" }, 401);

  let body: { entries?: unknown };
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const arr = Array.isArray(body?.entries) ? body.entries : null;
  if (!arr) return json({ error: "entries[] required" }, 400);
  if (arr.length > MAX) return json({ error: `too many entries (max ${MAX})` }, 400);

  const clean: Entry[] = [];
  const seen = new Set<string>();
  for (const raw of arr as Record<string, unknown>[]) {
    const url = String(raw?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;            // only real http(s) links
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({
      id: String(raw?.id ?? "").slice(0, 40) || crypto.randomUUID(),
      name: String(raw?.name ?? "").trim().slice(0, 80),
      url: url.slice(0, 400),
      note: String(raw?.note ?? "").trim().slice(0, 160),
      category: (String(raw?.category ?? "").trim().slice(0, 60)) || "Added by owner",
    });
  }
  await env.GB.put(KEY, JSON.stringify(clean));
  return json({ ok: true, count: clean.length, by: email });
};
