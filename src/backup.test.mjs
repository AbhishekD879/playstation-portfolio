// A backup must round-trip byte-for-byte, must refuse a stranger's zip with a
// sentence rather than half-restoring it, and must never carry binary as
// base64 — the whole point of the format is that a 2 GB library stays 2 GB.
import assert from "node:assert/strict";
const {
  packBackup, unpackBackup, isBackupFile, backupName, humanSize,
  binPath, isBinRef, describeBackup, BACKUP_VERSION, MAX_IN_MEMORY,
} = await import("./backup.ts");

// —— round trip ————————————————————————————————————————————————————————————
const rom = new Uint8Array(4096).map((_, i) => (i * 31) % 256); // stands in for a save state
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const manifest = {
  version: BACKUP_VERSION,
  at: Date.UTC(2026, 8, 6),
  scope: "all",
  from: "https://abhishekstation.pages.dev",
  local: { "asp.theme": "wave", "asp.profiles.v1": '[{"id":"p1"}]' },
  dbs: [{
    name: "asp-games",
    version: 4,
    stores: [{
      name: "saves",
      keyPath: "key",
      autoIncrement: false,
      indexes: [
        { name: "gameId", keyPath: "gameId", unique: false, multiEntry: false },
        { name: "profileId", keyPath: "profileId", unique: false, multiEntry: false },
      ],
      rows: [{ v: { key: "g1:manual", gameId: "g1", at: 5, data: { $bin: binPath(0), kind: "blob", type: "application/octet-stream" }, shot: { $bin: binPath(1), kind: "blob", type: "image/png" } } }],
    }, {
      name: "keyless",
      keyPath: null,
      autoIncrement: false,
      indexes: [],
      rows: [{ k: "outside", v: { note: "key stored beside the value" } }],
    }],
  }],
};

const packed = packBackup(manifest, { [binPath(0)]: rom, [binPath(1)]: png });
assert.ok(packed.bytes.length > 0, "produced a file");
assert.ok(isBackupFile(packed.name), `${packed.name} should be recognised as a backup`);

const back = unpackBackup(packed.bytes);
assert.deepEqual(back.manifest, manifest, "manifest survives verbatim");
assert.deepEqual(back.files[binPath(0)], rom, "state bytes are byte-for-byte");
assert.deepEqual(back.files[binPath(1)], png, "screenshot bytes are byte-for-byte");
assert.equal(back.manifest.local["asp.profiles.v1"], '[{"id":"p1"}]', "profiles come back, not just settings");

// the keyless row must keep its out-of-line key, or restoring it silently drops data
assert.equal(back.manifest.dbs[0].stores[1].rows[0].k, "outside", "out-of-line key is preserved");

// indexes must survive: a store rebuilt without them throws NotFoundError on
// the first query instead of at restore time, which reads as "my library vanished"
assert.deepEqual(
  back.manifest.dbs[0].stores[0].indexes.map((i) => i.name),
  ["gameId", "profileId"],
  "index definitions are carried, not just the rows",
);

// —— binary is NOT base64 ——————————————————————————————————————————————————
// A base64 manifest would inflate by ~33%; entries keep it at parity. Guarding
// this because reverting to base64 would still pass every round-trip test above.
const big = new Uint8Array(200_000).fill(7);
const lean = packBackup({ ...manifest, dbs: [] }, { [binPath(0)]: big });
assert.ok(lean.bytes.length < big.length * 1.1,
  `stored bytes should sit near payload size, got ${lean.bytes.length} for ${big.length}`);

// —— refusing junk ——————————————————————————————————————————————————————————
assert.throws(() => unpackBackup(new Uint8Array([1, 2, 3, 4])), /not a readable backup/, "random bytes are rejected");

const { zipSync, strToU8 } = await import("fflate");
assert.throws(() => unpackBackup(zipSync({ "hello.txt": strToU8("hi") })), /not an AbhishekStation backup/,
  "a zip without our manifest is rejected, not partly applied");
assert.throws(() => unpackBackup(zipSync({ "manifest.json": strToU8("{{{") })), /corrupt/, "unparseable manifest is rejected");
assert.throws(() => unpackBackup(zipSync({ "manifest.json": strToU8('{"dbs":"nope"}') })), /corrupt/, "wrong-shaped manifest is rejected");
assert.throws(
  () => unpackBackup(packBackup({ ...manifest, version: BACKUP_VERSION + 5 }, {}).bytes),
  /version/,
  "a backup from a newer console says so instead of importing badly",
);

// a manifest with no local block must not crash the caller
const noLocal = unpackBackup(zipSync({ "manifest.json": strToU8('{"version":1,"at":0,"scope":"saves","dbs":[]}') }));
assert.deepEqual(noLocal.manifest.local, {}, "missing local block defaults to empty");

// —— the small stuff the UI depends on ————————————————————————————————————
assert.equal(isBinRef({ $bin: "bin/x", kind: "blob" }), true);
assert.equal(isBinRef({ data: "x" }), false, "a plain row value is not a binary pointer");
assert.equal(isBinRef(null), false);

assert.match(backupName(Date.UTC(2026, 0, 9)), /2026-01-09\.aspbackup$/, "date is zero-padded and sortable");
assert.equal(isBackupFile("holiday.ASPBACKUP"), true, "extension check is case-insensitive");
assert.equal(isBackupFile("game.aspsave"), false, "a per-game save is not a whole-console backup");

assert.equal(humanSize(0), "0 B");
assert.equal(humanSize(999), "999 B");
assert.equal(humanSize(1024), "1.0 KB");
assert.equal(humanSize(1536), "1.5 KB");
assert.equal(humanSize(20 * 1024 * 1024), "20 MB", "double digits drop the decimal");
assert.equal(humanSize(3 * 1024 ** 3), "3.0 GB");
assert.ok(MAX_IN_MEMORY < 2 * 1024 ** 3, "the in-memory cap must stay under the ArrayBuffer ceiling");

const d = describeBackup(manifest);
assert.equal(d.dbs, 1);
assert.equal(d.rows, 2, "counts rows across every store, so the confirm step is honest");
assert.equal(d.keys, 2);
assert.equal(d.scope, "all");

console.log("backup.test.mjs ok");
