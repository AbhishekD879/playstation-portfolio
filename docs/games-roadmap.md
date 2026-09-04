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

## Phase 4 — free to play (2026-09-04)

Almost every shelf needs the visitor's own files, and portfolio visitors bring
nothing. Two moves fix that without touching any engine:

**Free games sheet** (`src/freegames.ts`, `src/xmb/FreeGamesSheet.tsx`,
`functions/api/rom.ts`). A shelf whose systems have free titles shows a
"Free games · N" pill; each row is homebrew or a game its rights-holder
released, with author, licence and size, and "Download to shelf" fetches the
file in the browser and stores it in the library (`origin: "download"`,
`source` = upstream URL, so a second visit shows "On your shelf"). Hosts that
send no CORS header go through `/api/rom`: https only, host allow-list with
per-host path rules (mamedev.org `/roms/`, github.com release-download paths,
GitHub's asset CDNs), redirects followed only onto the allow-list, 64 MB cap,
per-IP rate limit on the existing GB KV. The console never hosts the ROMs.

Catalog: 17 mamedev.org free sets (mamedev.org lists 20; `falcnwld` and
`topgunnr` are not in MAME 2003-Plus per the core's `driver.c`, and `looping`
is in the driver list but mamedev's set does not start in this core — it
drops to the RetroArch menu — so it is left out; Poly-Play is not on
mamedev.org); Nova the Squirrel (NES, GPL-3), µCity (GBC, GPL-3+), Bounstryk
(2600, Apache-2, stored as `.a26`); six WASM-4 carts from the CC BY-NC-SA
carts archive (raw.githubusercontent sends CORS, so direct). Verified on the
preview with a scripted sweep (download through the relay → tile → Play →
canvas screenshot): all 17 MAME sets reach their attract screens (Alien
Arena, Car Polo, FAX, Super Tank checked by eye; the rest by a lit, animating
canvas). The relay follows GitHub's two-hop release redirects (Nova, µCity,
Bounstryk return 200) and refuses off-path GitHub URLs (403).

**Web games under PC Games** (`src/webgames.ts`, `WebGameApp.tsx`): whole
engine builds with free data, hosted under `public/` and opened full-screen
in a same-origin frame with EJECT — no upload step at all.

| Game | Build | Size | Data | Verified |
|---|---|---|---|---|
| Micropolis | SimHacker MicropolisCore web build, GPL-3 | 2.8 MB | GPL | renders in console (preview) |
| Jazz Jackrabbit | OpenJazz Emscripten (openjazz.github.io), GPL-2 | 4.3 MB | Epic shareware episode | renders in console (preview) |
| Wolfenstein 3D | ECWolf-JS 1.5pre default frontend, GPL-2 | 5.2 MB | shareware episode bundled in `ecwolf.data` by the project | boots, canvas painting, clean console (local) |
| Quake | Qwasm (qwasm.m-h.org.uk build), GPL-2; `getgame.js` patched to fetch our copy of the unmodified `quake106.zip` | 26.7 MB (largest file 9.1 MB) | id shareware archive, unpacked client-side; LibreQuake also offered | boots to the game canvas after Start (local) |
| OpenTTD | openttd-online 15.3 Emscripten build, GPL-2; language pre-loader IIFE removed; OpenGFX 7.1 written into `/baseset` before `main()`; the page must predefine `Module.arguments`/`postRun` (the build's pre.js pushes onto them) | 18.6 MB (wasm 10.8 MB) | OpenGFX GPL-2, saves in IDBFS | title screen with OpenGFX, clean console (local) |
| Diablo | DevilutionX, built here from upstream master (2026-08-24) with emsdk 4.0.1 via `emcmake cmake` (Sustainable Use License 1.0, non-commercial); the build's own Emscripten shell + file manager, assets preloaded, saves in IDBFS; our CSS makes it full-screen | 45 MB (spawn.mpq 25,448,219 B, wasm 6.5 MB, data 12.7 MB) | `spawn.mpq` shareware data as distributed by the DevilutionX project; owners can add DIABDAT.MPQ through the file manager | boots to the title screen with spawn.mpq loaded, clean console (local) |

Parked: Jazz Jackrabbit 2 (`jazz2.data` 46.7 MB > the 25 MiB per-file cap →
R2), OpenLara (official site unreachable), C64 / Amiga / Neo Geo Pocket /
WonderSwan homebrew (no free titles with a direct, licence-clear download
found — CSDb/Aminet/AtariAge have no CORS and mixed licences), Tobu Tobu Girl
(no direct file). DevilutionX is in (row above): upstream has an Emscripten
target and `spawn.mpq` is 25,448,219 bytes — 0.7 MB under the cap, so no R2.

## Phase 5 — saved progress (2026-09-04)

EmulatorJS 4.2.3 only ever *downloads* a save state (its "Keep in Browser"
mode is one unnamed slot) and never persists in-game saves (SRAM) at all; our
EJECT reloads the page, so until now every EmulatorJS session lost both. The
session now keeps progress in the console (`saves` store in the `asp-games`
DB — `src/saves.ts`, `gamesdb.ts`, `GameSession.tsx`, `GameShelf.tsx`):

- **manual** — the "save progress" button in the session bar, and
  EmulatorJS's own Save State menu button (its `saveState` event is answered
  by us, which cancels the download). Nothing is snapshotted behind the
  player's back: saving is their call (an auto-snapshot on EJECT was built
  and removed on request).
