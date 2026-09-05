Three.js Descent — https://github.com/mrdoob/three-descent (MIT; bundled OPL3 synth LGPL-2.1-or-later, see src/vendor/opl3).
A native three.js re-implementation of Descent (Parallax Software, 1995), mirrored 2026-09-05.
descent.hog / descent.pig are the Episode 1 SHAREWARE data files, included by the upstream project for free distribution; the registered episodes are not here. They are served from R2 by functions/descent/[[file]].ts.
index.html is ours (full-screen, importmap points at the vendored three.js instead of a CDN). src/ is unmodified.

Big binaries are not in this directory: they live in the abhishekstation-assets R2 bucket and are served at these same paths by functions/descent/[[file]].ts (see functions/r2serve.ts). Local dev uses the gitignored r2/descent/ mirror; upload with `node scripts/r2-sync.mjs descent`.
