// The system registry: every platform the console can run, described once.
// Names, file extensions, BIOS files, device fit and cover-art repos all derive
// from here, so adding a system is one entry — not five edits in five files.
//
// Pure (no DOM, no signals): tested in node, and safe to import anywhere.
//
// `id` is the EmulatorJS EJS_core alias (or the raw libretro core name where
// 4.2.3 has no alias), and it is what a library record stores in `core`. PS2 is
// the exception — it boots Play!, not EmulatorJS — and keeps `sys: "ps2"`.

export type Family = "sony" | "nintendo" | "sega" | "consoles" | "computers" | "arcade";

/** Device fit, in the same vocabulary as labs.ts rateFeature(). */
export interface SystemFit {
  cpuHeavy?: boolean;                    // heavy wasm — midrange phones struggle
  desktop?: "recommended" | "required";
  threads?: boolean;                     // needs SharedArrayBuffer (no iOS)
  minMemGB?: number;
  disc?: boolean;                        // whole disc images in memory — laptop first on iOS
  note?: string;                         // one honest line for the shelf
}

export interface BiosSpec {
  files: string[];      // expected file names (case-insensitive match)
  required: boolean;    // false = works without, better with
  anyOf?: boolean;      // true = one of the files is enough (3DO)
  note: string;
}

export interface SystemDef {
  id: string;
  name: string;
  family: Family;
  engine: "ejs" | "play";
  ejsCore?: string;        // when EJS_core differs from id (fuse, cap32)
  thumbs: string[];        // libretro-thumbnails repos, most specific first
  exts: string[];          // extensions that mean this system and nothing else
  bios?: BiosSpec;
  fit?: SystemFit;
}

