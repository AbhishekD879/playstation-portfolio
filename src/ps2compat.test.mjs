// A disc says "SLUS_211.98" and the tracker says "SLUS-21198". If those two
// ever stop meeting in the middle, every lookup silently returns "unknown" and
// the sheet quietly becomes useless — so that normalisation is the thing worth
// pinning down. The three real discs below were verified by hand against the
// emulator: Urban Reign plays, Batman Begins stops at the intro.
import assert from "node:assert/strict";
const {
  normaliseTitleId, lookupCompat, searchCompat, compatCount, compatTally,
  readTitleId, inspectDisc, COMPAT_UI,
} = await import("./ps2compat.ts");

// —— the id shapes that actually occur ——————————————————————————————————————
assert.equal(normaliseTitleId("SLUS_211.98"), "SLUS-21198", "the spelling SYSTEM.CNF uses");
assert.equal(normaliseTitleId("SLUS-21198"), "SLUS-21198", "the spelling the tracker uses");
assert.equal(normaliseTitleId("slus_211.98"), "SLUS-21198", "case is not meaningful");
assert.equal(normaliseTitleId("cdrom0:\\SLUS_211.98;1"), "SLUS-21198", "straight off the boot line");
assert.equal(normaliseTitleId("SLUS 211 98"), "SLUS-21198", "spaces too");
assert.equal(normaliseTitleId("nonsense"), null, "not an id at all");
assert.equal(normaliseTitleId(""), null);

// —— the table itself ————————————————————————————————————————————————————————
assert.ok(compatCount() > 2000, `expected a few thousand titles, got ${compatCount()}`);
const tally = compatTally();
assert.ok(tally.playable > 1000, "most of the table should be playable titles");
assert.equal(
  tally.playable + tally.ingame + tally.loadable + tally.intro,
  compatCount(),
  "every row carries exactly one of the four states",
);

// —— the three discs I verified against the emulator by hand ————————————————
const urban = lookupCompat("SLUS-21209");
assert.equal(urban?.name, "Urban Reign");
assert.equal(urban?.state, "playable", "it ran fine at full clock");

const batman = lookupCompat("SLUS_211.98"); // deliberately the disc spelling
assert.equal(batman?.name, "Batman Begins");
assert.equal(batman?.state, "intro", "it never gets past the loading screen");

assert.equal(lookupCompat("SLUS-20226")?.state, "ingame", "Batman Vengeance");
assert.equal(lookupCompat("SLUS-99999"), null, "a title nobody has reported");

// —— search: the ranking is the point ————————————————————————————————————————
const bat = searchCompat("batman");
assert.ok(bat.total > 3, "there are several Batman games");
assert.ok(
  bat.rows[0].name.toLowerCase().startsWith("batman"),
  `a prefix match must come first, got "${bat.rows[0].name}"`,
);
assert.ok(
  bat.rows.some((g) => g.name === "Batman Begins"),
  "the game we were debugging is findable by name",
);

const byId = searchCompat("SLUS-21209");
assert.equal(byId.rows[0]?.name, "Urban Reign", "searchable by title id as well as name");

const capped = searchCompat("", 10);
assert.equal(capped.rows.length, 10, "the caller's cap is respected");
assert.equal(capped.total, compatCount(), "but the true total is still reported");
assert.equal(searchCompat("zzzznope").total, 0, "a miss is a clean zero");

// —— every state has player-facing copy ————————————————————————————————————
for (const s of ["playable", "ingame", "loadable", "intro"]) {
  const ui = COMPAT_UI[s];
  assert.ok(ui && ui.label && ui.blurb, `${s} needs a label and a blurb`);
  assert.ok(["ready", "caution", "no"].includes(ui.fit), `${s} must reuse an existing hz-fit level`);
}

// —— reading a disc: a synthetic ISO9660, built to the same layout ——————————
// Proves the parser walks PVD → root directory → SYSTEM.CNF rather than
// scanning for a string, which is what keeps a 4 GB disc down to three reads.
function fakeIso(bootLine) {
  const SECTOR = 2048;
  const sectors = 24;
  const buf = new Uint8Array(SECTOR * sectors);
  const put = (at, s) => { for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i); };
  const u32 = (at, v) => { buf[at] = v & 255; buf[at + 1] = (v >> 8) & 255; buf[at + 2] = (v >> 16) & 255; buf[at + 3] = (v >>> 24) & 255; };

  const pvd = 16 * SECTOR;
  put(pvd + 1, "CD001");
  const rootLba = 20, cnfLba = 22;
  u32(pvd + 156 + 2, rootLba);          // root directory extent
  u32(pvd + 156 + 10, 96);              // root directory length

  // one directory record naming SYSTEM.CNF
  const rec = rootLba * SECTOR;
  buf[rec] = 48;                        // record length
  u32(rec + 2, cnfLba);
  u32(rec + 10, bootLine.length);
  buf[rec + 32] = 12;                   // name length
  put(rec + 33, "SYSTEM.CNF;1");
  buf[rec + 48] = 0;                    // terminator

  put(cnfLba * SECTOR, bootLine);
  return new Blob([buf]);
}

const good = fakeIso("BOOT2 = cdrom0:\\SLUS_211.98;1\nVMODE = NTSC\n");
assert.equal(await readTitleId(good), "SLUS-21198", "walked the real ISO9660 structure");

const seen = await inspectDisc(good);
assert.equal(seen.id, "SLUS-21198");
assert.equal(seen.compat?.name, "Batman Begins", "an inserted disc resolves to its report");

// unknown game: we still identify the disc, we just have no advice
const unknown = await inspectDisc(fakeIso("BOOT2 = cdrom0:\\SLUS_999.99;1\n"));
assert.equal(unknown.id, "SLUS-99999");
assert.equal(unknown.compat, null, "identified but unreported is not an error");

// —— junk must never throw; a bad disc still gets to boot ————————————————————
assert.equal(await readTitleId(new Blob([new Uint8Array(64)])), null, "too small to be an ISO");
assert.equal(await readTitleId(new Blob([new Uint8Array(SECTOR_PAD())])), null, "no CD001 marker");
function SECTOR_PAD() { return new Uint8Array(2048 * 20); }
assert.equal(await readTitleId(fakeIso("nothing useful here")), null, "no BOOT2 line");

console.log("ps2compat ok ·", compatCount(), "titles ·",
  `${tally.playable} plays / ${tally.ingame} buggy / ${tally.loadable + tally.intro} won't`);
