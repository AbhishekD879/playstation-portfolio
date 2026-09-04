# Arcade — scope

Adds the arcade era to the console: CPS1/CPS2/Neo Geo via `fbneo`, plus classic
MAME via `mame2003_plus`. Chosen over Dreamcast after establishing Dreamcast is
not buildable for the web (no flycast core in EmulatorJS's build set, none on
libretro's emscripten buildbot, no emscripten target upstream in flycast itself).

Status: **built (2026-09-04, branch feat/games-shelves).** Arcade shelf with `arcade` (fbneo) and `mame` (mame2003_plus) as two systems from the registry; `.zip` is accepted only from that shelf and the console asks which core; `EJS_gameName` keeps the `.zip` so the romset name reaches the core; `EJS_controlScheme` set so Select is "insert coin". Verified: MAME's freely released Gridlee boots and paints. Note: the Dreamcast conclusion below is superseded — flycast-wasm (Aug 2026) exists; see docs/games-roadmap.md.

## Why arcade is the right addition

- **Cores already exist** on the CDN we already use — zero porting, unlike every
  other candidate. This is a config + UX job, not an emulator job.
- **Cheap to run.** From EmulatorJS `consts.js`:
  `requiresThreads = ["ppsspp", "dosbox_pure", "azahar"]` and
  `requiresWebGL2 = ["ppsspp", "azahar"]` — **arcade needs neither.** So unlike
  our PS2 and PSP paths it has no cross-origin-isolation dependency and no WebGL2
  floor: it runs on phones and in browsers where PS2 can't.
- **It is the most multiplayer library in existence.** Nearly every title is
  2-player co-op or versus, and our retro netplay already streams the host canvas
  and injects player 2 via `gameManager.simulateInput(1, btn, v)` — the same path
  that shipped for NES/SNES. Arcade turns that feature from a novelty into the
  console's best mode.

## What the recon settled

**Two systems, not one.** `consts.js` maps them separately:

```js
"arcade": ["fbneo", "fbalpha2012_cps1", "fbalpha2012_cps2", "same_cdi"],
"mame":   ["mame2003_plus", "mame2003"],
```

`EJS_core` takes the *system* key (`"arcade"` / `"mame"`) and picks element 0 by
default; a specific core is selectable via the `retroarch_core` setting. So both
belong in one Arcade home as two systems.

**Core choice is per-ROM and cannot be inferred.** Every arcade ROM is a `.zip`,
and which core runs it depends on the romset's *version lineage*, not its name —
an fbneo set and a MAME 0.78 set for the same game are different files. This is
the defining difference from our disc-based systems, where the extension decides.
Consequence: **the game record must store the core, and the user must be able to
change it per game.** We already have the surface for that — the per-game options
sheet (Play / Re-link / Remove) plus the pattern just built for PS2's
Advanced/Native picker.

**Do not unzip.** `emulator.js` marks both ROM and BIOS
`dontExtractIfCore: ["arcade", "fbneo", "fbalpha2012_cps1", "fbalpha2012_cps2", "same_cdi", "mame", "mame2003_plus", "mame2003"]`
— the `.zip` is handed to the core as-is. Our blob-URL flow already does this, so
nothing to change, but nothing may be added that "helpfully" extracts.

**Coin-op controls are a real thing.** EmulatorJS relabels button id 2 to
`INSERT COIN` when the control scheme is arcade/mame. Our `EJS_CONFIG` gamepad map
sends `s` for pad button 2, so coin insert works by accident — but the on-screen
hints must say "insert coin" or nobody will know how to start a game. CPS2
fighters also want 6 buttons; the existing map already covers 6 face/shoulder
buttons, so no new mapping, just correct labels.

**`.zip` collides with three existing apps** (RPG Maker, Unity, HTML5 players).
The global XMB file input's `accept` list does *not* currently include `.zip`, and
there is already a one-shot `insertPrefer` mechanism used to disambiguate
`.iso`/`.chd`/`.pbp` between PS2/PSP/PS1. Arcade reuses that: `.zip` is only
offered from the Arcade home's picker, tagged `arcade` on the way in. No global
`.zip` claim.

## Integration points (all existing seams)

| what | where |
|---|---|
| systems | `GameSystem` union + `CORE_NAMES` in `src/gamesdb.ts` |
| ext→core | `classify()` in `XMB.tsx`, extended with `prefer: "arcade" \| "mame"` |
| picker | `onLink`/`onDisc` accept lists, `.zip` gated to the arcade home |
| home | a `GameShelf` instance like `retrohome` — ~12 lines |
| route + gate | `ROUTE_APPS`, `app()` union, Labs flag (default ON; it's not experimental) |
| per-game core | new row in the GameShelf options sheet |
| netplay | already generic over EmulatorJS cores — expected to need nothing |
| upscaler / SHARE / Console TV | already generic over canvas surfaces |

## Verification without commercial ROMs

This is the part that shapes the phasing, because the constraint is real: we do
not source commercial ROMs.

**`mame2003_plus` is the testable path.** A handful of arcade titles are
*legally* freely distributable — Gridlee, Robby Roto (released free by its
rights-holder), Alien Arena, Teeter Torture — and they are MAME drivers needing
**no BIOS**. That gives a genuine end-to-end boot test: real ROM, real core, real
canvas, real netplay, nothing pirated.

**`fbneo`/CPS is structurally verified only.** Its marquee library (Street
Fighter II, Cadillacs and Dinosaurs, Metal Slug, Marvel vs Capcom) is entirely
commercial, and Neo Geo additionally needs `neogeo.zip` as a BIOS, which is not
free either. So P1 proves the plumbing on `mame`, and the fbneo path is verified
with the user's own ROMs.

**BIOS is a new capability for us.** We have never set `EJS_biosUrl` — no system
we support needed it. Neo Geo does. That means a "bring your own BIOS" slot,
stored per-system in IndexedDB like a game record, and an error that says
*"this romset needs neogeo.zip"* rather than a black screen.

## Failure UX is the actual work

Arcade differs from every system we support in one user-visible way: **a wrong
romset fails silently.** Wrong version, missing parent set, missing BIOS, or
wrong core all produce a black screen or an unhelpful core log. A visibly dead
app is worse than a missing one (the Podcasts lesson). So:

- Detect no-first-frame within a timeout and surface a real diagnosis, using the
  core's own log lines already captured by `diag-core.js`.
- The error names the likely cause and the fix: try another core, this set looks
  like a MAME set, this needs a BIOS.
- The per-game core row is one tap from that error.

## Phases

- **P1 — one system, one core, proven.** `mame` + `mame2003_plus`, a free ROM,
  Arcade home, `.zip` via `insertPrefer`, coin-op labels. Gate: boots, runs at
  full speed, netplay drives player 2, upscaler and SHARE work.
- **P2 — fbneo + per-game core picker.** Add the `arcade` system, the options-sheet
  core row, and the failure diagnosis. Gate: user's own CPS ROM boots and can be
  switched between cores without re-adding the game.
- **P3 — BIOS slot.** `EJS_biosUrl` plumbing for Neo Geo, with a clear "bring your
  own BIOS" flow. Gate: a Neo Geo title boots with a user-supplied BIOS.

Kill criterion is weak here on purpose — the cores exist and are known-good, so
the risk isn't "does it work", it's "can a user get their romset to run without
support". If P1's failure UX can't explain a bad set clearly, stop at P1 rather
than ship a confusing app.

## Deliberately out

- **`same_cdi`** (CD-i) — in the arcade core list, no library worth having.
- **`azahar` (3DS)** — newly present in `consts.js`, but needs threads *and*
  WebGL2 and 3DS emulation is heavy; separate investigation, not part of this.
- **`dosbox_pure`** — genuinely appealing (DOS-era nostalgia) but wants a `.conf`
  and needs threads. Its own scope.
