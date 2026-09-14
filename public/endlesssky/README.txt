Endless Sky — https://github.com/endless-sky/endless-sky (GPL-3.0; art and audio CC-BY-SA 4.0 / CC-BY 4.0).
Web build from https://github.com/thomasballinger/endless-web, mirrored 2026-09-14 from https://play-endless-web.com/. Hashed upstream filenames are kept exactly as they are so the page works unmodified.
A 2D space trading and combat game in the Escape Velocity line. Engine and assets are both free, so the whole game ships — there is no shareware slice here.

index.html is upstream's with two edits, both required rather than cosmetic:
  · the plausible.io analytics tag is removed — this console does not send visitors to a third party.
  · jszip and jszip-utils are served from this directory instead of cdnjs, because the directory takes COEP: require-corp and that blocks every cross-origin no-cors subresource.
src/coepIsolation.test.mjs enforces that no cross-origin subresource creeps back in.

The data package is 401 MB. It is downloaded once and cached in IndexedDB by upstream's own cached-resource layer, so it is a first-run cost, not a per-session one. Worth knowing before putting this on a phone.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/endlesssky/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/endlesssky/ mirror; upload with `node scripts/r2-sync.mjs endlesssky`.
