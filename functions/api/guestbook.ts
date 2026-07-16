// Guestbook — Cloudflare Pages Function backed by KV. Entries live entirely in
// key METADATA so one list() call serves the whole page (no N+1 gets).
// Keys sort newest-first via an inverted-timestamp prefix.
interface Env {
  GB: KVNamespace;
}

const MAX_NAME = 24;
const MAX_MSG = 240;
const PAGE = 40;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const list = await env.GB.list({ prefix: "gb:", limit: PAGE });
  const entries = list.keys
    .map((k) => k.metadata as { n: string; m: string; t: number } | null)
    .filter(Boolean);
  return json({ entries });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const name = String(body?.name ?? "").trim().slice(0, MAX_NAME);
  const msg = String(body?.msg ?? "").trim().slice(0, MAX_MSG);
  if (!name || msg.length < 2) return json({ error: "name and a real message required" }, 400);

  // one post per IP per minute — enough to stop drive-by spam
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rlKey = `rl:${ip}`;
  if (await env.GB.get(rlKey)) return json({ error: "easy there — one note per minute" }, 429);
  await env.GB.put(rlKey, "1", { expirationTtl: 60 });

  const t = Date.now();
  const invTs = String(1e13 - t).padStart(13, "0"); // newest sorts first
  await env.GB.put(`gb:${invTs}:${Math.random().toString(36).slice(2, 8)}`, "", {
    metadata: { n: name, m: msg, t },
  });
  return json({ ok: true, entry: { n: name, m: msg, t } });
};
