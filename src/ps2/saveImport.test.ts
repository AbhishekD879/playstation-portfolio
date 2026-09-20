// PS2 save containers. Part of `npm test`.
//
// The parsers themselves were verified against mymc+ on six real files from a
// save archive — one of each format — and produced byte-identical output. That
// check needs those files and cannot live here, so this covers the two things a
// fixture-based comparison does not:
//
//   1. the REFUSALS, which is where a save importer becomes a security problem:
//      every name in these containers is attacker-controlled and ends up as a
//      path on the filesystem.
//   2. the happy path on a container built here, so a regression in the .psu
//      reader fails in CI rather than on somebody's memory card.
import { strict as assert } from "node:assert";
import { parsePs2Save, describeSave } from "./saveImport.ts";

const DIRENT = 512;
const DF_FILE = 0x0010, DF_DIR = 0x0020, DF_EXISTS = 0x8000, DF_RWX = 0x0007;

/** Build a .psu by hand. Uncompressed and header-free, so it is the one format
 *  that can be constructed in a test without an encoder. */
function psu(dirName: string, files: { name: string; data: Uint8Array }[],
             opts: { dirMode?: number; fileMode?: number; truncate?: boolean } = {}): Uint8Array {
  const dirent = (mode: number, length: number, name: string) => {
    const b = new Uint8Array(DIRENT);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, mode, true);
    dv.setUint32(4, length, true);
    for (let i = 0; i < name.length; i++) b[64 + i] = name.charCodeAt(i);
    return b;
  };
  const dirMode = opts.dirMode ?? (DF_DIR | DF_EXISTS | DF_RWX);
  const fileMode = opts.fileMode ?? (DF_FILE | DF_EXISTS | DF_RWX);
  const parts: Uint8Array[] = [
    dirent(dirMode, files.length + 2, dirName),
    dirent(dirMode, 0, "."),
    dirent(dirMode, 0, ".."),
  ];
  for (const f of files) {
    parts.push(dirent(fileMode, f.data.length, f.name));
    const padded = new Uint8Array(Math.ceil(f.data.length / 1024) * 1024);
    padded.set(f.data);
    parts.push(padded);
  }
  let total = parts.reduce((n, p) => n + p.length, 0);
  if (opts.truncate) total -= 700;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { const room = Math.min(p.length, total - o); if (room <= 0) break; out.set(p.subarray(0, room), o); o += room; }
  return out;
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

// —— the happy path ————————————————————————————————————————————————————————
{
  const buf = psu("BASLUS-20787SD5", [
    { name: "icon.sys", data: bytes(964, 0xab) },
    { name: "BASLUS-20787SD5", data: bytes(2048, 0x5a) },
  ]);
  const got = await parsePs2Save(buf);
  assert.equal(got.format, "psu");
  assert.equal(got.dirName, "BASLUS-20787SD5", "the folder name is what the game looks for");
  assert.equal(got.files.length, 2);
  assert.deepEqual(got.files.map((f) => f.name), ["icon.sys", "BASLUS-20787SD5"]);
  assert.equal(got.files[0].data.length, 964, "size comes from the entry, not the padding");
  assert.equal(got.files[1].data.length, 2048);
  assert.ok(got.files[0].data.every((b) => b === 0xab), "and the bytes are the file's own");
  assert.match(describeSave(got), /BASLUS-20787SD5 · 2 files · PSU/);
}

// —— refusals: every name here is attacker-controlled ————————————————————————
{
  // A name that escapes the card directory is the whole reason this is checked.
  for (const bad of ["../../evil", "..", ".", "/etc/passwd", "a/b", "with\\slash"]) {
    await assert.rejects(
      () => parsePs2Save(psu("BASLUS-20787SD5", [{ name: bad, data: bytes(16, 1) }])),
      /unusable name/,
      `a file called ${JSON.stringify(bad)} must be refused, not written`,
    );
  }
}
{
  for (const bad of ["../../..", "..", "sub/dir"]) {
    await assert.rejects(
      () => parsePs2Save(psu(bad, [{ name: "icon.sys", data: bytes(16, 1) }])),
      /unusable name/,
      `a save folder called ${JSON.stringify(bad)} must be refused`,
    );
  }
}
{
  // A card holds files, not trees. A subdirectory entry is refused rather than
  // flattened, because flattening silently changes what the game reads.
  await assert.rejects(
    () => parsePs2Save(psu("BASLUS-20787SD5", [{ name: "sub", data: bytes(16, 1) }],
                           { fileMode: DF_DIR | DF_EXISTS | DF_RWX })),
    /subdirectory/,
  );
}

// —— malformed input fails loudly, never silently ————————————————————————————
{
  await assert.rejects(() => parsePs2Save(new Uint8Array(8)), /too small/);
  await assert.rejects(
    () => parsePs2Save(psu("BASLUS-20787SD5", [{ name: "big", data: bytes(4096, 7) }], { truncate: true })),
    /ends early|truncated/,
    "a cut-off download must not yield a half-written save",
  );
}
{
  // Not a save at all: no magic matches, so it falls through to .psu and that
  // rejects it on structure rather than producing nonsense.
  const junk = new Uint8Array(4096);
  junk.fill(0x41);
  await assert.rejects(() => parsePs2Save(junk), /not a \.psu|unusable name/);
}
{
  await assert.rejects(
    () => parsePs2Save(psu("BASLUS-20787SD5", [])),
    /no files/,
    "an empty save is refused — importing it would look like success and do nothing",
  );
}

// —— detection is by content, not by extension ————————————————————————————
{
  // These files get renamed constantly. A .psu named .max must still open.
  const buf = psu("BASLUS-20787SD5", [{ name: "icon.sys", data: bytes(32, 3) }]);
  assert.equal((await parsePs2Save(buf)).format, "psu");
}
{
  // A truthful magic wins over any name.
  const fake = new Uint8Array(4096);
  new TextEncoder().encodeInto("Ps2PowerSave", fake);
  await assert.rejects(() => parsePs2Save(fake), /.*/, "a MAX header with no body fails as MAX, not as psu");
}

console.log("saveImport: ok");
