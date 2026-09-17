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
// a page in the middle of dying cannot be asked for a credential.
//
// Stored in R2, not KV. KV was the wrong home: its write quota is 1000 a day on this plan and it
// is shared with the guestbook, so a burst of diagnostics spent the day's budget for the whole
// site and then rejected the very reports it existed to collect — reads included, since an
// over-quota namespace throws on both. R2 counts writes in millions and is already bound here for
// the game binaries. A freeze is at most a few hundred KB of JSON; there is no reason for it to
// compete with anything.
interface Env {
  R2: R2Bucket;
  GB: KVNamespace;      // still here for the guestbook; this endpoint no longer writes to it
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
  const t = Date.now();
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

  // Checkpoints are recorded locally and never uploaded; refuse an older page's before it costs
  // anything.
  if (field(body?.kind, 40) === "checkpoint") return json({ ok: true, ignored: "checkpoint" });

  const record = {
    t,
    kind: field(body?.kind, 40) || "hang",
    session: field(body?.session, 40),
    build: field(body?.build, 60),
    engine: field(body?.engine, 40),
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

  // Newest first when listed, same inverted-timestamp trick as before.
  const invTs = String(1e13 - t).padStart(13, "0");
  const key = `hang/${invTs}-${Math.random().toString(36).slice(2, 8)}.json`;
  try {
    await env.R2.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (error) {
    // Never throw at a page that is in the middle of dying. It keeps its local copy and re-sends.
    return json({ ok: false, stored: false, why: String((error as Error)?.message ?? error).slice(0, 160) }, 503);
  }
  return json({ ok: true });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (!env.HANG_KEY || url.searchParams.get("key") !== env.HANG_KEY) return json({ error: "not found" }, 404);

  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, PAGE);
  try {
    const listed = await env.R2.list({ prefix: "hang/", limit });
    const reports = await Promise.all(listed.objects.map(async (o) => {
      const got = await env.R2.get(o.key);
      return got ? JSON.parse(await got.text()) : null;
    }));
    return json({ reports: reports.filter(Boolean) });
  } catch (error) {
    return json({ error: String((error as Error)?.message ?? error).slice(0, 160) }, 503);
  }
};
