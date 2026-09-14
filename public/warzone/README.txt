Warzone 2100 — https://github.com/Warzone2100/warzone2100 (GPL-2.0-or-later). Official Web Edition, mirrored 2026-09-14 from https://play.wz2100.net/dev/.
A 1999 3D real-time strategy game with a full campaign. Unlike most of this shelf it is not a reimplementation: the original developers' code was released, and this is the upstream project's own WebAssembly + WebGL2 build.

Everything ships, including the music. Eidos released the source and most assets under the GPL in December 2004; in June 2008 the licence was clarified to free the remaining pieces — the soundtrack and the video cutscenes — under the same terms. So there is no shareware slice here and nothing for the player to supply.

index.html is upstream's with three edits, all forced by this console rather than taste:
  · Bootstrap's CSS and JS are served from this directory instead of cdnjs. This directory takes COEP: require-corp, which blocks every cross-origin no-cors subresource — and a <link rel=stylesheet> is a subresource, not a navigation, so the stylesheet would have been blocked too.
  · The subresource integrity and crossorigin attributes went with them; they describe the cdnjs copies.
  · Upstream's service worker is not registered. It precaches its own asset list (including those cdnjs URLs) and this site already has a PWA layer at the root; a second worker scoped to /warzone/ would cache a build the deploy could no longer replace.

No other patching was needed: the build already supports self-hosting. Off play.wz2100.net it resolves WZ_DATA_FILES_URL_HOST to the empty string and looks for everything same-origin, which is exactly what we want.

Not mirrored: the campaign video sequences (upstream serves them from data.play.wz2100.net/sequences/). The game runs and the campaign is playable without them — the cutscenes are simply skipped.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/warzone/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/warzone/ mirror; upload with `node scripts/r2-sync.mjs warzone`.
