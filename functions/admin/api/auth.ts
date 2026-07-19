// Admin login check — the /admin CMS posts the entered password as x-admin-key;
// we confirm it against the server-side ADMIN_KEY so the UI can unlock. The
// password itself is never sent to the client. Nothing here touches the public
// site. Set ADMIN_KEY in Pages → Settings → Variables (encrypt it).
interface Env {
  ADMIN_KEY?: string;
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
  const ok = safeEqual(request.headers.get("x-admin-key") ?? "", env.ADMIN_KEY);
  return json({ ok }, ok ? 200 : 401);
};
