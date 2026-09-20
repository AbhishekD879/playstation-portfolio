// Reading the PS2 save files people actually have.
//
// A save downloaded from a save archive is never a plain folder. It is one of
// five container formats, each written by a different piece of 2000s hardware —
// a MAX Drive, a CodeBreaker, a SharkPort dongle — and the game cannot read any
// of them. What the emulator wants is the opposite: Play! keeps memory cards as
// a real directory tree (Iop_McServ.cpp walks it with fs::directory_iterator),
// so a save is just files in a folder named after the title, e.g.
// BASLUS-20787SD5 for the NA release of SmackDown! Here Comes the Pain.
//
// This turns any of the five into that folder.
//
//   .psu           EMS / uLaunchELF. No header, no compression: three dirents
//                  then the files. The format emulator users pass around.
//   .sps / .xps    SharkPort / X-Port. Length-prefixed text header, then 98-byte
//                  entry records. Uncompressed.
//   .max           MAX Drive. LZARI-compressed — see lzari.ts. The most common
//                  format in the wild by some margin.
//   .cbs           CodeBreaker. RC4 with a fixed permutation, then zlib.
//   .psv           PS3 "virtual save" export, as found inside the ZIPs.
//
// Ported from mymc+ (GPL-3.0). The layouts are transcribed from a working
// implementation rather than from prose, because every one of these formats has
// a field that is "usually" right and a reader that guesses will appear to work
// on the file it was tested against.

import { decodeLzari, MAX_DECODE_BYTES } from "./lzari.ts";

/** One file destined for the memory card. */
export interface SaveFile {
  name: string;
  data: Uint8Array;
}

export interface ParsedSave {
  /** The directory to create on the card, e.g. "BASLUS-20787SD5". This is what
   *  the game looks for, so a save whose name does not match the disc's region
   *  unpacks perfectly and is then simply not seen. */
  dirName: string;
  files: SaveFile[];
  /** Which container it came out of, for the UI to report. */
  format: "psu" | "sps" | "max" | "cbs" | "psv";
}

const DIRENT_LEN = 512;
const DF_FILE = 0x0010;
const DF_DIR = 0x0020;

const isDir = (mode: number) => (mode & DF_DIR) !== 0;
const isFile = (mode: number) => (mode & DF_FILE) !== 0;

/** PS2 names are fixed-width and NUL-padded. */
function zeroTerminated(b: Uint8Array): string {
  const end = b.indexOf(0);
  return new TextDecoder("latin1").decode(end === -1 ? b : b.subarray(0, end));
}

/** A name that will be created as a directory or file, so it must not be able
 *  to escape the card. PS2 names are short and plain; anything else is refused
 *  rather than sanitised, because a silently renamed save is one the game will
 *  not find and nobody will know why. */
const SAFE_NAME = /^[A-Za-z0-9._\- ]{1,32}$/;
function checkName(name: string, what: string): string {
  if (!SAFE_NAME.test(name) || name === "." || name === "..") {
    throw new Error(`${what} has an unusable name: ${JSON.stringify(name.slice(0, 40))}`);
  }
  return name;
}

const roundUp = (n: number, m: number) => Math.ceil(n / m) * m;

function need(buf: Uint8Array, off: number, len: number, what: string): void {
  if (off < 0 || len < 0 || off + len > buf.length) {
    throw new Error(`save file ends early while reading ${what}`);
  }
}

// —— EMS (.psu) ————————————————————————————————————————————————————————————
// Three dirents (the directory, "." and ".."), then for each entry a dirent
// followed by its data padded up to a 1024-byte cluster.

function parsePsu(buf: Uint8Array): ParsedSave {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dirent = (off: number) => {
    need(buf, off, DIRENT_LEN, "a directory entry");
    return {
      mode: dv.getUint16(off, true),
      length: dv.getUint32(off + 4, true),
      name: zeroTerminated(buf.subarray(off + 64, off + 64 + 32)),
    };
  };
  const root = dirent(0);
  const dot = dirent(DIRENT_LEN);
  const dotdot = dirent(DIRENT_LEN * 2);
  if (!isDir(root.mode) || !isDir(dot.mode) || !isDir(dotdot.mode) || root.length < 2) {
    throw new Error("not a .psu save file");
  }
  const count = root.length - 2;
  let off = DIRENT_LEN * 3;
  const files: SaveFile[] = [];
  for (let i = 0; i < count; i++) {
    const ent = dirent(off);
    off += DIRENT_LEN;
    if (!isFile(ent.mode)) throw new Error("this save contains a subdirectory, which a card cannot hold");
    need(buf, off, ent.length, `the contents of ${ent.name}`);
    files.push({ name: checkName(ent.name, "a file"), data: buf.slice(off, off + ent.length) });
    off += roundUp(ent.length, 1024);
  }
  return { dirName: checkName(root.name, "the save folder"), files, format: "psu" };
}

