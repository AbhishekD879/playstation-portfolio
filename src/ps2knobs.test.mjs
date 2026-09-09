// The override table comes from a KV blob someone edited by hand, and a bad
// value here disables the emulator silently — a wrong clock is a black screen
// with nothing in the log, which is exactly the bug this file exists to stop.
// So the sanitiser is the thing worth pinning down, and the XML has to match
// Play!'s schema exactly or it is ignored without complaint.
import assert from "node:assert/strict";
const {
  PS2_OVERRIDES, mergeOverrides, sanitiseOverride, buildGameConfigXml, elfNameFor, clockDen,
} = await import("./ps2knobs.ts");

// —— the id ↔ ELF name mapping GameConfig matches on ————————————————————————
assert.equal(elfNameFor("SLUS-21198"), "SLUS_211.98", "the disc spells it with an underscore and a dot");
assert.equal(elfNameFor("SLUS-21209"), "SLUS_212.09");
assert.equal(elfNameFor("SLES-54354"), "SLES_543.54");
assert.equal(elfNameFor("nonsense"), null);

// —— what we ship: evidence, not guesses ————————————————————————————————————
const urban = PS2_OVERRIDES["SLUS-21209"];
assert.equal(urban.clock, "full", "Urban Reign needs full clock — verified by hand");
assert.ok(urban.why && urban.why.length > 20, "every shipped override must say why");

// —— the sanitiser: valid input survives ————————————————————————————————————
const good = sanitiseOverride({ engine: "native", clock: "half", res: 2, players: 4, why: "because" });
assert.deepEqual(good, { why: "because", engine: "native", clock: "half", res: 2, players: 4 });

// —— the sanitiser: junk never reaches the emulator ————————————————————————
assert.equal(sanitiseOverride(null), null);
assert.equal(sanitiseOverride("nope"), null);
assert.equal(sanitiseOverride({}), null, "an empty override is not an override");
assert.equal(sanitiseOverride({ clock: "quarter" }), null, "an invented clock value is dropped");
assert.equal(sanitiseOverride({ res: 9 }), null, "resolution is 1, 2 or 3");
assert.equal(sanitiseOverride({ players: 99 }), null, "six pads is the ceiling");
assert.equal(sanitiseOverride({ players: 0 }), null);
assert.equal(sanitiseOverride({ engine: "turbo" }), null);
// a good field beside a bad one keeps the good one and drops the bad
assert.deepEqual(sanitiseOverride({ clock: "third", res: 77 }), { clock: "third" });

// —— merging remote over shipped ——————————————————————————————————————————
const merged = mergeOverrides(PS2_OVERRIDES, {
  "SLUS-21198": { clock: "half", why: "remote says so" },
  "bad-id": { clock: "full" },
  "SLUS-99999": { clock: "nope" },
});
assert.equal(merged["SLUS-21198"].clock, "half", "remote adds a title");
assert.equal(merged["SLUS-21209"].clock, "full", "shipped entries survive");
assert.equal(merged["bad-id"], undefined, "a malformed id is ignored");
assert.equal(merged["SLUS-99999"], undefined, "a title whose only field is junk is ignored");
assert.deepEqual(mergeOverrides(PS2_OVERRIDES, null), { ...PS2_OVERRIDES }, "no remote is not an error");
assert.deepEqual(mergeOverrides(PS2_OVERRIDES, "garbage"), { ...PS2_OVERRIDES });
// remote must not be able to blank a shipped entry by sending rubbish for it
const poisoned = mergeOverrides(PS2_OVERRIDES, { "SLUS-21209": { clock: "invalid" } });
assert.equal(poisoned["SLUS-21209"].clock, "full", "a bad remote row leaves the shipped one intact");

// —— knob validation: addresses are hex, block keys have a shape ————————————
const knobbed = sanitiseOverride({
  knobs: {
    idleLoop: [{ address: "1FC03000" }, { address: "zzz" }],
    fpRounding: [{ address: "100200", mode: "TRUNCATE" }, { address: "100300", mode: "SIDEWAYS" }],
    fpAccurateAddSub: ["200400", "not-hex"],
    vu1NoClamping: ["0000000100000002000000030000000f;3", "malformed"],
    patch: [{ address: "100000", value: "0000000C" }, { address: "1", value: "xyz" }],
  },
});
const k = knobbed.knobs;
assert.equal(k.idleLoop.length, 1, "non-hex address dropped");
assert.equal(k.fpRounding.length, 1, "invented rounding mode dropped");
assert.equal(k.fpAccurateAddSub.length, 1);
assert.equal(k.vu1NoClamping.length, 1, "a block key must be 4 words and a count");
assert.equal(k.patch.length, 1, "a patch needs a hex value too");

// —— the XML: matches Play!'s schema, or it is silently ignored ——————————————
assert.equal(buildGameConfigXml("SLUS_211.98", undefined), null, "no knobs means no file");
assert.equal(buildGameConfigXml("SLUS_211.98", {}), null);

const xml = buildGameConfigXml("SLUS_211.98", {
  idleLoop: [{ address: "1FC03000" }],
  fpRounding: [{ address: "100200", mode: "TRUNCATE" }],
  patch: [{ address: "100000", value: "0000000C" }],
  vu1NoClamping: ["0000000100000002000000030000000f;3"],
  fpAccurateAddSub: ["200400"],
});
assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(xml, /<GameConfigs>/);
assert.match(xml, /<GameConfig Executable="SLUS_211\.98">/, "matched on the ELF name, not the title id");
assert.match(xml, /<IdleLoopBlock Address="1FC03000" \/>/);
assert.match(xml, /<BlockFpRoundingMode Address="100200" Mode="TRUNCATE" \/>/);
assert.match(xml, /<BlockFpUseAccurateAddSub Address="200400" \/>/);
assert.match(xml, /<Patch Address="100000" Value="0000000C" \/>/);
assert.match(xml, /<Vu1BlockNoClamping BlockKey="0000000100000002000000030000000f;3" \/>/);
assert.match(xml, /<\/GameConfigs>\n$/);

// an optional CheckBlockKey appears only when supplied
const withKey = buildGameConfigXml("SLUS_211.98", {
  idleLoop: [{ address: "1FC03000", checkBlockKey: "0000000100000002000000030000000f;3" }],
});
assert.match(withKey, /CheckBlockKey="0000000100000002000000030000000f;3"/);

// XML injection through a hand-edited KV value must not break the document
const nasty = buildGameConfigXml('SLUS_211.98" bad="', { patch: [{ address: "1", value: "2" }] });
const attrLine = nasty.split("\n")[2];
// the injected quote must arrive as an entity, never as a real quote that would
// close Executable early and let an attacker add attributes of their own
assert.ok(!attrLine.includes('" bad="'), "an injected quote must not close the attribute");
assert.match(attrLine, /Executable="SLUS_211\.98&quot; bad=&quot;"/, "it survives escaped instead");

// —— clock denominators feed setEeFreqScale(1, den) ————————————————————————
assert.equal(clockDen("full"), 1);
assert.equal(clockDen("half"), 2);
assert.equal(clockDen("third"), 3);

console.log("ps2knobs ok ·", Object.keys(PS2_OVERRIDES).length, "shipped override(s)");
