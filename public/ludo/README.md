# 3D Ludo tabletop assets

These give the 3D Ludo board its "sitting at a real table" look: a PBR wood
table and a real studio environment map for believable plastic/varnish
reflections. They're lazy-loaded only when the 3D board mounts.

All four files are from **[Poly Haven](https://polyhaven.com)** and are
**CC0 / public domain** — no attribution required (credited here anyway).

| File           | Asset                     | Source                                                    |
| -------------- | ------------------------- | --------------------------------------------------------- |
| `wood_col.jpg` | Fine Grained Wood, colour | polyhaven.com/a/fine_grained_wood — CC0                   |
| `wood_nor.jpg` | …OpenGL normal map        | same asset, `nor_gl`                                       |
| `wood_arm.jpg` | …AO / Roughness / Metal   | same asset, `arm` (R=AO, G=roughness, B=metalness)          |
| `studio.hdr`   | Brown Photostudio 02, 1k  | polyhaven.com/a/brown_photostudio_02 — CC0                 |

All at 1k, ~2.4 MB total, deliberately the smallest useful resolution: the
board is viewed from a fixed distance so higher mips would never be sampled.

The Ludo **board and pieces stay procedural geometry** — a Ludo board is flat
coloured graphics plus lathe-turned pawns, so modelling them in code is both
smaller and sharper than any downloadable mesh (the CC0 `chess_set` on Poly
Haven is photogrammetry with 8K maps — hundreds of MB, and the wrong game).

Like `public/models/`, these are **not committed to git** (binary assets); they
ship because `npm run build` copies `public/` into `dist/`. Re-download with the
URLs above if you clone fresh — the 3D board degrades gracefully without them
(plain colours, no env reflections).