// —— SharkPort / X-Port (.sps, .xps) ——————————————————————————————————————

const SPS_MAGIC = "\x0d\0\0\0SharkPortSave";

function parseSps(buf: Uint8Array): ParsedSave {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 17; // magic
  off += 4;     // save type
  const lenString = (what: string): string => {
    need(buf, off, 4, what);
    const n = dv.getUint32(off, true);
    off += 4;
    need(buf, off, n, what);
    const s = new TextDecoder("latin1").decode(buf.subarray(off, off + n));
    off += n;
    return s;
  };
  lenString("the title");
  lenString("the datestamp");
  lenString("the comment");
  off += 4; // total data length

  // Entry header: hlen(2) name(64) size(4) pad(8) mode(2) pad(2) created(8) modified(8)
  const entry = (what: string) => {
    need(buf, off, 98, what);
    const hlen = dv.getUint16(off, true);
    if (hlen < 98) throw new Error("save file header is too short to be valid");
    const name = zeroTerminated(buf.subarray(off + 2, off + 2 + 64));
    const size = dv.getUint32(off + 66, true);
    const raw = dv.getUint16(off + 78, true);
    // mode is stored byte-swapped in this format
    const mode = ((raw >> 8) & 0xff) | ((raw & 0xff) << 8);
    off += hlen;
    return { name, size, mode };
  };

  const root = entry("the save folder");
  const count = root.size - 2;
  if (!isDir(root.mode) || count < 0) throw new Error("not a SharkPort/X-Port save file");

  const files: SaveFile[] = [];
  for (let i = 0; i < count; i++) {
    const ent = entry("a file entry");
    if (!isFile(ent.mode)) throw new Error("this save contains a subdirectory, which a card cannot hold");
    need(buf, off, ent.size, `the contents of ${ent.name}`);
    files.push({ name: checkName(ent.name, "a file"), data: buf.slice(off, off + ent.size) });
    off += ent.size;
  }
  // a 4-byte checksum follows; the reference ignores it and so do we
  return { dirName: checkName(root.name, "the save folder"), files, format: "sps" };
}

// —— MAX Drive (.max) ——————————————————————————————————————————————————————

const MAX_MAGIC = "Ps2PowerSave";

function parseMax(buf: Uint8Array): ParsedSave {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  need(buf, 0, 0x5c, "the MAX Drive header");
  const dirName = zeroTerminated(buf.subarray(16, 48));
  const clen = dv.getUint32(80, true);
  const dirLen = dv.getUint32(84, true);
  const length = dv.getUint32(88, true);

  if (length > MAX_DECODE_BYTES) throw new Error("this save claims to be larger than a memory card");

  // Some writers put the UNCOMPRESSED size in the compressed-length field, so
  // the body runs to the end of the file rather than for clen bytes.
  const body = clen === length ? buf.subarray(0x5c) : buf.subarray(0x5c, 0x5c + Math.max(0, clen - 4));
  const plain = decodeLzari(body, length);

  const pv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const files: SaveFile[] = [];
  let off = 0;
  for (let i = 0; i < dirLen; i++) {
    if (plain.length - off < 36) throw new Error("save data ends early");
    const size = pv.getUint32(off, true);
    const name = zeroTerminated(plain.subarray(off + 4, off + 36));
    off += 36;
    if (off + size > plain.length) throw new Error(`the contents of ${name} are truncated`);
    files.push({ name: checkName(name, "a file"), data: plain.slice(off, off + size) });
    off += size;
    off = roundUp(off + 8, 16) - 8;   // the format's own alignment rule
  }
  return { dirName: checkName(dirName, "the save folder"), files, format: "max" };
}

