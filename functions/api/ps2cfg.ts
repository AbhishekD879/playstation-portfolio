// Per-game PS2 emulator overrides, stored in KV so a fix ships without a build.
//
// The console carries a small shipped table (src/ps2knobs.ts) for the overrides
// we have verified, and reads this on top. That split matters: the shipped table
// means the first boot is right even offline, and KV means the next game we work
// out is a one-line edit rather than a deploy.
//
// GET is public and cached — it is a handful of settings keyed by title id, with
// nothing personal in it. POST is admin-only and validated, because a bad clock
// value here is a black screen with nothing in the log on every visitor's
// machine. The client validates again on receipt; this is defence in depth, not
// a substitute for it.
interface Env {
  GB: KVNamespace;
  ADMIN_KEY?: string;
}

const KEY = "ps2cfg:v1";
const PREV = "ps2cfg:v1:prev";
const MAX_BYTES = 64 * 1024;

const json = (data: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
  });

// Same shape the client enforces. Duplicated deliberately: the browser copy
// protects a visitor from a bad write, and this one stops the bad write landing.
const ID = /^[A-Z]{4}-\d{5}$/;
const HEX = /^[0-9a-fA-F]{1,8}$/;
const BLOCK_KEY = /^[0-9a-fA-F]{32};\d+$/;
const MODES = ["NEAREST", "PLUSINFINITY", "MINUSINFINITY", "TRUNCATE"];

function clean(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== "object") return null;
  const v = val as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof v.why === "string") out.why = v.why.slice(0, 300);
  if (v.engine === "advanced" || v.engine === "native") out.engine = v.engine;
  if (v.clock === "full" || v.clock === "half" || v.clock === "third") out.clock = v.clock;
  if (v.res === 1 || v.res === 2 || v.res === 3) out.res = v.res;
  if (typeof v.players === "number" && v.players >= 1 && v.players <= 6) out.players = Math.floor(v.players);

  const k = v.knobs as Record<string, unknown> | undefined;
  if (k && typeof k === "object") {
    const knobs: Record<string, unknown> = {};
    const hexes = (x: unknown) => (Array.isArray(x) ? x.filter((s) => typeof s === "string" && HEX.test(s)) : []);
    const addrRows = (x: unknown, extra?: (r: any) => boolean) =>
      Array.isArray(x)
        ? x.filter((r: any) => r && typeof r === "object" && HEX.test(String(r.address)) && (!extra || extra(r)))
        : [];

    const idle = addrRows(k.idleLoop).map((r: any) =>
      typeof r.checkBlockKey === "string" && BLOCK_KEY.test(r.checkBlockKey)
        ? { address: String(r.address), checkBlockKey: r.checkBlockKey }
        : { address: String(r.address) });
    if (idle.length) knobs.idleLoop = idle;

    const fp = addrRows(k.fpRounding, (r) => MODES.includes(r.mode))
      .map((r: any) => ({ address: String(r.address), mode: r.mode }));
    if (fp.length) knobs.fpRounding = fp;

    const acc = hexes(k.fpAccurateAddSub);
    if (acc.length) knobs.fpAccurateAddSub = acc;

    const vu = Array.isArray(k.vu1NoClamping)
      ? k.vu1NoClamping.filter((s: unknown) => typeof s === "string" && BLOCK_KEY.test(s as string))
      : [];
    if (vu.length) knobs.vu1NoClamping = vu;

    const patch = addrRows(k.patch, (r) => HEX.test(String(r.value)))
      .map((r: any) => ({ address: String(r.address), value: String(r.value) }));
    if (patch.length) knobs.patch = patch;

    if (Object.keys(knobs).length) out.knobs = knobs;
  }
  return Object.keys(out).length ? out : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = (await env.GB.get(KEY)) ?? "{}";
  // Five minutes: long enough that a boot costs nothing, short enough that a
  // fix reaches players the same afternoon.
  return new Response(raw, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
};

// Constant-time compare, matching the pattern the admin endpoints already use:
// a length-dependent early return leaks the key one character at a time.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_KEY) return json({ error: "not configured" }, 503);

  const key = request.headers.get("x-admin-key") ?? "";
  // Rate limit the endpoint that actually writes, not just a separate auth
  // route — otherwise the limiter guards a door nobody has to walk through.
  const ip = request.headers.get("cf-connecting-ip") ?? "?";
  const bucket = `ps2cfg:rl:${ip}:${Math.floor(Date.now() / 600_000)}`;
  const tries = parseInt((await env.GB.get(bucket)) ?? "0", 10);
  if (tries > 10) return json({ error: "too many attempts" }, 429);
  await env.GB.put(bucket, String(tries + 1), { expirationTtl: 1200 });

  if (!safeEqual(key, env.ADMIN_KEY)) return json({ error: "forbidden" }, 403);

  const body = await request.text();
  if (body.length > MAX_BYTES) return json({ error: "too large" }, 413);

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return json({ error: "not JSON" }, 400); }
  if (!parsed || typeof parsed !== "object") return json({ error: "expected an object of title id → override" }, 400);

  const out: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ID.test(id)) { rejected.push(id); continue; }
    const ok = clean(val);
    if (ok) out[id] = ok; else rejected.push(id);
  }

  // Keep the previous table. This is hand-curated data with no other copy, and
  // the backup costs one extra write.
  const before = await env.GB.get(KEY);
  if (before) await env.GB.put(PREV, before);
  await env.GB.put(KEY, JSON.stringify(out));

  return json({ ok: true, stored: Object.keys(out).length, rejected });
};
