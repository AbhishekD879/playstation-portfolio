// Free & Open catalog — ADMIN write. This route lives UNDER /admin, which is
// protected by Cloudflare Access, so only the authenticated owner ever reaches
// it (unauthenticated requests are blocked at Cloudflare's edge — they never hit
// this code). No token verification, no team domain, no env vars needed.
//
// Defense-in-depth: Cloudflare injects Cf-Access-Jwt-Assertion on Access-
// protected routes and strips any client-supplied copy. Its ABSENCE means this
// route isn't actually behind Access → we refuse (fail-safe), so a
// misconfiguration can't silently leave writes open.
interface Env {
  GB: KVNamespace;
}
type Entry = { id: string; name: string; url: string; note: string; category: string };
const KEY = "catalog:v1";
const MAX = 2000;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!request.headers.get("Cf-Access-Jwt-Assertion")) {
    return json({ error: "unauthorized — this route must be behind Cloudflare Access (it is, once /admin is protected)" }, 401);
  }
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
  return json({ ok: true, count: clean.length });
};
