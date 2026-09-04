OpenTTD (GPL-2.0) — https://www.openttd.org · web build (15.3) mirrored from https://github.com/swords02/openttd-online (play/, 2026-09-04).
openttd.js: the openttd-online language pre-loader IIFE was removed (it fetched 65 external .lng files); english.lng is packaged in openttd.data. Otherwise unmodified.
baseset/opengfx-7.1.tar — OpenGFX 7.1 (GPL-2.0), https://cdn.openttd.org/opengfx-releases/7.1/ — written into /baseset before start so no first-run download is needed.
index.html is ours (full-screen canvas, IDBFS saves via the build's own pre.js).

Big binaries (wasm/data/mpq/zip/bin/tar) are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/openttd/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/openttd/ mirror; upload with `node scripts/r2-sync.mjs openttd`.
