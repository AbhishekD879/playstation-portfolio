// Admin login check — the /admin CMS posts the entered password as x-admin-key;
// we confirm it against the server-side ADMIN_KEY so the UI can unlock. The
// password itself is never sent to the client. Nothing here touches the public
// site. Set ADMIN_KEY in Pages → Settings → Variables (encrypt it).
interface Env {
  ADMIN_KEY?: string;
  GB: KVNamespace;   // reused for the attempt counter
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_KEY) return json({ ok: false, error: "ADMIN_KEY not set in Pages → Settings → Variables" }, 503);

  // A constant-time compare stops timing attacks but not guessing: without a
  // ceiling this endpoint accepts unlimited attempts, so the key's strength is
  // the only thing standing between an attacker and the CMS. Ten tries per IP
  // per ten minutes, and a wrong answer always costs a slot.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `adminrl:${ip}`;
  const tries = Number((await env.GB?.get(key)) ?? 0);
  if (tries >= 10) return json({ ok: false, error: "too many attempts — try again later" }, 429);

  const ok = safeEqual(request.headers.get("x-admin-key") ?? "", env.ADMIN_KEY);
  if (!ok) await env.GB?.put(key, String(tries + 1), { expirationTtl: 600 });
  return json({ ok }, ok ? 200 : 401);
};
