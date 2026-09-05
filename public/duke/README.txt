Duke Nukem 3D — EDuke32 compiled to WebAssembly: https://github.com/DigitalCyberSoft/eduke32-wasm (EDuke32 is GPL-2.0). Mirrored from the project's GitHub Pages build, 2026-09-05, unmodified.
eduke32.data contains the SHAREWARE DUKE.GRP (v1.3D, Episode 1 "L.A. Meltdown"), which 3D Realms distributes freely; the registered episodes are not included. Upstream's grp-manifest.json is explicit that only the free shareware GRP is bundled.
eduke32.wasm and eduke32.data are served from R2 by functions/duke/[[file]].ts.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/duke/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/duke/ mirror; upload with `node scripts/r2-sync.mjs duke`.
