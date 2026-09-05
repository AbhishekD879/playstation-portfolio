// The registry is the one place a system is described. These checks keep it
// honest: no extension claimed by two systems unless it is declared shared, every
// cover repo is a real libretro-thumbnails repo, and the classifier keeps the
// behaviour the file picker has always had while learning to ask when it must.
import assert from "node:assert/strict";
const { SYSTEMS, SHARED_EXTS, ALL_EXTS, classifyFile, biosStatus, systemsOf } = await import("./systems.ts");

// verified against api.github.com/orgs/libretro-thumbnails/repos on 2026-09-04
const REPOS = new Set(["Sony_-_PlayStation_2", "Sony_-_PlayStation", "Sony_-_PlayStation_Portable", "Nintendo_-_Nintendo_Entertainment_System",
  "Nintendo_-_Super_Nintendo_Entertainment_System", "Nintendo_-_Nintendo_64", "Nintendo_-_Game_Boy", "Nintendo_-_Game_Boy_Color", "Nintendo_-_Game_Boy_Advance",
  "Nintendo_-_Nintendo_DS", "Nintendo_-_Virtual_Boy", "Sega_-_Mega_Drive_-_Genesis", "Sega_-_Master_System_-_Mark_III", "Sega_-_Game_Gear", "Sega_-_32X",
  "Sega_-_Mega-CD_-_Sega_CD", "Sega_-_Saturn", "NEC_-_PC_Engine_-_TurboGrafx_16", "NEC_-_PC_Engine_CD_-_TurboGrafx-CD", "NEC_-_PC_Engine_SuperGrafx", "NEC_-_PC-FX",
  "SNK_-_Neo_Geo_Pocket_Color", "SNK_-_Neo_Geo_Pocket", "Bandai_-_WonderSwan_Color", "Bandai_-_WonderSwan", "Atari_-_Lynx", "Atari_-_2600", "Atari_-_5200", "Atari_-_7800",
  "Atari_-_Jaguar", "The_3DO_Company_-_3DO", "Coleco_-_ColecoVision", "Commodore_-_Amiga", "Commodore_-_64", "Sinclair_-_ZX_Spectrum", "Amstrad_-_CPC", "FBNeo_-_Arcade_Games", "MAME", "Sega_-_Dreamcast"]);

const owner = new Map();
for (const [id, s] of Object.entries(SYSTEMS)) {
  assert.equal(s.id, id, `${id}: key and id agree`);
  assert.ok(s.name && s.family && s.engine && Array.isArray(s.thumbs), `${id}: complete`);
  for (const r of s.thumbs) assert.ok(REPOS.has(r), `${id}: unknown thumbnail repo ${r}`);
  for (const e of s.exts) {
    assert.ok(!owner.has(e), `.${e} claimed by both ${owner.get(e)} and ${id} — declare it in SHARED_EXTS instead`);
    assert.ok(!SHARED_EXTS[e], `.${e} is shared and cannot also be owned by ${id}`);
    owner.set(e, id);
  }
  if (s.bios) assert.ok((s.bios.files.length || s.bios.match) && s.bios.note, `${id}: BIOS spec needs files (or a match rule) and a note`);
}
for (const [e, ids] of Object.entries(SHARED_EXTS)) for (const id of ids) assert.ok(SYSTEMS[id], `.${e}: unknown system ${id}`);
assert.ok(ALL_EXTS().includes("iso") && ALL_EXTS().includes("sms") && ALL_EXTS().includes("img"));

