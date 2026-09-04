# Games shelf — roadmap

Long-running effort, started 4 Sep 2026 on branch `feat/games-shelves`.
Goal: group the Games column the way a PlayStation groups its games, then add
every emulator and engine that can run in a browser, tagged honestly for the
devices it runs on. The core engines (Play!, PPSSPP, EmulatorJS 4.2.3, js-dos,
v86, Ruffle, ScummVM, the CS/DOOM ports) do not change; paths and groupings do.

Research behind this: the "AbhishekStation Next Shelves" report (4 Sep 2026),
70 candidates graded quick win / medium / hard / not feasible.
Working notes live in `docs/arcade-scope.md` (arcade) and this file.

## Grouping (Phase 1) — done in this branch

Top level of Games (`src/xmb/gameFolders.ts`, tested):

| Entry | Kind | Contents |
|---|---|---|
| PlayStation | folder | PlayStation · PlayStation 2 · PSP |
| Nintendo | shelf | NES · SNES · N64 · GB/GBC · GBA · DS |
| Sega | shelf | Mega Drive (more to come) |
| PC Games | folder | DOOM · DOOM RTX · Counter-Strike 1.6 · Point & Click |
| Game Makers & Web | folder | RPG Maker · Ren'Py · Godot · Unity · HTML5 · Flash |
| Play Together | folder | Party · Board · Join a Retro Game · Console TV · Lichess TV |
| Console Originals | folder | Chess · Trivia · World Drive |

Rules: every item is filed once (test fails otherwise); unfiled items still
show loose at the end (never lost); a folder whose members are all Labs-off is
not shown; `#/game/<folder>` is the folder's address; ○ steps out with the
cursor back on the folder; selection is remembered per folder; search finds
leaves and opens their folder. `#/app/retrohome` (the old every-system shelf)
keeps working but is not listed.

Planned entries: Arcade (shelf), More Consoles (shelf), Computers (folder:
shelf + x86 PC), Mobile (folder), fantasy consoles under Game Makers & Web.

## Phase 2 — BIOS slot + EmulatorJS quick wins — done in this branch (arcade pending)

Shipped: `src/systems.ts` registry (single source for names, formats, BIOS,
device fit, cover repos; tested), `src/bios.ts` BIOS pocket (IndexedDB, one zip
per system handed to EmulatorJS as `EJS_biosUrl`), the "Systems" sheet on every
shelf (fit verdict per system in Labs' words, BIOS status, add/remove), the
"which system is this disc for?" chooser for shared formats, and four shelves:
Nintendo (+Virtual Boy), Sega (Mega Drive, Master System, Game Gear, Sega CD,
32X, Saturn), More Consoles (PC Engine, PC-FX, Neo Geo Pocket, WonderSwan, Lynx,
Atari 2600/5200/7800, Jaguar, 3DO, ColecoVision), Computers (Amiga, C64, ZX
Spectrum, Amstrad CPC).

Verified in headless Chrome through the console's own picker (2026-09-04):
C64 runs a BASIC program; Atari 2600 paints a hand-assembled frame; Amiga boots
AROS on a blank disk; ZX Spectrum boots from a .z80 snapshot; Master System,
Game Gear, PC Engine, Neo Geo Pocket, WonderSwan, Virtual Boy, Atari 5200/7800,
32X and Jaguar select their cores and run. BIOS round-trip: Sega CD flips to
"BIOS ready" on the third file; a Master System boot received
`segaMS-bios.zip`. Not verifiable without firmware or discs: Saturn, Sega CD,
3DO, PC-FX, Lynx, ColecoVision boots (cores load; the sheet says what is missing).

Still to do in this phase: Arcade (fbneo + mame2003_plus) per
`docs/arcade-scope.md` — needs `EJS_dontExtractBIOS` for zipped BIOS and a
per-game core choice.

### Original plan

The gate for nine systems. One OPFS-backed BIOS pocket per system on the
shelf, passed to EmulatorJS as `EJS_biosUrl` (as a `File`, plus
`EJS_dontExtractBIOS` for zipped arcade BIOS). Then, per system, four
touchpoints: `GameSystem` + `CORE_NAMES` + `THUMB_REPO` + `CORES` in
`src/gamesdb.ts`, and the shelf's systems list.

Order: Sega family (Saturn, Sega CD, 32X, Master System, Game Gear) → handhelds
(NGP, WonderSwan, Virtual Boy, Lynx) → PC Engine (+CD) → Atari 2600/5200/7800,
Jaguar, 3DO, PC-FX, ColecoVision (More Consoles shelf) → computers (Amiga, C64
family, ZX Spectrum, Amstrad CPC) → Arcade (fbneo, mame2003_plus) per
`docs/arcade-scope.md`.

Device tags: `rateFeature` in `src/labs.ts` already rates apps by WebGPU,
isolation, desktop, memory. New systems get specs there so the shelf can say
"may not run on this device" instead of hiding.

## Phase 3 — embeds (medium)

Palm OS (CloudpilotEmu embed), Java ME (j2me-player / CheerpJ CDN),
Dreamcast (flycast-wasm, self-hosted core, `'wasm-unsafe-eval'`),
Windows 95/98 on the existing v86 (disk-image attach + on-screen keyboard),
Classic Mac (Infinite Mac iframe), OpenTTD + Micropolis, DevilutionX,
shareware FPS shelf (Quake, Quake III + OpenArena, Wolf3D, RTCW demo),
Jazz Jackrabbit 1 & 2, OpenLara, Duke Nukem II, TIC-80, WASM-4, Scratch.

## Known constraints (from research, Sep 2026)

- iOS Safari: no COEP `credentialless` → no threads; open EmulatorJS issues
  report iOS killing any libretro core after 60–90 s. Tag, don't hide.
- EmulatorJS is pinned to 4.2.3; 4.3.0-pre cores are not interchangeable.
- Licences: EmulatorJS GPL-3; FBNeo / snes9x / MAME 2003 non-commercial.
- PS1 `.chd` goes to pcsx_rearmed, which does not list CHD — verify.

## Status log

- 2026-09-04 · Phase 1 grouping implemented (folders, shelves, routes, tests).
- 2026-09-04 · Phase 2: registry, BIOS pocket, Systems sheet, disc chooser, 20 new systems across four shelves; 14 cores smoke-booted.
