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
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", json: "application/json", css: "text/css; charset=utf-8",
  hog: "application/octet-stream", pig: "application/octet-stream", pk3: "application/zip",
};
const typeOf = (key: string) => TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// Which of these directories can ask for the stricter policy.
//
// Safari has never supported COEP: credentialless — it only accepts
// require-corp — so on iPhone and iPad nothing here is cross-origin isolated
// and no emulator gets threads. A frame may ask for require-corp instead, but
// only if it loads NO cross-origin no-cors subresource, because require-corp
// blocks every one of those. (CORS-mode fetch is untouched by COEP either way.)
//
// Audited per directory. jazz2 is absent on purpose: it loads googletagmanager,
// which would be blocked. Keep this in step with the same list in
// public/_headers, which covers the directories no Function serves.
const ISOLATED = new Set(["quake", "duke", "diablo", "openttd", "descent", "gorescript", "hexgl", "openhv", "opentyrian", "cdda", "endlesssky"]);

const isolate = (h: Headers, dir: string) => {
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("cross-origin-embedder-policy", ISOLATED.has(dir) ? "require-corp" : "credentialless");
  h.set("cross-origin-resource-policy", "same-origin");
  return h;
};

export async function serveFromR2(ctx: EventContext<R2Env, string, unknown>, dir: string): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.slice(1)); // "quake/qwasm-gl.wasm"
  const isGet = request.method === "GET" || request.method === "HEAD";
  if (!isGet || !key.startsWith(`${dir}/`) || key.includes("..")) return fallback(ctx, dir);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  let res = await cache.match(cacheKey);
  if (!res) {
    const obj = await env.R2.get(key);
    if (!obj) return (await serveParts(ctx, key, dir)) ?? fallback(ctx, dir);
    const h = new Headers();
    obj.writeHttpMetadata(h);
    if (!h.get("content-type") || h.get("content-type") === "application/octet-stream") h.set("content-type", typeOf(key));
    h.set("content-length", String(obj.size));
    h.set("etag", obj.httpEtag);
    h.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    h.set("x-asset-source", "r2");
    isolate(h, dir);
    res = new Response(obj.body, { status: 200, headers: h });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return request.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

// An object that was stored in parts, asked for as a whole.
//
// Wrangler refuses to upload anything over 300 MiB and has no multipart mode,
// so scripts/r2-sync.mjs slices a bigger file into <key>.part0, <key>.part1, …
// of 200 MiB each. The client is what reassembles them — see the split-resource
// block in public/endlesssky/cached-resource-*.js.
//
// This deliberately does NOT stitch them here. That was tried, twice, and a
// Worker cannot stream a 400 MiB response to the end: it is cut off part-way
// while still reporting 200 and the full Content-Length, so the truncation is
// invisible to the browser, to curl and to the game's loader. Measured at
// 209,833,984 and then 160,234,240 bytes of an expected 401,639,029; only a
// checksum against the original found it.
//
// What is left is the useful half: say so, loudly. Without this the request
// falls through to the single-page app and answers 200 with the console's own
// index.html, which is the failure that hid the bug in the first place.
async function serveParts(ctx: EventContext<R2Env, string, unknown>, key: string, dir: string): Promise<Response | null> {
  const first = await ctx.env.R2.head(`${key}.part0`);
  if (!first) return null;
  const h = isolate(new Headers({ "content-type": "text/plain; charset=utf-8" }), dir);
  h.set("x-asset-source", "r2-split");
  return new Response(
    `${key} is stored in parts (${key}.part0, .part1, …) because it is larger than ` +
    `the 300 MiB wrangler can upload. Fetch the parts and concatenate them client-side; ` +
    `a Worker cannot stream a body this large to completion. See functions/r2serve.ts.\n`,
    { status: 404, headers: h },
  );
}

// the static file, with the isolation headers _headers would have added
async function fallback(ctx: EventContext<R2Env, string, unknown>, dir: string): Promise<Response> {
  const res = await ctx.env.ASSETS.fetch(ctx.request);
  const h = isolate(new Headers(res.headers), dir);
  h.set("x-asset-source", "static");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
