// Free & Open catalog — ADMIN write. Authorized by a single admin password held
// server-side as the ADMIN_KEY variable (Pages → Settings → Variables; encrypt
// it). The /admin CMS sends it as the x-admin-key header. This gates ONLY
// publishing to the catalog — it has nothing to do with the public site, which
// stays fully open. If ADMIN_KEY is unset, writes are refused (fail-safe).
interface Env {
  GB: KVNamespace;
  ADMIN_KEY?: string;
}
type Entry = { id: string; name: string; url: string; note: string; category: string };
const KEY = "catalog:v1";
const MAX = 2000;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// constant-time-ish string compare (avoid leaking length/prefix via timing)
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_KEY) return json({ error: "admin locked — set the ADMIN_KEY variable in Pages → Settings → Variables" }, 503);
  if (!safeEqual(request.headers.get("x-admin-key") ?? "", env.ADMIN_KEY)) return json({ error: "wrong admin password" }, 401);

  let body: { entries?: unknown };
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const arr = Array.isArray(body?.entries) ? body.entries : null;
  if (!arr) return json({ error: "entries[] required" }, 400);
  if (arr.length > MAX) return json({ error: `too many entries (max ${MAX})` }, 400);

  const clean: Entry[] = [];
  const seen = new Set<string>();
  for (const raw of arr as Record<string, unknown>[]) {
    const url = String(raw?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const k = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
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
