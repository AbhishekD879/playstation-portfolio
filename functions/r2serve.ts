// Big game binaries live in R2 and are served from the SAME origin at their
// original paths: functions/<dir>/[[file]].ts hands every request under that
// directory here. R2 hit → stream it (edge-cached); miss → the static asset
// (index.html, small .js, README) as if the Function did not exist. Same
// origin means no CORS and no cross-origin-isolation trouble for the
// Emscripten loaders; the isolation headers match public/_headers.
//
// Not a route itself: no onRequest export. Keep the dir list in sync with the
// route files and with scripts/r2-sync.mjs.
export interface R2Env {
  R2: R2Bucket;
  ASSETS: Fetcher;
}

const TYPES: Record<string, string> = {
  wasm: "application/wasm", js: "text/javascript; charset=utf-8", html: "text/html; charset=utf-8",
  data: "application/octet-stream", mpq: "application/octet-stream", zip: "application/zip",
  bin: "application/octet-stream", tar: "application/x-tar", txt: "text/plain; charset=utf-8",
};
const typeOf = (key: string) => TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const isolate = (h: Headers) => {
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("cross-origin-embedder-policy", "credentialless");
  h.set("cross-origin-resource-policy", "same-origin");
  return h;
};

export async function serveFromR2(ctx: EventContext<R2Env, string, unknown>, dir: string): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.slice(1)); // "quake/qwasm-gl.wasm"
  const isGet = request.method === "GET" || request.method === "HEAD";
  if (!isGet || !key.startsWith(`${dir}/`) || key.includes("..")) return fallback(ctx);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  let res = await cache.match(cacheKey);
  if (!res) {
    const obj = await env.R2.get(key);
    if (!obj) return fallback(ctx);
    const h = new Headers();
    obj.writeHttpMetadata(h);
    if (!h.get("content-type") || h.get("content-type") === "application/octet-stream") h.set("content-type", typeOf(key));
    h.set("content-length", String(obj.size));
    h.set("etag", obj.httpEtag);
    h.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    h.set("x-asset-source", "r2");
    isolate(h);
    res = new Response(obj.body, { status: 200, headers: h });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

// the static file, with the isolation headers _headers would have added
async function fallback(ctx: EventContext<R2Env, string, unknown>): Promise<Response> {
  const res = await ctx.env.ASSETS.fetch(ctx.request);
  const h = isolate(new Headers(res.headers));
  h.set("x-asset-source", "static");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
