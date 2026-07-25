# PS2 multitap — the console side

The emulator work lives in a **separate repository**:
**https://github.com/AbhishekD879/Play- · branch `multitap`**
— a true GitHub fork of [jpd002/Play-](https://github.com/jpd002/Play-), so
lineage is visible, `git fetch upstream` works out of the box, and the clean
patches (P1–P4) can be offered upstream with one click.
Local clone: `~/src/Play-` (`origin` = the fork, `upstream` = jpd002). Its `docs/` holds the spec, the patch register and
the upstream sync runbook. Nothing in this repo needs the emulator source — only
its build output.

## What lives here

| Path | Role |
|---|---|
| `public/play/` | **STOCK** engine — unmodified upstream. Two controllers. Never edit. |
| `public/play-mt/` | **FORK** engine — built `Play.js` + `Play.wasm` + `index.html` + `LICENSE`. Up to six players. |
| `src/ps2/engineRouter.ts` | Picks which engine boots, with fallback to stock |
| `src/ps2/players.ts` | Seat model: who is in which controller slot |

## Routing

Decided **once, before the disc boots** — the wasm module and its VM are built at
page load, and a game latches its controller-slot count during init.

- 1–2 players → `stock`
- 3–6 players → `multitap`
- fork missing or failing → **fall back to stock**, capped at 2

So a bad fork build degrades to "6-player unavailable", never "PS2 broken".

## Pad numbering

With a tap present the flat pad index is `port * 4 + slot`:

| Player | Pad index | Port | Slot | Config name |
|---|---|---|---|---|
| 1 | 0 | 0 | 0 | `input.pad1` |
| 2 | 1 | 0 | 1 | `input.pad2` |
| 3 | 2 | 0 | 2 | `input.pad3` |
| 4 | 3 | 0 | 3 | `input.pad4` |
| 5 | 4 | 1 | 0 | `input.pad5` |
| 6 | 5 | 1 | 1 | `input.pad6` |

Six players therefore needs a tap on **both** ports (4 + 2). Player 2 keeps the
same keyIds it has on the stock engine, so the existing 2-player injector works
against either build unchanged.

## Updating the engine

```bash
cd ~/src/Play-                      # branch: multitap
emcmake cmake --preset wasm-ninja
cmake --build --preset wasm-ninja-release
cp build_cmake/build/wasm-ninja/Source/ui_js/Release/Play.{js,wasm} \
   <this repo>/public/play-mt/
```

`public/play-mt/index.html` is **ours**, not upstream's — it writes the 6-pad
input profile and calls `setMultitapEnabled` before boot. Do not overwrite it
from the fork.
