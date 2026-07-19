// Free & Open catalog — PUBLIC read. Returns the owner-published entries; the
// public app merges these onto the built-in curated list.
// Writes live at /admin/api/catalog (protected by Cloudflare Access at the edge).
interface Env {
  GB: KVNamespace;
}
const KEY = "catalog:v1";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const raw = await env.GB.get(KEY);
  return new Response(JSON.stringify({ entries: raw ? JSON.parse(raw) : [] }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
