// Crash reports from the Vice City page, so a freeze is something that can be read
// rather than remembered.
//
// The page's black-box worker POSTs here the moment the main thread stops answering. That it is
// the *worker* doing the POST is the whole trick: the worker has its own thread, so it is still
// alive and can report while the tab it is reporting on is wedged and about to be killed.
//
// What arrives is diagnostics only — how long play lasted, heap in use, the lines the engine
// printed. No game data and no file contents: those never leave the device, and nothing here
// would carry them. The page only enables the upload under ?debug=1, so ordinary play still sends
// nothing at all.
//
// Reading is keyed, because these are logs and logs are not for everyone. Writing is not, because
// a page in the middle of dying cannot be asked for a credential — spam is held off with the same
// per-IP rate limit the guestbook uses, and a short TTL keeps the namespace from filling up.
interface Env {
  GB: KVNamespace;
  HANG_KEY?: string;
}

const MAX_FIELD = 2000;
const KEEP_DAYS = 14;
const PAGE = 100;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Whatever the page sends, bounded and stringified before it is stored. */
const field = (value: unknown, limit = MAX_FIELD) =>
  typeof value === "number" ? value : String(value ?? "").slice(0, limit);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  // A wedged tab can report more than once as it dies; ten a minute is generous for that and
  // still useless to anyone pointing a script at this.
  const rlKey = `hrl:${ip}`;
  const seen = Number((await env.GB.get(rlKey)) ?? 0);
  if (seen >= 10) return json({ error: "rate limited" }, 429);
  await env.GB.put(rlKey, String(seen + 1), { expirationTtl: 60 });

  const t = Date.now();
  const record = {
    t,
    kind: field(body?.kind, 40) || "hang",
    frozenForMs: Number(body?.frozenForMs) || 0,
    playedMs: Number(body?.playedMs) || 0,
    heapMB: Number(body?.heapMB) || 0,
    engine: field(body?.engine, 40),          // "release" or "debug"
    lastEngineLine: field(body?.lastEngineLine, 600),
    tail: field(body?.tail, MAX_FIELD),
    ua: field(request.headers.get("user-agent"), 200),
  };

  // Newest first, same inverted-timestamp trick as the guestbook. The body carries the trail
  // because it can run past what KV allows in metadata.
  const invTs = String(1e13 - t).padStart(13, "0");
  await env.GB.put(`hang:${invTs}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(record), {
    expirationTtl: KEEP_DAYS * 86400,
    metadata: { t, frozenForMs: record.frozenForMs, playedMs: record.playedMs, heapMB: record.heapMB, engine: record.engine },
  });
  return json({ ok: true });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const key = new URL(request.url).searchParams.get("key");
  if (!env.HANG_KEY || key !== env.HANG_KEY) return json({ error: "not found" }, 404);

  const list = await env.GB.list({ prefix: "hang:", limit: PAGE });
  const reports = await Promise.all(
    list.keys.map(async (k) => JSON.parse((await env.GB.get(k.name)) ?? "null")),
  );
  return json({ reports: reports.filter(Boolean) });
};