- **sram** — the game's own save file: EmulatorJS's periodic flush
  (`saveSaveFiles`, default every 5 min) plus a flush on EJECT, written back
  into the core's save path before `loadSaveFiles()` on the next start.
- Game options shows **Continue · your save · N min ago** with the thumbnail
  as the primary row when a snapshot exists; **Play from start** ignores it.
  Load State in the EmulatorJS menu loads that snapshot. Removing a game
  removes its saves.
- Scope: every EmulatorJS shelf (retro, PS1, arcade, Dreamcast, PSP…). PS2
  already had its own saving since the Play! work: the frame snapshots
  Play!'s data dir (memory cards `vfs/mc0`/`mc1` + states) into the `asp-ps2`
  DB per profile every 15 s and on the memory-card button, and restores it
  before a disc boots — untouched here, and re-verified with a real disc: a
  file planted on `vfs/mc0` is in the profile's card record after "save card"
  ("Memory card saved · 2 files") and comes back byte-for-byte after a page
  reload and a fresh boot. Web games keep their own saves where
  the build mounts IDBFS (OpenTTD, DevilutionX, ECWolf, Qwasm); Jazz and
  Micropolis do not persist.
- Verified locally with a blank NES ROM: manual save → 13.7 KB state + PNG;
  Continue row with thumbnail; resume boots, loads, says "CONTINUING FROM
  YOUR SAVE".

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
- 2026-09-04 · Phase 4 free-to-play: Free games sheet + allow-listed relay (mamedev + GitHub releases), 27-title catalog; Wolf3D, Quake, OpenTTD join Micropolis and Jazz under PC Games as full-screen web games.
- 2026-09-04 · Diablo (DevilutionX, own Emscripten build) joins PC Games — the last engine on the free-to-play list.
- 2026-09-04 · Free-games sweep on the preview: 17/18 mamedev sets boot in MAME 2003-Plus; `looping` dropped. Phase 4 complete on the preview (`feat-games-shelves`); not yet in production.
- 2026-09-04 · **Phase 4 deployed to production** (main `16e13ef`). Regression pass, preview vs previous production: captured non-Games crossbar lists identical; 31 app routes open with zero runtime errors on both; the four shelf boots (NES, GBA, Mega Drive, SNES) behave identically; the six web games open in-console with zero runtime errors. Verified live: relay 200/403, Arcade "Free games · 17", PC Games folder lists all six web games, Wolfenstein 3D runs.
- 2026-09-04 · Phase 5 saved progress: manual snapshots + SRAM per game, Continue row in Game options, EmulatorJS Save/Load State routed to the console's storage. PS2 memory cards were already persisted (Play! frame).