export const SYSTEMS: Record<string, SystemDef> = {
  // —— Sony ————————————————————————————————————————————————————————————————
  ps2: { id: "ps2", name: "PlayStation 2", family: "sony", engine: "play", thumbs: ["Sony_-_PlayStation_2"], exts: ["isz"],
    fit: { cpuHeavy: true, desktop: "required", threads: true, minMemGB: 8, disc: true } },
  psx: { id: "psx", name: "PlayStation", family: "sony", engine: "ejs", thumbs: ["Sony_-_PlayStation"], exts: ["cbn", "mdf"],
    bios: { files: ["scph5501.bin", "scph5500.bin", "scph5502.bin", "scph1001.bin"], required: false, note: "Works without one; a real BIOS fixes a few games" },
    fit: { cpuHeavy: true, minMemGB: 4, disc: true } },
  psp: { id: "psp", name: "PlayStation Portable", family: "sony", engine: "ejs", thumbs: ["Sony_-_PlayStation_Portable"], exts: ["prx"],
    fit: { cpuHeavy: true, threads: true, desktop: "recommended", minMemGB: 4, disc: true, note: "Needs threads — not on iPhone" } },

  // —— Nintendo ————————————————————————————————————————————————————————————
  nes: { id: "nes", name: "NES", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Nintendo_Entertainment_System"], exts: ["nes", "fds"] },
  snes: { id: "snes", name: "Super Nintendo", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Super_Nintendo_Entertainment_System"], exts: ["sfc", "smc"] },
  n64: { id: "n64", name: "Nintendo 64", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Nintendo_64"], exts: ["n64", "z64", "v64"],
    fit: { cpuHeavy: true, minMemGB: 4 } },
  gb: { id: "gb", name: "Game Boy / Color", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Game_Boy_Color", "Nintendo_-_Game_Boy"], exts: ["gb", "gbc"] },
  gba: { id: "gba", name: "Game Boy Advance", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Game_Boy_Advance"], exts: ["gba"],
    bios: { files: ["gba_bios.bin"], required: false, note: "Optional — only the boot logo needs it" } },
  nds: { id: "nds", name: "Nintendo DS", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Nintendo_DS"], exts: ["nds"],
    bios: { files: ["bios7.bin", "bios9.bin", "firmware.bin"], required: false, note: "Optional — the built-in firmware covers most games" },
    fit: { cpuHeavy: true, minMemGB: 4 } },
  vb: { id: "vb", name: "Virtual Boy", family: "nintendo", engine: "ejs", thumbs: ["Nintendo_-_Virtual_Boy"], exts: ["vb", "vboy"] },

  // —— Sega ————————————————————————————————————————————————————————————————
  segaMD: { id: "segaMD", name: "Mega Drive / Genesis", family: "sega", engine: "ejs", thumbs: ["Sega_-_Mega_Drive_-_Genesis"], exts: ["md", "gen", "smd"] },
  segaMS: { id: "segaMS", name: "Master System", family: "sega", engine: "ejs", thumbs: ["Sega_-_Master_System_-_Mark_III"], exts: ["sms"],
    bios: { files: ["bios.sms"], required: false, note: "Optional" } },
  segaGG: { id: "segaGG", name: "Game Gear", family: "sega", engine: "ejs", thumbs: ["Sega_-_Game_Gear"], exts: ["gg"] },
  sega32x: { id: "sega32x", name: "32X", family: "sega", engine: "ejs", thumbs: ["Sega_-_32X"], exts: ["32x"],
    fit: { note: "A few titles glitch in this core" } },
  segaCD: { id: "segaCD", name: "Sega CD / Mega-CD", family: "sega", engine: "ejs", thumbs: ["Sega_-_Mega-CD_-_Sega_CD"], exts: [],
    bios: { files: ["bios_CD_U.bin", "bios_CD_E.bin", "bios_CD_J.bin"], required: true, note: "Needs the console's BIOS for your game's region" },
    fit: { disc: true } },
  segaSaturn: { id: "segaSaturn", name: "Saturn", family: "sega", engine: "ejs", thumbs: ["Sega_-_Saturn"], exts: ["mds"],
    bios: { files: ["saturn_bios.bin"], required: false, note: "Recommended; required for multi-disc games" },
    fit: { cpuHeavy: true, desktop: "recommended", minMemGB: 4, disc: true, note: "3D games may stutter — a laptop does best" } },

  // —— more consoles ————————————————————————————————————————————————————————
  pce: { id: "pce", name: "PC Engine / TurboGrafx-16", family: "consoles", engine: "ejs", thumbs: ["NEC_-_PC_Engine_-_TurboGrafx_16", "NEC_-_PC_Engine_CD_-_TurboGrafx-CD", "NEC_-_PC_Engine_SuperGrafx"], exts: ["pce", "sgx"],
    bios: { files: ["syscard3.pce"], required: false, note: "CD games need the System Card; HuCards don't" } },
  pcfx: { id: "pcfx", name: "PC-FX", family: "consoles", engine: "ejs", thumbs: ["NEC_-_PC-FX"], exts: [],
    bios: { files: ["pcfx.rom"], required: true, note: "Needs the console's BIOS" }, fit: { cpuHeavy: true, disc: true } },
  ngp: { id: "ngp", name: "Neo Geo Pocket", family: "consoles", engine: "ejs", thumbs: ["SNK_-_Neo_Geo_Pocket_Color", "SNK_-_Neo_Geo_Pocket"], exts: ["ngp", "ngc"] },
  ws: { id: "ws", name: "WonderSwan", family: "consoles", engine: "ejs", thumbs: ["Bandai_-_WonderSwan_Color", "Bandai_-_WonderSwan"], exts: ["ws", "wsc", "pc2"] },
  lynx: { id: "lynx", name: "Atari Lynx", family: "consoles", engine: "ejs", thumbs: ["Atari_-_Lynx"], exts: ["lnx"],
    bios: { files: ["lynxboot.img"], required: true, note: "Needs the Lynx boot ROM" } },
  atari2600: { id: "atari2600", name: "Atari 2600", family: "consoles", engine: "ejs", thumbs: ["Atari_-_2600"], exts: ["a26"] },
  atari5200: { id: "atari5200", name: "Atari 5200", family: "consoles", engine: "ejs", thumbs: ["Atari_-_5200"], exts: ["a52"],
    bios: { files: ["5200.rom"], required: false, note: "Optional — a free replacement is built in" } },
  atari7800: { id: "atari7800", name: "Atari 7800", family: "consoles", engine: "ejs", thumbs: ["Atari_-_7800"], exts: ["a78"],
    bios: { files: ["7800 BIOS (U).rom"], required: false, note: "Optional" } },
  jaguar: { id: "jaguar", name: "Atari Jaguar", family: "consoles", engine: "ejs", thumbs: ["Atari_-_Jaguar"], exts: ["j64", "jag", "abs", "cof"],
    fit: { cpuHeavy: true, desktop: "recommended", note: "3D titles want a laptop" } },
  "3do": { id: "3do", name: "3DO", family: "consoles", engine: "ejs", thumbs: ["The_3DO_Company_-_3DO"], exts: [],
    bios: { files: ["panafz10.bin", "panafz1.bin", "goldstar.bin", "sanyotry.bin"], required: true, anyOf: true, note: "Needs one 3DO BIOS — any model" }, fit: { disc: true } },
  coleco: { id: "coleco", name: "ColecoVision", family: "consoles", engine: "ejs", thumbs: ["Coleco_-_ColecoVision"], exts: ["col"],
    bios: { files: ["colecovision.rom"], required: true, note: "Needs the console's BIOS" } },

  // —— arcade ——————————————————————————————————————————————————————————————
  // Every arcade ROM is a .zip and which core runs it depends on the romset's
  // version lineage, not its name — so the player picks the core when adding.
  arcade: { id: "arcade", name: "Arcade · FinalBurn Neo", family: "arcade", engine: "ejs", thumbs: ["FBNeo_-_Arcade_Games"], exts: [],
    bios: { files: ["neogeo.zip", "pgm.zip"], required: false, note: "Neo Geo games need neogeo.zip, PGM games pgm.zip; CPS1/CPS2 need nothing" },
    fit: { cpuHeavy: true, note: "Romsets must match FBNeo's version — use full non-merged sets. Select inserts a coin." } },
  mame: { id: "mame", name: "Arcade · MAME 2003-Plus", family: "arcade", engine: "ejs", thumbs: ["MAME"], exts: [],
    fit: { note: "MAME 0.78-era romsets (full non-merged need no BIOS). Select inserts a coin." } },

  // —— computers ———————————————————————————————————————————————————————————
  amiga: { id: "amiga", name: "Amiga", family: "computers", engine: "ejs", thumbs: ["Commodore_-_Amiga"], exts: ["adf", "adz", "dms", "hdf", "hdz", "lha"],
    bios: { files: ["kick34005.A500", "kick40068.A1200"], required: false, note: "Boots on the free AROS ROM; commercial games want a Kickstart" },
    fit: { note: "Mouse and keyboard game — the emulator menu has an on-screen keyboard" } },
  c64: { id: "c64", name: "Commodore 64", family: "computers", engine: "ejs", thumbs: ["Commodore_-_64"], exts: ["d64", "t64", "prg", "crt", "g64"],
    fit: { note: "Keyboard-first — the emulator menu has an on-screen keyboard" } },
  zx: { id: "zx", name: "ZX Spectrum", family: "computers", engine: "ejs", ejsCore: "fuse", thumbs: ["Sinclair_-_ZX_Spectrum"], exts: ["tzx", "z80", "sna", "szx"],
    fit: { note: "Keyboard-first — the emulator menu has an on-screen keyboard" } },
  cpc: { id: "cpc", name: "Amstrad CPC", family: "computers", engine: "ejs", ejsCore: "cap32", thumbs: ["Amstrad_-_CPC"], exts: ["dsk", "cdt"],
    fit: { note: "Keyboard-first — the emulator menu has an on-screen keyboard" } },
};

/** Extensions shared by several systems, legacy default first. Which one wins
 *  depends on the shelf you add from; from the global picker the default wins. */
export const SHARED_EXTS: Record<string, string[]> = {
  pbp: ["psp", "psx"],
  iso: ["ps2", "psp", "segaSaturn", "segaCD", "3do"],
  cso: ["ps2", "psp"],
  chd: ["ps2", "psx", "segaSaturn", "segaCD", "pce", "pcfx", "3do"],
  cue: ["psx", "segaSaturn", "segaCD", "pce", "pcfx", "3do", "jaguar"],
  ccd: ["psx", "segaSaturn", "pce", "pcfx"],
  toc: ["psx", "pcfx"],
  m3u: ["psx", "segaSaturn", "pce", "amiga"],
  bin: ["segaMD", "atari2600", "jaguar", "3do"],
  rom: ["jaguar", "coleco"],
  tap: ["zx", "c64"],
};
/** Formats that are only accepted when a shelf asks for them: .img was always
 *  PS1-home only, and .zip is claimed by other apps (RPG Maker, Unity, HTML5) so
 *  it is an arcade ROM only when added from the Arcade shelf. */
const CONTEXT_ONLY_EXTS: Record<string, string[]> = { img: ["psx"], zip: ["arcade", "mame"] };

export const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** Every extension the console can take — the file picker's accept list. */
export const ALL_EXTS = (): string[] => [
  ...new Set([...Object.values(SYSTEMS).flatMap((s) => s.exts), ...Object.keys(SHARED_EXTS), ...Object.keys(CONTEXT_ONLY_EXTS)]),
];

export type Classified = { sys?: "ps2"; core: string } | { choose: string[] } | null;
const asClass = (id: string): Classified => (id === "ps2" ? { sys: "ps2", core: "ps2" } : { core: id });

/** Which system a file is for. `candidates` is the shelf you are adding from:
 *  with one matching candidate the answer is immediate; with several it asks
 *  (`choose`); with none the legacy default applies (PS2 for .iso, Mega Drive
 *  for .bin) so the global picker keeps working exactly as it always did. */
export function classifyFile(name: string, candidates?: readonly string[]): Classified {
  const e = ext(name);
  const own = Object.values(SYSTEMS).find((s) => s.exts.includes(e));
  if (own) return asClass(own.id);
  const shared = SHARED_EXTS[e];
  if (shared) {
    if (!candidates?.length) return asClass(shared[0]);
    const hits = shared.filter((id) => candidates.includes(id));
    if (hits.length === 1) return asClass(hits[0]);
    if (hits.length > 1) return { choose: hits };
    return asClass(shared[0]);
  }
  const ctx = CONTEXT_ONLY_EXTS[e];
  if (ctx) {
    const hits = ctx.filter((id) => candidates?.includes(id));
    return hits.length > 1 ? { choose: hits } : hits.length ? asClass(hits[0]) : null;
  }
  return null;
}

/** BIOS bookkeeping: which expected files are present, and whether the system can boot. */
export function biosStatus(sys: SystemDef, present: readonly string[]): { have: string[]; missing: string[]; ok: boolean } {
  const spec = sys.bios;
  if (!spec) return { have: [], missing: [], ok: true };
  const lower = new Set(present.map((n) => n.toLowerCase()));
  const have = spec.files.filter((f) => lower.has(f.toLowerCase()));
  const missing = spec.files.filter((f) => !lower.has(f.toLowerCase()));
  const ok = !spec.required || (spec.anyOf ? have.length > 0 : missing.length === 0);
  return { have, missing, ok };
}

export const systemsOf = (family: Family): string[] => Object.values(SYSTEMS).filter((s) => s.family === family).map((s) => s.id);
