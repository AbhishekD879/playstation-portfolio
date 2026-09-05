HexGL — https://github.com/BKcore/HexGL (MIT), by Thibaut Despoulain. Mirrored 2026-09-05, unmodified apart from omitting package.zip (a packaging artifact).
A futuristic anti-gravity racer built on three.js; engine, textures, geometry and audio are all MIT.
The media directories (textures, textures.full, geometries, audio, replays) are served from R2 by functions/hexgl/[[file]].ts; code and CSS are in the repo.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/hexgl/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/hexgl/ mirror; upload with `node scripts/r2-sync.mjs hexgl`.
