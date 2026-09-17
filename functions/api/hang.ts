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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  // Every KV touch can throw when the namespace is over its daily quota — reads included, not
  // just writes. An uncaught one becomes a Cloudflare 1101 error page in front of whoever is
  // playing, which is a worse outcome than losing a diagnostic. Fail soft, always: the page keeps
  // its local copy and re-sends another day.
  try {
    return await handlePost(context);
  } catch (error) {
    return json({ ok: false, stored: false, why: String((error as Error)?.message ?? error).slice(0, 160) }, 503);
  }
};

const handlePost: PagesFunction<Env> = async ({ request, env }) => {
  const t0 = Date.now();
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

  // Checkpoints are local-only now; if an older page still sends one, drop it before it costs
  // anything. Reads are free-ish, writes are the metered thing.
  if (field(body?.kind, 40) === "checkpoint") return json({ ok: true, ignored: "checkpoint" });

  // One read to rate-limit, and at most two writes per stored report. It used to be three writes
  // for every upload — a per-IP counter, an hourly counter, and the record — on a namespace that
  // is shared with the guestbook and metered daily. Uploading a checkpoint every five seconds on
  // top of that spent the quota, and a rejected write surfaced on the page as a raw 1101.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rlKey = `hrl:${ip}`;
  const seen = Number((await env.GB.get(rlKey)) ?? 0);
  if (seen >= 12) return json({ error: "rate limited" }, 429);

  const t = t0;
  // Kept whole rather than flattened. The point of the report is that one freeze answers the
  // question, and the answer is usually in the parts that a summary would drop: the engine's last
  // few hundred lines, the heap series that says climb-versus-cliff, the frame times before it
  // seized, the fault that was already recorded minutes earlier.
  const record = {
    t,
    kind: field(body?.kind, 40) || "hang",
    session: field(body?.session, 40),
    build: field(body?.build, 60),
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
    bufSrcPeak: Number(body?.bufSrcPeak) || 0,
    totalMem: body?.totalMem ?? {},
    lastEngineLine: field(body?.lastEngineLine, 600),
    engineLog: Array.isArray(body?.engineLog)
      ? body.engineLog.slice(-LOG_LINES).map((l: unknown) => field(l, 600))
      : [],
    tail: field(body?.tail, MAX_FIELD),
    ua: field(request.headers.get("user-agent"), 200),
  };

  // Checkpoints overwrite one key per session; everything else gets its own.
  //
  // At one every five seconds a long session wrote hundreds of rows and pushed every other
  // report out of a 100-row listing — the heartbeat drowned the thing it was there to preserve.
  // Only the newest checkpoint of a session is worth keeping, and a fixed key gives exactly that
  // while a freeze, a fault or a start still lands as its own row.
  const invTs = String(1e13 - t).padStart(13, "0");
  const key = `hang:${invTs}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    await env.GB.put(rlKey, String(seen + 1), { expirationTtl: 60 });
    await env.GB.put(key, JSON.stringify(record), {
      expirationTtl: KEEP_DAYS * 86400,
      metadata: { t, frozenForMs: record.frozenForMs, playedMs: record.playedMs, heapMB: record.heapMB, engine: record.engine },
    });
  } catch (error) {
    // Out of quota, most likely. Say so plainly and let the page keep its local copy to re-send
    // another day, instead of throwing and showing the visitor a Cloudflare error page.
    return json({ ok: false, stored: false, why: String((error as Error).message).slice(0, 120) }, 503);
  }
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