// —— CodeBreaker (.cbs) ————————————————————————————————————————————————————
// RC4 with a fixed permutation table, then a raw zlib stream. Both are things
// the browser can do — inflate natively, and RC4 in a dozen lines.

const CBS_RC4_S = Uint8Array.from([
  0x5f,0x1f,0x85,0x6f,0x31,0xaa,0x3b,0x18,0x21,0xb9,0xce,0x1c,0x07,0x4c,0x9c,0xb4,
  0x81,0xb8,0xef,0x98,0x59,0xae,0xf9,0x26,0xe3,0x80,0xa3,0x29,0x2d,0x73,0x51,0x62,
  0x7c,0x64,0x46,0xf4,0x34,0x1a,0xf6,0xe1,0xba,0x3a,0x0d,0x82,0x79,0x0a,0x5c,0x16,
  0x71,0x49,0x8e,0xac,0x8c,0x9f,0x35,0x19,0x45,0x94,0x3f,0x56,0x0c,0x91,0x00,0x0b,
  0xd7,0xb0,0xdd,0x39,0x66,0xa1,0x76,0x52,0x13,0x57,0xf3,0xbb,0x4e,0xe5,0xdc,0xf0,
  0x65,0x84,0xb2,0xd6,0xdf,0x15,0x3c,0x63,0x1d,0x89,0x14,0xbd,0xd2,0x36,0xfe,0xb1,
  0xca,0x8b,0xa4,0xc6,0x9e,0x67,0x47,0x37,0x42,0x6d,0x6a,0x03,0x92,0x70,0x05,0x7d,
  0x96,0x2f,0x40,0x90,0xc4,0xf1,0x3e,0x3d,0x01,0xf7,0x68,0x1e,0xc3,0xfc,0x72,0xb5,
  0x54,0xcf,0xe7,0x41,0xe4,0x4d,0x83,0x55,0x12,0x22,0x09,0x78,0xfa,0xde,0xa7,0x06,
  0x08,0x23,0xbf,0x0f,0xcc,0xc1,0x97,0x61,0xc5,0x4a,0xe6,0xa0,0x11,0xc2,0xea,0x74,
  0x02,0x87,0xd5,0xd1,0x9d,0xb7,0x7e,0x38,0x60,0x53,0x95,0x8d,0x25,0x77,0x10,0x5e,
  0x9b,0x7f,0xd8,0x6e,0xda,0xa2,0x2e,0x20,0x4f,0xcd,0x8f,0xcb,0xbe,0x5a,0xe0,0xed,
  0x2c,0x9a,0xd4,0xe2,0xaf,0xd0,0xa9,0xe8,0xad,0x7a,0xbc,0xa8,0xf2,0xee,0xeb,0xf5,
  0xa6,0x99,0x28,0x24,0x6c,0x2b,0x75,0x5d,0xf8,0xd3,0x86,0x17,0xfb,0xc0,0x7b,0xb3,
  0x58,0xdb,0xc7,0x4b,0xff,0x04,0x50,0xe9,0x88,0x69,0xc9,0x2a,0xab,0xfd,0x5b,0x1b,
  0x8a,0xd9,0xec,0x27,0x44,0x0e,0x33,0xc8,0x6b,0x93,0x32,0x48,0xb6,0x30,0x43,0xa5,
]);

