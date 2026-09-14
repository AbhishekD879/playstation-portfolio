# Self-hosted games

Most of the PC Games shelf ships with this repository, because every one of
those carries a licence that permits it — id's and 3D Realms' shareware terms,
GPL, MIT, Creative Commons. `src/webgames.ts` records which, per entry.

Four do not, and are handled differently — but for **two different reasons**,
which `src/webgames.ts` records in an `absent` field rather than leaving to
guesswork:

| Game | `absent` | Why |
| --- | --- | --- |
| **Half-Life 2** | `not-ours` | The port derives from leaked Source code and runs on Valve's assets. |
| **Pepsiman** | `not-ours` | A recompilation of a commercial PS1 game; the data is KID's. |
| **OpenRCT2** | `not-ours` | The engine is GPL-3.0, but the graphics, music and scenarios are Atari's and Chris Sawyer's. |
| **Luanti** | `no-build` | Freely redistributable. Absent only because upstream has no web target. |

The distinction matters. Only `not-ours` entries have to say **NOT
REDISTRIBUTED** in their licence field, and `src/webgames.test.mjs` enforces
that in both directions — a `no-build` entry claiming it is not redistributable
fails just as loudly as a `not-ours` entry that forgets to say so. Luanti is
free software; the only thing standing between it and the shelf is a build.

Nothing about any of them is in this repository — no engine, no assets, not a
byte. `public/hl2/`, `public/pepsiman/`, `public/openrct2/` and `public/luanti/`
are gitignored, and the shelf probes for each at boot and shows a tile **only if
the build is actually there**. A fresh clone, or a deploy by anyone who has not
added them, shows nothing at all.

## Adding a build

Put it at the path the registry expects, so that `index.html` is the entry
point:

```
public/hl2/index.html          ← plus its .wasm, .data, map chunks…
public/pepsiman/index.html     ← plus its .wasm and data
public/openrct2/index.html     ← plus your RollerCoaster Tycoon 2 data
public/luanti/index.html       ← the contents of luanti-wasm's www/
```

Then `npm run build && npx wrangler pages deploy`. The tile appears by itself —
no code change, no registry edit. Remove the directory and it disappears again.

Both paths already get `Cross-Origin-Embedder-Policy: require-corp` from
`public/_headers`, which is what gives them `SharedArrayBuffer` and threads, on
Safari as well as Chrome. That costs nothing while the directories are absent —
a header rule for a path that 404s does nothing.

The one constraint that will bite: **a require-corp document cannot load any
cross-origin no-cors subresource.** If a build pulls a font, an analytics
script or a texture from a CDN, that request is blocked and fails silently.
Self-host it, or drop the directory from the isolated list in `public/_headers`
and accept single-threaded. `src/coepIsolation.test.mjs` checks this for every
directory that is present.

## Where the builds come from

- **Half-Life 2** — <https://hl2.slqnt.dev>. Emscripten + WebGL2, roughly 75–85%
  of native speed. It derives from `nillerusr/source-engine`, which is a fork of
  the Source code that leaked in 2020, and it runs on game data unpacked from
  the retail VPKs and sliced into one `.data` file per map, streamed as you
  play. Both halves of that are someone else's: the engine's provenance and
  Valve's assets.
- **Pepsiman** — a PSXRecomp static recompilation, July 2026. Not emulation: the
  original binary is recompiled to WebAssembly, so it runs natively at 60 fps
  with widescreen and persistent saves. The game is KID's.
- **OpenRCT2** — <https://github.com/Mstrodl/ORCT2-web>, an Emscripten build of
  the GPL-3.0 reimplementation. It needs the data files from a copy of
  RollerCoaster Tycoon 2 that you own.
- **Luanti** — <https://github.com/paradust7/luanti-wasm>, an experimental
  Emscripten port of the voxel engine formerly called Minetest. There is no
  official web target and no published artefact: `./build_all.sh` on Linux
  produces a `www/` directory, and that directory is what goes in
  `public/luanti/`. Multiplayer needs a WebSocket proxy, because a browser
  cannot open the UDP socket the protocol expects.

Hosting either one publicly is a distribution decision, and this repository
does not make it for you — which is exactly why the builds live outside it.
