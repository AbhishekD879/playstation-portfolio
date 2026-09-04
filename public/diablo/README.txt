DevilutionX (Sustainable Use License 1.0, non-commercial) — https://github.com/diasurgical/devilutionX
Built here from upstream master 1bb39d6 (2026-08-24) with emsdk 4.0.1: `emcmake cmake -S. -Bbuild-em -DCMAKE_BUILD_TYPE=Release && cmake --build build-em`.
devilutionx.js/.wasm/.data (assets + mods preloaded), index.html and file-manager.js are the build's own outputs (Packaging/emscripten shell); the pre.js loads spawn.mpq from this directory and keeps saves in IndexedDB.
spawn.mpq — the Diablo shareware data, as distributed by the DevilutionX project (devilutionx-assets v5). Owners of the full game can add DIABDAT.MPQ through the page's file manager; it is never hosted here.

Big binaries (wasm/data/mpq/zip/bin/tar) are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/diablo/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/diablo/ mirror; upload with `node scripts/r2-sync.mjs diablo`.