// the picker has always behaved like this — keep it so
assert.deepEqual(classifyFile("game.gba"), { core: "gba" });
assert.deepEqual(classifyFile("Game.ISO"), { sys: "ps2", core: "ps2" }, ".iso with no context is PS2");
assert.deepEqual(classifyFile("game.iso", ["psp"]), { core: "psp" }, "from the PSP home .iso is PSP");
assert.deepEqual(classifyFile("game.chd", ["psx"]), { core: "psx" }, "from the PS1 home .chd is PS1");
assert.deepEqual(classifyFile("game.chd"), { sys: "ps2", core: "ps2" });
assert.deepEqual(classifyFile("game.pbp", ["psx"]), { core: "psx" });
assert.deepEqual(classifyFile("game.pbp"), { core: "psp" });
assert.deepEqual(classifyFile("game.bin"), { core: "segaMD" }, ".bin defaults to Mega Drive");
assert.deepEqual(classifyFile("track.img"), null, ".img only from the PS1 home");
assert.deepEqual(classifyFile("track.img", ["psx"]), { core: "psx" });
assert.deepEqual(classifyFile("win98.img", ["amiga", "c64", "zx", "cpc", "x86"]), { core: "x86" }, "a disk image on the Computers shelf boots the PC");
assert.deepEqual(classifyFile("win98.iso", ["amiga", "c64", "zx", "cpc", "x86"]), { core: "x86" }, ".iso on the Computers shelf is a PC CD");
assert.deepEqual(classifyFile("boot.ima"), { core: "x86" }, "a floppy image is unambiguous");
assert.deepEqual(classifyFile("what.zip"), null, "zip from the global picker is not a game — other apps own it");
assert.deepEqual(classifyFile("mslug.zip", ["arcade", "mame"]), { choose: ["arcade", "mame"] }, "the Arcade shelf asks which core, because the romset lineage decides");
assert.deepEqual(classifyFile("mslug.zip", ["arcade"]), { core: "arcade" });
assert.deepEqual(classifyFile("mslug.zip", ["segaMD"]), null, "zip on a non-arcade shelf is still not a game");
// the new shelves
assert.deepEqual(classifyFile("sonic.sms"), { core: "segaMS" });
assert.deepEqual(classifyFile("game.a26"), { core: "atari2600" });
assert.deepEqual(classifyFile("game.tzx"), { core: "zx" });
assert.deepEqual(classifyFile("game.cue", ["segaMD", "segaMS", "segaGG", "segaCD", "sega32x", "segaSaturn", "dreamcast"]), { choose: ["segaSaturn", "segaCD", "dreamcast"] }, "a Sega shelf must ask which disc system");
assert.deepEqual(classifyFile("game.gdi"), { core: "dreamcast" }, "a GDI is a Dreamcast disc");
assert.equal(SYSTEMS.dreamcast.data, "/ejs/", "Dreamcast's core is self-hosted");
assert.equal(biosStatus(SYSTEMS.dreamcast, ["dc_boot.bin"]).ok, false, "both Dreamcast dumps are required");
assert.deepEqual(classifyFile("game.cue", ["pce", "ngp", "ws"]), { core: "pce" }, "one disc system on the shelf — no question");
assert.deepEqual(classifyFile("game.bin", ["segaMD", "sega32x"]), { core: "segaMD" });
assert.deepEqual(classifyFile("game.gba", ["segaMD"]), { core: "gba" }, "an unambiguous file is itself wherever you add it");
assert.deepEqual(classifyFile("game.tap", ["zx", "c64", "amiga", "cpc"]), { choose: ["zx", "c64"] });

// BIOS bookkeeping
assert.deepEqual(biosStatus(SYSTEMS.segaCD, ["BIOS_CD_U.BIN"]), { have: ["bios_CD_U.bin"], missing: ["bios_CD_E.bin", "bios_CD_J.bin"], ok: false }, "case-insensitive, all required");
assert.equal(biosStatus(SYSTEMS["3do"], ["goldstar.bin"]).ok, true, "any one 3DO BIOS is enough");
assert.equal(biosStatus(SYSTEMS.segaSaturn, []).ok, true, "optional BIOS never blocks");
assert.equal(biosStatus(SYSTEMS.nes, []).ok, true);
assert.deepEqual(biosStatus(SYSTEMS.palm, []), { have: [], missing: ["any .rom"], ok: false }, "Palm needs some device ROM");
assert.deepEqual(biosStatus(SYSTEMS.palm, ["Palm_m515.ROM"]), { have: ["Palm_m515.ROM"], missing: [], ok: true }, "any .rom will do");
assert.deepEqual(classifyFile("game.prc", ["palm"]), { core: "palm" });
assert.deepEqual(classifyFile("watris.wasm"), null, ".wasm is a WASM-4 cart only from the fantasy shelf");
assert.deepEqual(classifyFile("watris.wasm", ["wasm4"]), { core: "wasm4" });
assert.deepEqual(classifyFile("Bounce.jar"), { core: "j2me" }, "a JAR is a Java ME game");
assert.ok(SYSTEMS.wasm4.engine === "frame" && SYSTEMS.wasm4.frame?.startsWith("/"), "wasm4: frame engine needs a player page");
assert.ok(SYSTEMS.j2me.engine === "tab" && SYSTEMS.j2me.tab?.startsWith("/"), "j2me: tab engine needs a player page");
assert.ok(systemsOf("sega").includes("segaSaturn") && !systemsOf("sega").includes("nes"));
console.log("systems registry ok");

// every firmware slot points the player at a legal how-to, never at a download
for (const d of Object.values(SYSTEMS)) if (d.bios) assert.match(d.bios.howTo ?? "", /^https:\/\//, `${d.id}: BIOS slot needs a howTo link`);
console.log("bios how-to ok");
