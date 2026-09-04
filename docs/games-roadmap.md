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

Arcade shelf (fbneo + mame2003_plus) also done: `.zip` only from the Arcade
shelf, chooser picks the core per romset, `EJS_gameName` keeps `.zip`,
`EJS_controlScheme` for coin/start labels, BIOS pocket takes `neogeo.zip` /
`pgm.zip` (the outer zip is extracted, the inner archive stays whole, which is
what FBNeo wants — no `EJS_dontExtractBIOS` needed). Verified with MAME's free
Gridlee romset.

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

Done: **Palm OS** (2026-09-04) — CloudpilotEmu embedded 2.2.3 (GPL-3), wasm +
worker self-hosted under `public/palm/`, lazy-loaded UMD; `palm` system in the
registry (engine `cloudpilot`, `.prc`), device ROM in the BIOS pocket with an
"any .rom" rule, Mobile shelf, `PalmSession` player (touch = stylus, EJECT back
to the shelf). Verified without a device ROM: shelf, BIOS rule, no-ROM message,
wasm loads from our origin, a fake ROM is rejected by Cloudpilot's own check.
Needs a real m68k/OS5 ROM for a full boot.

Done: **Fantasy Consoles** (2026-09-04) — WASM-4 (slim runtime, ISC,
`public/wasm4/`) as a `frame` engine: a same-origin player page that announces
"ready" and takes the cart by postMessage, writing the same z85 cart JSON block
its own bundler would plus a per-cart disk prefix for saves. One generic
`FramePlayer` component (removing the iframe is the eject); shelf lives inside
Game Makers & Web. Verified with WASM-4's Watris.

**TIC-80 parked.** The official web build (MIT) boots and prints its banner,
but a cart handed in at runtime never reaches the loader: tried MEMFS at `/`
and `/tic80`, seeding its IDBFS (`/com.nesbox.tic/TIC-80`, store `FILE_DATA`,
same record shape it writes) and passing the absolute path — every time
"loading cart… the code is empty" (start.c reads argv with a plain `fs_read`).
A real tic80.com cart fails the same way, so it is not the cart format. Next
idea when revisited: build TIC-80 with a preload of the cart, or drive the
console (`load <name>`) after boot via a custom `--cmd`-capable build. The
player page is kept in the session scratchpad; assets were removed from
`public/` so nothing dead ships.

Done: **Java ME** (2026-09-04) — freej2me-web (zb3, GPL-3) vendored under
`public/j2me/` (JAR runtime, libmidi/libmedia wasm, keypad UI; 8.4 MB). It runs
as a **top-level tab**, not a frame: CheerpJ (streamed from its CDN under the
Community licence) embeds a helper frame from that CDN, and a document under
our COEP may only embed frames that are themselves isolated — Chrome blocks it
(`ERR_BLOCKED_BY_RESPONSE`), same-origin or not. So `/j2me/*` is served with
the isolation headers detached (`public/_headers` `!` rules; a Vite middleware
mirrors it in dev), `bootJ2me()` opens the tab synchronously on the player's
click and hands the JAR over through IndexedDB (`asp-j2me`), which the page
polls for; `main.js` takes the JAR as an in-memory `/str/` file
(`cheerpOSAddStringFile`) and a MIDlet's exit closes the tab. Verified with the
bundled free Connect4 MIDlet from the shelf's Play: popup opens, game menu up
in two seconds.

Done: **Your own PC** (2026-09-04) — `x86` system on the Computers shelf, a
`frame` engine on the v86 the site already ships (`public/pc/player.html`; the
KolibriOS "Other OS" page is untouched). The player brings a floppy
(.ima/.vfd/small .img), hard disk (.img/.vhd/.raw) or CD (.iso) image; the
drive and boot order follow the extension and size; 128 MB RAM / 16 MB VGA for
Windows 98; phones get an on-screen keyboard that sends typed text to the PC.
The image stays the player's — nothing is hosted. Verified with the KolibriOS
floppy: boots to the desktop from the shelf, eject returns.

Done: **Dreamcast** (2026-09-04) — flycast-wasm v1.0 (GPL-2) packaged as an
EmulatorJS core archive (`public/ejs/cores/flycast-wasm.data`: the libretro
js/wasm, `core.json` with the author's tuned options, `build.json`,
licence) plus a core report, served from `public/ejs/` together with
unmodified copies of the 4.2.3 runtime files the loader actually pulls
(`README.txt` records source and licence). Only Dreamcast sessions use that
data path (`SystemDef.data`); everything else stays on the CDN. BIOS goes in
the pocket and is zipped under `dc/`, where flycast looks. Verified: from the
Sega shelf a Dreamcast disc pulls runtime + core from our origin, unpacks,
initialises with WebGL2 (`coreName: flycast`); without dumps flycast aborts, so
the console now refuses to boot any BIOS-required system that has no firmware
and says what to add instead. Real boot needs `dc_boot.bin`/`dc_flash.bin` and
a disc (not available to me).

Next in order: the shareware engines (Quake, Wolf3D, DevilutionX, OpenTTD,
Micropolis, Jazz, OpenLara).


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
- 2026-09-04 · Arcade shelf (FBNeo + MAME 2003-Plus); Gridlee boots. Phase 2 complete — 22 new systems.
- 2026-09-04 · Phase 3 begins: Palm OS via CloudpilotEmu (Mobile shelf).
- 2026-09-04 · Fantasy Consoles shelf: WASM-4 via a generic frame player; TIC-80 parked (cart never reaches the loader).
- 2026-09-04 · Java ME on the Mobile shelf, as its own tab (CheerpJ cannot be framed under COEP).
- 2026-09-04 · Your own PC disk images (Windows 9x / DOS) via v86 on the Computers shelf.
- 2026-09-04 · Dreamcast via self-hosted flycast-wasm core; BIOS gate before boot for every firmware-required system.
- 2026-09-04 · **Deployed to production** (main `ba030f4`). Regression pass on the preview: all 14 crossbar categories present and non-Games lists identical to the previous build; 31 app routes open with no runtime errors; NES, SNES, Mega Drive boot through the new shelves; GBA behaves as before (its core rejects a garbage ROM on both builds); PS2 engine binaries byte-identical.
