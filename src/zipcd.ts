// Shared zip central-directory reader — used by the import worker AND the
// main-thread fallback (rpgm.ts). The importer never loads the archive into
// memory: the central directory (the index at the END of a zip) is
// authoritative — names, sizes, offsets — so each entry can be sliced straight
// off the on-disk File and streamed out one at a time. Inherently robust to
// data descriptors and odd layouts that trip sequential parsers. ZIP64 handled.
export interface ZipEntry { name: string; method: number; flag: number; compSize: number; uncompSize: number; lho: number }

// A zip WITHOUT the UTF-8 name flag holds filenames in a legacy encoding. RPG
// Maker games zipped on a Japanese/Chinese/Korean Windows carry Shift-JIS/GBK/
// EUC-KR filenames; decoding those bytes as latin1 (the old behaviour) mangled
// "主人公" → "¿ñk¬", so the engine's Unicode asset request 404'd and the game
// hung on boot. Try UTF-8 (some zippers omit the flag), then the common CJK
// codecs — strict, so a wrong codec throws instead of producing garbage — and
// only fall back to latin1 if nothing decodes cleanly.
const LEGACY_CODECS = ["utf-8", "shift_jis", "gbk", "euc-kr", "big5"];
export function decodeLegacyName(bytes: Uint8Array): string {
  for (const enc of LEGACY_CODECS) {
    try { const s = new TextDecoder(enc, { fatal: true }).decode(bytes); if (s && s.indexOf("�") < 0) return s; } catch { /* try next */ }
  }
  return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
}

