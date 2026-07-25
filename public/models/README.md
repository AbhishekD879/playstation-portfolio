# 3D controller models

These `.glb` files power the 3D controller test. They are **not committed to git**
(too large to push over HTTPS; see `.gitignore`). They ship to production because
`npm run build` copies `public/` into `dist/`, which is what gets deployed.

If you clone this repo fresh, drop these files back into `public/models/`:

| File            | Model                        | Source / License |
| --------------- | ---------------------------- | ---------------- |
| `dualsense.glb` | Sony PS5 DualSense controller | Sketchfab, CC-BY — credit the original author in the System Manual |
| `xbox.glb`      | Xbox Series controller        | Sketchfab, CC-BY — credit the original author in the System Manual |

Both are CC-BY: attribution is required. The System Manual (in-app) lists the
author credits.

## `chess/` — the 3D chess set

A real photogrammetry chess set from **[Poly Haven](https://polyhaven.com/a/chess_set)**,
**CC0 / public domain** (no attribution required; credited anyway). Vendored at
**1k**, ~7.3 MB total — the 4k/8k variants are 60 MB and 210 MB, which is why the
smallest useful resolution is the one we ship.

| Path                        | What                                            |
| --------------------------- | ----------------------------------------------- |
| `chess/chess_set.gltf`      | scene; nodes named `piece_<type>_<colour>_<n>`  |
| `chess/chess_set.bin`       | geometry                                        |
| `chess/textures/*_1k.jpg`   | diff / nor_gl / arm for pieces (both) + board   |

`Board3D.tsx` lifts ONE prototype mesh per (type, colour) from those node names
and clones it per square. If the download is missing the board falls back to the
procedural lathe-turned pieces, so chess is never blocked on an asset.

Also **not committed to git** — re-fetch from the Poly Haven link above.