function rc4(perm: Uint8Array, data: Uint8Array): Uint8Array {
  const s = perm.slice();
  const out = data.slice();
  let j = 0;
  for (let ii = 0; ii < out.length; ii++) {
    const i = (ii + 1) % 256;
    j = (j + s[i]) % 256;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[ii] ^= s[(s[i] + s[j]) % 256];
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" is zlib-wrapped, which is what CodeBreaker writes.
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function parseCbs(buf: Uint8Array): Promise<ParsedSave> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  need(buf, 0, 12, "the CodeBreaker header");
  const hlen = dv.getUint32(8, true);
  if (hlen < 92 + 32) throw new Error("CodeBreaker header is too short to be valid");
  need(buf, 12, hlen - 12, "the CodeBreaker header");
  const dlen = dv.getUint32(12, true);
  const flen = dv.getUint32(16, true);
  const dirName = zeroTerminated(buf.subarray(20, 52));
  if (dlen > MAX_DECODE_BYTES) throw new Error("this save claims to be larger than a memory card");

  const body = buf.subarray(hlen, Math.min(buf.length, hlen + flen));
  const plain = await inflate(rc4(CBS_RC4_S, body));

  const pv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const files: SaveFile[] = [];
  let off = 0;
  while (off < plain.length) {
    if (plain.length - off < 64) break;         // trailing padding, not an entry
    const size = pv.getUint32(off + 16, true);
    const mode = pv.getUint16(off + 20, true);
    const name = zeroTerminated(plain.subarray(off + 32, off + 64));
    off += 64;
    if (!name) break;
    if (!isFile(mode)) throw new Error("this save contains a subdirectory, which a card cannot hold");
    if (off + size > plain.length) throw new Error(`the contents of ${name} are truncated`);
    files.push({ name: checkName(name, "a file"), data: plain.slice(off, off + size) });
    off += size;
  }
  return { dirName: checkName(dirName, "the save folder"), files, format: "cbs" };
}

// —— PS3 virtual save (.psv) ——————————————————————————————————————————————
// What the PS3's save exporter wrote, and what sits inside the ZIPs on the save
// archives. Header, then a file-info record per entry with an absolute offset.

function parsePsv(buf: Uint8Array): ParsedSave {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  need(buf, 0, 0x64, "the PSV header");
  if (dv.getUint32(0x3c, true) !== 2) throw new Error("this PSV holds a PS1 save, not a PS2 one");

  // Header is magic(4) version(4) signature(40) pad(8) _(4) type(4) = 0x40, then
  // a 40-byte PS2 header whose last field is the file count, then the root
  // entry. Getting these four bytes wrong reads the count as an offset and the
  // root as a file, which fails loudly rather than producing a bad save.
  const fileCount = dv.getUint32(0x64, true);
  const info = (off: number) => ({
    size: dv.getUint32(off + 16, true),
    mode: dv.getUint32(off + 20, true),
    name: zeroTerminated(buf.subarray(off + 24, off + 24 + 32)),
  });

  let off = 0x68;
  need(buf, off, 56, "the PSV root entry");
  const root = info(off);
  off += 56;
  if (!isDir(root.mode)) throw new Error("the PSV root is not a directory");

  const files: SaveFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    need(buf, off, 60, "a PSV file entry");
    const ent = info(off);
    const at = dv.getUint32(off + 56, true);
    off += 60;
    if (isDir(ent.mode)) throw new Error("this save contains a subdirectory, which a card cannot hold");
    need(buf, at, ent.size, `the contents of ${ent.name}`);
    files.push({ name: checkName(ent.name, "a file"), data: buf.slice(at, at + ent.size) });
  }
  return { dirName: checkName(root.name, "the save folder"), files, format: "psv" };
}

// —— the front door ————————————————————————————————————————————————————————

const startsWith = (buf: Uint8Array, s: string) =>
  buf.length >= s.length && [...s].every((c, i) => buf[i] === c.charCodeAt(0));

/**
 * Read any supported PS2 save container.
 *
 * Detection is by content, not by extension: these files are routinely renamed,
 * and a .max that is really a .psu should still open. `.psu` has no magic
 * number at all, so it is the fallback and is validated by its own structure.
 */
export async function parsePs2Save(bytes: Uint8Array): Promise<ParsedSave> {
  if (bytes.length < 64) throw new Error("that file is too small to be a PS2 save");

  let parsed: ParsedSave;
  if (startsWith(bytes, MAX_MAGIC)) parsed = parseMax(bytes);
  else if (startsWith(bytes, SPS_MAGIC)) parsed = parseSps(bytes);
  else if (startsWith(bytes, "CFU\0")) parsed = await parseCbs(bytes);
  else if (startsWith(bytes, "\0VSP")) parsed = parsePsv(bytes);
  else parsed = parsePsu(bytes);

  if (!parsed.files.length) throw new Error("that save contains no files");
  return parsed;
}

/** What the user sees when a save is recognised. */
export const describeSave = (s: ParsedSave) =>
  `${s.dirName} · ${s.files.length} file${s.files.length === 1 ? "" : "s"} · ${s.format.toUpperCase()}`;