export async function zipEntries(file: File): Promise<ZipEntry[]> {
  const U32 = (d: DataView, o: number) => d.getUint32(o, true);
  const U16 = (d: DataView, o: number) => d.getUint16(o, true);
  const U64 = (d: DataView, o: number) => Number(d.getBigUint64(o, true));
  // find the end-of-central-directory record (EOCD) in the file tail
  const tailLen = Math.min(file.size, 65557 + 20); // EOCD + max comment + zip64 locator
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) { if (U32(tail, i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("Couldn't read this zip — no end-of-archive record found (is it a complete, standard .zip?).");
  let count: number = U16(tail, eocd + 10);
  let cdSize: number = U32(tail, eocd + 12);
  let cdOff: number = U32(tail, eocd + 16);
  // ZIP64: a locator sits 20 bytes before the EOCD when any field overflowed
  if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocd >= 20 && U32(tail, eocd - 20) === 0x07064b50) {
    const z64Off = U64(tail, eocd - 20 + 8);
    const z = new DataView(await file.slice(z64Off, z64Off + 56).arrayBuffer());
    if (U32(z, 0) === 0x06064b50) { count = U64(z, 32); cdSize = U64(z, 40); cdOff = U64(z, 48); }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (U32(cd, p) !== 0x02014b50) break;
    const flag = U16(cd, p + 8), method = U16(cd, p + 10);
    let compSize: number = U32(cd, p + 20), uncompSize: number = U32(cd, p + 24), lho: number = U32(cd, p + 42);
    const nlen = U16(cd, p + 28), elen = U16(cd, p + 30), clen = U16(cd, p + 32);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen);
    const name = flag & 0x800 ? dec.decode(nameBytes) : decodeLegacyName(nameBytes);
    // per-entry ZIP64 extra field (id 0x0001) carries the overflowed values
    let ep = p + 46 + nlen;
    const eEnd = ep + elen;
    while (ep + 4 <= eEnd) {
      const eid = U16(cd, ep), esz = U16(cd, ep + 2);
      if (eid === 0x0001) {
        let fp = ep + 4;
        if (uncompSize === 0xffffffff) { uncompSize = U64(cd, fp); fp += 8; }
        if (compSize === 0xffffffff) { compSize = U64(cd, fp); fp += 8; }
        if (lho === 0xffffffff) { lho = U64(cd, fp); fp += 8; }
      }
      ep += 4 + esz;
    }
    out.push({ name, method, flag, compSize, uncompSize, lho });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Where an entry's compressed bytes start (its local header declares the
 *  actual name/extra lengths, which can differ from the central directory's). */
export async function entryDataStart(file: File, ent: ZipEntry): Promise<number> {
  const lh = new DataView(await file.slice(ent.lho, ent.lho + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error("Couldn't read this zip — a file entry is damaged. Re-zip the folder and try again.");
  return ent.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
}

/** Guard rails for an entry before extraction — clear, actionable errors. */
export function checkEntry(ent: ZipEntry): void {
  if (ent.flag & 1) throw new Error("This zip is password-protected — export it without a password and try again.");
  if (ent.method !== 0 && ent.method !== 8) throw new Error("Couldn't read this zip — it uses a compression method the browser can't unpack (only standard Zip/Deflate works). Re-create it as a plain .zip of the game folder and try again.");
}

// Desktop-runtime skipping — by EXACT LAYOUT, never by guessing names in game
// data (extension guessing broke real games twice: *.dat cutscene data, then
// anything matching a runtime name). A directory is the NW.js runtime only if
// it literally contains package.json beside Game.exe / nw.pak / icudtl.dat.
// Within THAT directory level only, native binaries and the Chromium resource
// files are skipped (they cannot run in a browser, and writing hundreds of MB
// of them is what pushed phone imports over the edge). Everything under the
// game's own folders (www/, data/, img/, movies/, …) is always kept.
const RUNTIME_ROOT_FILE = /^(icudtl\.dat|natives_blob\.bin|snapshot_blob\.bin|v8_context_snapshot\.bin|debug\.log|credits\.html|vk_swiftshader_icd\.json|(nw|chrome)[^/]*\.pak|resources\.pak|[^/]*\.(exe|dll))$/;
export function runtimeSkipper(paths: string[]): (p: string) => boolean {
  const lower = new Set(paths.map((p) => p.toLowerCase()));
  const dirs = new Set<string>([""]);
  for (const p of lower) {
    let d = "";
    for (const part of p.split("/").slice(0, -1)) { d += part + "/"; dirs.add(d); }
  }
  let root: string | null = null;
  for (const d of dirs) {
    const hasExeHere = [...lower].some((p) => p.startsWith(d) && !p.slice(d.length).includes("/") && p.endsWith(".exe"));
    if (lower.has(d + "package.json") && (lower.has(d + "icudtl.dat") || lower.has(d + "nw.pak") || hasExeHere)) { root = d; break; }
  }
  if (root === null) return () => false; // no desktop runtime in this zip
  const r = root;
  return (p: string) => {
    const lp = p.toLowerCase();
    if (!lp.startsWith(r)) return false;
    const rest = lp.slice(r.length);
    if (/^(locales|swiftshader)\//.test(rest)) return true; // runtime subtrees
    if (rest.includes("/")) return false;                    // game folders — never touched
    return RUNTIME_ROOT_FILE.test(rest);
  };
}

/** Audio files — music, ambience, sound effects (plain + RPG Maker encrypted
 *  variants). "Lite install" skips these: they're most of a game's bulk and
 *  none of its logic. The player stubs the engine's AudioManager for lite
 *  installs so the game never even asks for them. */
export const isAudioPath = (p: string): boolean =>
  /\.(ogg|mp3|m4a|wav|mid|midi|rpgmvo|ogg_|m4a_|wav_)$/i.test(p) || /(^|\/)(audio|music|sound)\//i.test(p);

/** Turn cryptic zip errors into something a person can act on. */
export function zipReadError(e: unknown): Error {
  const m = e instanceof Error ? e.message : String(e);
  if (/unknown compression|invalid zip|compression type|invalid (distance|length|block)/i.test(m)) {
    return new Error("Couldn't read this zip — it uses a compression method the browser can't unpack (only standard Zip/Deflate works). Re-create it as a plain .zip of the game folder (right-click → Compress, or `zip -r game.zip <folder>`) and try again.");
  }
  return e instanceof Error ? e : new Error(m);
}
