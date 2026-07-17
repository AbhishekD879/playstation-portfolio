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
