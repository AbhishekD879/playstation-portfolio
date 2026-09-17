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
const LOG_LINES = 600;
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
  // Sized for a session that checkpoints every 30s, plus a burst of recovered records on a
  // reload, plus the dying tab itself — still far too low to be worth pointing a script at.
  if (seen >= 120) return json({ error: "rate limited" }, 429);  // 5s checkpoints = 12/min, plus recovery bursts
  await env.GB.put(rlKey, String(seen + 1), { expirationTtl: 60 });

  const t = Date.now();
  // Kept whole rather than flattened. The point of the report is that one freeze answers the
  // question, and the answer is usually in the parts that a summary would drop: the engine's last
  // few hundred lines, the heap series that says climb-versus-cliff, the frame times before it
  // seized, the fault that was already recorded minutes earlier.
  const record = {
    t,
    kind: field(body?.kind, 40) || "hang",
    session: field(body?.session, 40),
    engine: field(body?.engine, 40),          // "release" or "debug"
    frozenForMs: Number(body?.frozenForMs) || 0,
    playedMs: Number(body?.playedMs) || 0,
    heapMB: Number(body?.heapMB) || 0,
    mem: body?.mem ?? {},
    heapSeries: Array.isArray(body?.heapSeries) ? body.heapSeries.slice(-200) : [],
    frames: body?.frames ?? {},
    longTasks: Array.isArray(body?.longTasks) ? body.longTasks.slice(-30) : [],
    faults: Array.isArray(body?.faults) ? body.faults.slice(-15) : [],
    gl: body?.gl ?? {},
    engineState: Array.isArray(body?.engineState) ? body.engineState.slice(-60) : [],
    probes: Array.isArray(body?.probes) ? body.probes.slice(-60) : [],
    totalMem: body?.totalMem ?? {},
    lastEngineLine: field(body?.lastEngineLine, 600),
    engineLog: Array.isArray(body?.engineLog)
      ? body.engineLog.slice(-LOG_LINES).map((l: unknown) => field(l, 600))
      : [],
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
