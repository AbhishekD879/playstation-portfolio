Cataclysm: Dark Days Ahead — https://github.com/CleverRaven/Cataclysm-DDA (CC-BY-SA 3.0; some content under other free licences, see the upstream LICENSE).
Web build from https://github.com/nornagon/play-cdda, mirrored 2026-09-14 at the pinned stable release v/0.I-web-0-i1-e526f4835d (upstream tag 0.I).
A post-apocalyptic survival roguelike. Engine and content are both free — nothing here is anyone's commercial data, so the whole game ships.

index.html is ours, not upstream's. Upstream pulls font-awesome, screenfull and FileSaver from cdnjs; this directory takes COEP: require-corp, which blocks every cross-origin no-cors subresource, so those three are gone (a text glyph, the native Fullscreen API, and a Blob object URL respectively). JSZip is still needed to build the save archive and is served from here. src/coepIsolation.test.mjs enforces that this stays true.
cataclysm-tiles.js and cataclysm-tiles.data.js are upstream's Emscripten output, unmodified.

All fifteen tileset packs are mirrored (~51 MB of .data, in R2; the .mjs loaders are here). They are not optional in practice: the build asks for UltimateCataclysm on first run, and without it the game silently falls back to ASCII.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/cdda/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/cdda/ mirror; upload with `node scripts/r2-sync.mjs cdda`.
