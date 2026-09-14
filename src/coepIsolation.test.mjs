// The emulator frames that ask for COEP: require-corp.
//
// Safari has never supported credentialless, so on iPhone and iPad nothing on
// this site is cross-origin isolated and no emulator gets threads. A frame can
// ask for require-corp instead — but require-corp BLOCKS every cross-origin
// no-cors subresource, and a blocked subresource fails silently. Add a CDN
// script to one of these directories a year from now and the emulator breaks
// with nothing in the console to say why.
//
// So this checks the thing a human cannot hold in their head: that every
// directory claiming the strict policy really does load nothing cross-origin,
// and that the two places the list is written have not drifted apart.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const headers = readFileSync("public/_headers", "utf8");
const r2serve = readFileSync("functions/r2serve.ts", "utf8");

// —— who claims the strict policy ——————————————————————————————————————————
// _headers covers directories served as static assets; a Pages Function's
// response never passes through _headers, so those set it in code instead.
const fromHeaders = new Set();
{
  let current = null;
  for (const line of headers.split("\n")) {
    const path = line.match(/^\/([A-Za-z0-9._-]+)\//);
    if (path) { current = path[1]; continue; }
    if (current && /Cross-Origin-Embedder-Policy:\s*require-corp/i.test(line)) fromHeaders.add(current);
  }
}

const fromFunctions = new Set(
  (r2serve.match(/const ISOLATED = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "")
    .split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
);

assert.ok(fromHeaders.size, "_headers should isolate at least one emulator frame");
assert.ok(fromFunctions.size, "r2serve should isolate at least one emulator frame");

// —— the two lists must not overlap ————————————————————————————————————————
// A directory is served one way or the other, never both. An entry in the
// wrong list is silently ignored, which looks exactly like it working.
for (const d of fromFunctions) {
  assert.ok(!fromHeaders.has(d),
    `${d} is served by a Pages Function, so its _headers rule never applies — keep it only in r2serve.ts`);
}

// every directory a Function serves is one with a route file
for (const d of fromFunctions) {
  assert.ok(existsSync(join("functions", d)),
    `r2serve isolates ${d}, but functions/${d}/ does not exist — it is not Function-served`);
}
// and nothing in _headers is Function-served
for (const d of fromHeaders) {
  assert.ok(!existsSync(join("functions", d)),
    `_headers isolates ${d}, but functions/${d}/ exists — that response bypasses _headers`);
}

// —— the actual requirement: no cross-origin subresource ————————————————————
// src=, the CSS url() form, and <link href> — a stylesheet or preload IS a
// subresource and require-corp blocks it exactly like a script. Only a plain
// <a href> is a navigation, which COEP does not police, so that stays exempt.
//
// The <link> case was missed at first, and Warzone 2100 walked straight into
// it: its page pulls Bootstrap's CSS from cdnjs by href, which this checked
// nothing about while happily catching the matching <script src>.
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|js|mjs|css)$/i.test(name)) out.push(p);
  }
  return out;
};

const CROSS_ORIGIN = /(?:src\s*=\s*["']|url\(\s*["']?|importScripts\(\s*["'])(https?:)?\/\/([A-Za-z0-9.-]+)/gi;
// a <link> of any rel — stylesheet, preload, prefetch, icon — fetches a file
const CROSS_ORIGIN_LINK = /<link\b[^>]*?href\s*=\s*["'](https?:)?\/\/([A-Za-z0-9.-]+)/gi;

for (const dir of [...fromHeaders, ...fromFunctions]) {
  const root = join("public", dir);
  if (!existsSync(root)) continue;   // R2-only directory, nothing local to scan
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const re of [CROSS_ORIGIN, CROSS_ORIGIN_LINK]) {
      for (const m of text.matchAll(re)) {
        const host = m[2];
        assert.fail(
          `${file} loads a cross-origin subresource from ${host}. ` +
          `${dir} claims COEP: require-corp, which blocks that silently — ` +
          `either self-host it, confirm it sends Cross-Origin-Resource-Policy, or drop ${dir} from the isolated list.`,
        );
      }
    }
  }
}

// —— the main document must NOT be strict ——————————————————————————————————
// It embeds YouTube, Spotify, map tiles and remote thumbnails, none of which
// survive require-corp. This is the line that stops someone "tidying up" by
// making the policy uniform.
const root = headers.split("\n").slice(0, headers.split("\n").findIndex((l) => l.startsWith("/j2me")) || 6);
assert.ok(root.some((l) => /Cross-Origin-Embedder-Policy:\s*credentialless/i.test(l)),
  "the root policy must stay credentialless — require-corp there blocks YouTube, Spotify and remote images");

console.log(
  "coep isolation ok ·",
  fromHeaders.size, "static +", fromFunctions.size, "function-served frame(s) isolated,",
  "all free of cross-origin subresources",
);
