
Big binaries (wasm/data/mpq/zip/bin/tar) are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/quake/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/quake/ mirror; upload with `node scripts/r2-sync.mjs quake`.
