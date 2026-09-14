OpenTyrian — https://github.com/opentyrian/opentyrian (GPL-2.0). Web build mirrored from https://midzer.de/wasm/opentyrian/ (2026-09-14).
A vertical scrolling shooter: Tyrian (1995, Eclipse Software). The engine is GPL; the game data was released as freeware by the copyright holder in 2004, which is why the whole game ships here rather than a shareware slice.

index.html is ours, not upstream's: same bootstrap, minus the "click here to load" gate, because the console has already asked the player to pick this game.
index.js is upstream's Emscripten loader, unmodified.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/opentyrian/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/opentyrian/ mirror; upload with `node scripts/r2-sync.mjs opentyrian`.
