// Ren'Py desktop → web conversion, pure half.
//
// A Ren'Py web build is two separable things: a prebuilt engine (index.wasm +
// CPython + Ren'Py's own Python, published per version at renpy.org/dl as
// renpy-<ver>-web.zip) and the game's own game/ tree. The engine's loader does
// nothing cleverer than:
//     zipfile.ZipFile('game.zip').extractall('.')
// so pairing a desktop build's game/ folder with the matching prebuilt engine
// produces a working web build without the Ren'Py SDK.
//
// The catch is that extractall lands in emscripten's IN-MEMORY filesystem, so
// everything inside game.zip costs RAM for the whole session. Ren'Py solves this
// with game/renpyweb_remote_files.txt: files listed there are fetched over HTTP
// on demand and unlinked after use (renpy/webloader.py). So the split below is
// the difference between a game that boots and one that dies on a phone.
//
// No imports on purpose — this file is unit-tested directly by node.

/** Engine version from a desktop build's renpy/__init__.py `version_tuple`. */
export function parseRenpyVersion(initPy: string): string | null {
  const m = initPy.match(/version_tuple\s*=\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Web packages exist per released version, and a game may sit on a patch that
 *  never got one. Try the exact version, then walk DOWN the same major.minor —
 *  never up, since a newer engine can refuse older bytecode. */
export function webZipCandidates(version: string, limit = 6): string[] {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return [];
  const [maj, min, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (maj < 7 || (maj === 7 && min < 4)) return [];   // web support starts at 7.4
  const out: string[] = [];
  for (let p = patch; p >= 0 && out.length < limit; p--) out.push(`${maj}.${min}.${p}`);
  return out;
}

const EXT = (p: string): string => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i + 1).toLowerCase();
};

// Script, data and font files are needed before anything renders, and are small.
const LOCAL_EXT = new Set(["rpyc", "rpy", "rpym", "rpymc", "py", "pyc", "json", "txt",
  "csv", "ini", "cfg", "yaml", "yml", "ttf", "otf", "ttc", "woff", "woff2", "rpa", "rpi"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"]);
const AUDIO_EXT = new Set(["ogg", "oga", "opus", "mp3", "wav", "m4a", "aac", "flac"]);
const VIDEO_EXT = new Set(["webm", "mp4", "ogv", "mkv", "avi", "mov"]);

/** Small files cost more as an HTTP round trip than as bytes in the zip. */
export const INLINE_MAX = 48 * 1024;

export type Placement =
  | { where: "zip" }
  | { where: "remote"; rtype: "image" | "music" | "voice" | "other" };

/** Decide whether a game/ file travels inside game.zip or is fetched on demand.
 *  `rel` is relative to game/. */
export function placeFile(rel: string, size: number): Placement {
  const ext = EXT(rel);
  if (LOCAL_EXT.has(ext)) return { where: "zip" };      // needed at startup
  if (size <= INLINE_MAX) return { where: "zip" };      // a round trip costs more
  if (IMAGE_EXT.has(ext)) return { where: "remote", rtype: "image" };
  if (AUDIO_EXT.has(ext)) {
    // webloader unlinks voice right after playback but keeps music for looping,
    // so telling them apart genuinely changes peak memory.
    const l = rel.toLowerCase();
    return { where: "remote", rtype: /(^|\/)(voice|voices|vo)\//.test(l) ? "voice" : "music" };
  }
  if (VIDEO_EXT.has(ext)) return { where: "remote", rtype: "other" };
  return { where: "remote", rtype: "other" };
}

export interface RemoteEntry { rel: string; rtype: string; size: number; w?: number; h?: number }

/** game/renpyweb_remote_files.txt — renpy/loader.py reads it as alternating
 *  lines: the path, then "<type> <size>". For images the size field is the
 *  pixel dimensions "W,H", because the engine draws a placeholder at the right
 *  size while the real file is still in flight. */
export function buildRemoteManifest(entries: RemoteEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    const size = e.rtype === "image" ? `${e.w ?? 0},${e.h ?? 0}` : String(e.size);
    lines.push(e.rel, `${e.rtype} ${size}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

/** Pixel dimensions from a file header, without decoding the image. Returns null
 *  when the format isn't recognised — the caller then keeps the file in the zip
 *  rather than emitting an image entry with a wrong placeholder size. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u32le = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

  if (b.length >= 24 && u32be(0) === 0x89504e47 && ascii(12, 4) === "IHDR")
    return { w: u32be(16), h: u32be(20) };

  if (b.length >= 10 && ascii(0, 4) === "GIF8")
    return { w: u16le(6), h: u16le(8) };

  if (b.length >= 26 && ascii(0, 2) === "BM")
    return { w: u32le(18), h: Math.abs(u32le(22) | 0) };

  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = u32le(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { w, h };
    }
  }

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // walk the segment chain to the frame header; SOF holds the dimensions
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(o + 2);
      if (len < 2) return null;
      const isSOF = (marker >= 0xc0 && marker <= 0xcf)
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;  // DHT/JPG/DAC aren't frames
      if (isSOF) return { h: u16be(o + 5), w: u16be(o + 7) };
      o += 2 + len;
    }
  }
  return null;
}

/** The dir holding game/ — a desktop zip usually nests everything one level
 *  down, and the service worker needs that prefix to find the pack entries. */
export function findGameRoot(paths: string[]): string | null {
  let best: string | null = null;
  for (const p of paths) {
    const m = p.match(/^((?:|.*\/))game\/[^/]/);
    if (!m) continue;
    if (best === null || m[1].length < best.length) best = m[1];
  }
  return best;
}

export interface SplitPlan {
  localBytes: number;    // ends up inside game.zip, and so in memory at runtime
  localFiles: number;
  remoteFiles: number;
  rpaBytes: number;
  videoBytes: number;
  biggestLocal: { rel: string; size: number } | null;
}

/** Budget for everything game.zip carries. The engine extracts it into
 *  emscripten's in-memory filesystem and never frees it, so this is a hard
 *  runtime ceiling, not a preference — and on a phone the tab is killed rather
 *  than told. Checked from the file LISTING, before a single byte is read, so an
 *  impossible game is refused with a message instead of crashing the import. */
export const LOCAL_BUDGET = 96 * 1024 * 1024;

/** What the split will look like, computed from sizes alone. Images are assumed
 *  remote here; a few may fall back to local when their header can't be parsed,
 *  which only ever moves the estimate down-ish, so the budget check stays sound
 *  for the thing it guards against — archives and script bulk. */
export function planSplit(files: { rel: string; size: number }[]): SplitPlan {
  const plan: SplitPlan = {
    localBytes: 0, localFiles: 0, remoteFiles: 0, rpaBytes: 0, videoBytes: 0, biggestLocal: null,
  };
  for (const f of files) {
    const p = placeFile(f.rel, f.size);
    if (p.where === "zip") {
      plan.localBytes += f.size;
      plan.localFiles++;
      if (/\.rpa$/i.test(f.rel)) plan.rpaBytes += f.size;
      if (!plan.biggestLocal || f.size > plan.biggestLocal.size) plan.biggestLocal = { rel: f.rel, size: f.size };
    } else {
      plan.remoteFiles++;
      if (/\.(webm|mp4|ogv|mkv|avi|mov)$/i.test(f.rel)) plan.videoBytes += f.size;
    }
  }
  return plan;
}

const mb = (n: number): string => `${Math.round(n / 1048576)} MB`;

/** Why this game can't be converted, or null when it can. */
export function budgetRefusal(plan: SplitPlan): string | null {
  if (plan.localBytes <= LOCAL_BUDGET) return null;
  if (plan.rpaBytes > LOCAL_BUDGET / 2) {
    return `This build keeps ${mb(plan.rpaBytes)} of its assets in .rpa archives. `
      + "An .rpa is a single blob, so it can't be fetched piece by piece — the web engine would have to "
      + `hold all of it in memory at once, and the browser would kill the tab. Total that must stay resident: ${mb(plan.localBytes)}, `
      + `and the safe limit is ${mb(LOCAL_BUDGET)}.`;
  }
  return `This build needs ${mb(plan.localBytes)} of scripts and data resident in memory `
    + `(safe limit ${mb(LOCAL_BUDGET)}), which the browser won't survive. `
    + (plan.biggestLocal ? `Largest single file: ${plan.biggestLocal.rel} at ${mb(plan.biggestLocal.size)}.` : "");
}
