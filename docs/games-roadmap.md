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

## Phase 2 — BIOS slot + EmulatorJS quick wins

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
