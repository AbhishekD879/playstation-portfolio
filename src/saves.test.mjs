// "Continue" must offer the newest snapshot and never an SRAM file; the label
// must read like a console, not a timestamp.
import assert from "node:assert/strict";
const { pickResume, ago, saveKey, packSaves, unpackSaves, isSaveFile } = await import("./saves.ts");

const rec = (slot, at) => ({ key: saveKey("g1", slot), gameId: "g1", profileId: "p", slot, at, data: null });
assert.equal(pickResume([]), undefined, "nothing saved → no Continue");
assert.equal(pickResume([rec("sram", 50)]), undefined, "an in-game save alone is not a snapshot to resume");
assert.equal(pickResume([rec("manual", 20), rec("sram", 99)]).at, 20, "the player's own snapshot, never the SRAM file");
assert.equal(saveKey("g1", "manual"), "g1:manual");

const now = 1_000_000_000_000;
assert.equal(ago(now - 5_000, now), "just now");
assert.equal(ago(now - 4 * 60_000, now), "4 min ago");
assert.equal(ago(now - 3 * 3_600_000, now), "3 h ago");
assert.equal(ago(now - 26 * 3_600_000, now), "yesterday");
assert.equal(ago(now - 12 * 86_400_000, now), "12 days ago");

// export/import round trip: bytes, slots and timestamps survive; strangers are ignored
const packed = packSaves("Nova the Squirrel.nes", [
  { slot: "manual", at: 1700000000000, data: new Uint8Array([1, 2, 3]), shot: new Uint8Array([137, 80, 78, 71]) },
  { slot: "sram", at: 1700000001000, data: new Uint8Array(64).fill(255) },
]);
assert.equal(packed.name, "Nova the Squirrel.aspsave");
const back = unpackSaves(packed.bytes);
assert.deepEqual(back.map((s) => [s.slot, s.at, s.data.length, s.shot?.length ?? 0]), [["manual", 1700000000000, 3, 4], ["sram", 1700000001000, 64, 0]]);
assert.deepEqual([...back[0].data], [1, 2, 3]);
assert.ok(isSaveFile("x.aspsave") && isSaveFile("Y.ASPSAVE") && !isSaveFile("x.zip"));
console.log("saves ok");
