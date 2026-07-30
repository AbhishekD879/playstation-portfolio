// Generates public/robots.txt and public/sitemap.xml.
//
// Why generated rather than hand-written: `lastmod` is a promise to crawlers
// about when the page changed, and a hand-set date is a lie the moment you
// deploy again. This reads the last commit date, so it is true by construction.
//
// Both files must be REAL files in public/. Cloudflare Pages serves the SPA's
// index.html for any unknown path, so before this existed /robots.txt and
// /sitemap.xml both returned 200 with HTML — which means a sitemap submitted to
// Search Console fails outright, and robots.txt is silently garbage.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** One place to change if a custom domain ever replaces the pages.dev host.
 *  Must match the <link rel="canonical"> and og:url in index.html. */
export const ORIGIN = "https://abhishekstation.pages.dev";

const pub = join(import.meta.dirname, "..", "public");

const lastCommitDate = () => {
  try {
    return execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim().slice(0, 10);
  } catch {
    // No git (a clean tarball build) — today is the honest fallback.
    return new Date().toISOString().slice(0, 10);
  }
};

// ——— routes ————————————————————————————————————————————————————————
// The console is a hash-routed SPA: #/app/<id> and #/<category> are all the SAME
// document to a crawler, so listing them would be listing one URL six times.
// There is exactly one indexable URL until real pages are prerendered — at which
// point they go here and the rest of this file needs no changes.
const ROUTES = [{ path: "/", priority: "1.0", changefreq: "weekly" }];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map((r) => `  <url>
    <loc>${ORIGIN}${r.path}</loc>
    <lastmod>${lastCommitDate()}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;

// ——— robots ————————————————————————————————————————————————————————
// Nothing here is secret; the Disallow list is about CRAWL BUDGET and junk
// results, not privacy. Three of these directories host their own index.html for
// an emulator iframe — left open, Google will happily index "/play-mt/" as a
// blank page with your name nowhere on it. The rest are tens of megabytes of
// wasm, models and chess tablebases that no search engine has any use for.
const robots = `# ${ORIGIN}
User-agent: *
Allow: /

# Emulator iframe hosts — real pages, but not pages a person should ever land on
Disallow: /play/
Disallow: /play-mt/
Disallow: /pc/

# Large binary payloads: wasm cores, 3D models, voices, chess tablebases
Disallow: /cesium/
Disallow: /models/
Disallow: /stockfish/
Disallow: /rpgm/
Disallow: /ludo/
Disallow: /rtx/

Sitemap: ${ORIGIN}/sitemap.xml
`;

writeFileSync(join(pub, "sitemap.xml"), sitemap);
writeFileSync(join(pub, "robots.txt"), robots);
console.log(`seo: robots.txt + sitemap.xml (${ROUTES.length} url, lastmod ${lastCommitDate()})`);
