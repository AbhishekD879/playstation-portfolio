Gorescript Classic — https://github.com/gorescript/gorescript (MIT). Prebuilt player mirrored from https://gorescript.github.io/classic/play/ (2026-09-05), unmodified.
A retro FPS with an 18-level campaign, built on three.js. Engine and assets are both MIT.
assets.zip is served from R2 by functions/gorescript/[[file]].ts.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/gorescript/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/gorescript/ mirror; upload with `node scripts/r2-sync.mjs gorescript`.
