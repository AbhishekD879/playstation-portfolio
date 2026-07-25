// Watch Party — "Shared Browser" session minting. Creates a Hyperbeam virtual
// browser (a real Chromium on their cloud) and returns its embed_url; the whole
// room loads that one browser and co-controls it, so ANY site works and stays
// in sync (Hyperbeam does the streaming). The API key is a paid resource, so it
// lives ONLY here as HYPERBEAM_API_KEY (Pages → Settings → Variables) — never on
// the client — and this endpoint is fail-safe (503 until set) + same-origin only.
interface Env { HYPERBEAM_API_KEY?: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// only our own site may spend the key (Origin is sent on POST; block drive-by curl)
const originOk = (o: string | null) => !o || o === "http://localhost:5300" || o === "http://localhost:5311" || /^https:\/\/([a-z0-9-]+\.)?abhishekstation\.pages\.dev$/.test(o);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.HYPERBEAM_API_KEY) return json({ error: "shared browser not configured — set HYPERBEAM_API_KEY in Pages → Settings → Variables" }, 503);
  if (!originOk(request.headers.get("Origin"))) return json({ error: "forbidden origin" }, 403);

  let body: { startUrl?: string; adblock?: boolean; region?: string; quality?: string; closeOnEmpty?: boolean } = {};
  try { body = await request.json(); } catch { /* no body → defaults */ }

  const start = typeof body?.startUrl === "string" && /^https?:\/\//i.test(body.startUrl) ? body.startUrl : undefined;
  const region = ["NA", "EU", "AS"].includes(String(body?.region)) ? body!.region : "NA";
  // quality preset → Hyperbeam encoder mode + resolution + fps.
  // (sharp ≈ 3× bandwidth HD; smooth for dynamic content; saver for weak links)
  const PRESETS: Record<string, { mode: string; width: number; height: number; fps: number }> = {
    smooth: { mode: "smooth", width: 1280, height: 720, fps: 30 },
    sharp: { mode: "sharp", width: 1920, height: 1080, fps: 30 },
    saver: { mode: "blocky", width: 1280, height: 720, fps: 24 },
  };
  const q = PRESETS[String(body?.quality)] ?? PRESETS.smooth;
  const r = await fetch("https://engine.hyperbeam.com/v0/vm", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.HYPERBEAM_API_KEY}`, "content-type": "application/json" },
    // adblock installs uBlock Origin. Timeout auto-shuts the (paid) VM to bound
    // cost: closeOnEmpty (default) → ends ~1 min after everyone leaves / 5 min
    // idle; keep-alive → survives ~30 min so you can step away and rejoin, then
    // still dies so nothing runs forever.
    body: JSON.stringify({
      ...(start ? { start_url: start } : {}),
      adblock: body?.adblock !== false,
      region,
      quality: { mode: q.mode }, width: q.width, height: q.height, fps: q.fps,
      timeout: body?.closeOnEmpty === false ? { inactive: 1800, offline: 1800 } : { inactive: 300, offline: 60 },
    }),
  });
  if (!r.ok) return json({ error: `hyperbeam ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);
  const data = await r.json() as { embed_url?: string; session_id?: string };
  if (!data?.embed_url) return json({ error: "no embed_url in hyperbeam response" }, 502);
  return json({ embedUrl: data.embed_url, sessionId: data.session_id }); // admin_token intentionally kept server-side
};
