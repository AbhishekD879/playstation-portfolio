// Game-zip import WORKER. Two modes:
//
//  · PACKED (default, modern browsers): the game is NOT exploded into
//    thousands of OPFS files — every file creation on a struggling phone is a
//    chance to die ("failed to truncate…"). Instead ONE compact zip
//    (.rpgmpack) is written with purely sequential appends — the gentlest
//    write pattern there is — and files stay COMPRESSED inside it. At play
//    time the service worker lazily inflates each file on demand with the
//    browser's native streaming DecompressionStream. Install footprint ≈ the
//    compressed size, not the unpacked size.
//  · EXTRACTED (fallback): the old behaviour — loose tree in OPFS — for
//    browsers without sync access handles / DecompressionStream.
//
// Lite install applies in both modes: audio skipped; plain PNGs transcoded to
// WebP (same filename — browsers decode by content). Media that the source
// zip deflated is re-STORED in the pack so <video> Range requests can be
// served by offset math.
import { Inflate, deflateSync } from "fflate";
import { checkEntry, entryDataStart, isAudioPath, runtimeSkipper, zipEntries, type ZipEntry } from "./zipcd";
import libarchiveWasmUrl from "libarchive-wasm/dist/libarchive.wasm?url";

interface Job { file: File; id: string; skipAudio?: boolean; compressImages?: boolean; failAfter?: number }
// resume sidecar (.rpgmprog): everything needed to continue a torn install
interface Prog {
  srcSize: number; skipAudio: boolean; compressImages: boolean;
  total: number; nextIndex: number; packOff: number; fmt?: string;
  cd: { n: string; m: number; c: number; u: number; l: number }[];
}

// which archive format — zip is read lazily off disk (central directory);
// rar/7z go through libarchive-wasm (whole archive in memory). Magic bytes,
// with an extension fallback.
async function archiveKind(file: File): Promise<"zip" | "rar" | "7z"> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const m = (a: number[]) => a.every((v, i) => b[i] === v);
  if (m([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (m([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar";
  if (b[0] === 0x50 && b[1] === 0x4b) return "zip";
  const n = (file.name || "").toLowerCase();
  if (n.endsWith(".7z")) return "7z";
  if (n.endsWith(".rar")) return "rar";
  return "zip";
}
// minimal local typings — lib.dom doesn't carry the worker-only OPFS sync API
interface SyncHandle { write(b: Uint8Array, opts?: { at?: number }): number; truncate(n: number): void; flush(): void; close(): void }

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A sync-access-handle write() may write FEWER bytes than asked — loop until
 *  the whole buffer lands, or a stalled (0-byte) write throws. Returns length. */
function wsafe(h: SyncHandle, buf: Uint8Array, at: number): number {
  let w = 0;
  while (w < buf.length) {
    const n = h.write(w === 0 ? buf : buf.subarray(w), { at: at + w });
    if (!(n > 0)) throw new Error("sync write returned 0 (storage pressure)");
    w += n;
  }
  return buf.length;
}

async function dirFor(root: FileSystemDirectoryHandle, path: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop()!;
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  return { dir, name };
}

async function openSync(dir: FileSystemDirectoryHandle, name: string): Promise<SyncHandle> {
  const fh = await dir.getFileHandle(name, { create: true });
  return (fh as unknown as { createSyncAccessHandle: () => Promise<SyncHandle> }).createSyncAccessHandle();
}

/** Inflate a whole (small) entry into memory — used for image transcoding. */
async function inflateWhole(file: File, ent: ZipEntry): Promise<Uint8Array> {
  const dataStart = await entryDataStart(file, ent);
  const raw = new Uint8Array(await file.slice(dataStart, dataStart + ent.compSize).arrayBuffer());
  if (ent.method === 0) return raw;
  const chunks: Uint8Array[] = [];
  const inf = new Inflate();
  inf.ondata = (c) => { if (c?.length) chunks.push(c.slice()); };
  inf.push(raw, true);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Lossy-recompress a PNG to WebP (same name, same dimensions — browsers
 *  decode by content, not extension, so the engine never notices). Falls back
 *  to the original bytes on any failure, unsupported codec (Safari), or when
 *  WebP isn't actually smaller. Typical win on RPG Maker art: 50-90%. */
async function maybeTranscodePng(data: Uint8Array): Promise<Uint8Array> {
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return data;
    const bmp = await createImageBitmap(new Blob([data as unknown as BlobPart]));
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext("2d");
    if (!g) { bmp.close(); return data; }
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await cv.convertToBlob({ type: "image/webp", quality: 0.75 });
    if (blob.type !== "image/webp" || blob.size >= data.length) return data;
    return new Uint8Array(await blob.arrayBuffer());
  } catch { return data; }
}

// transcode candidates: plain .png only. NOT the encrypted variants
// (.rpgmvp/.png_ — no key), NOT effects/ textures (effekseer's WASM decodes
// PNG bytes itself), NOT gifs (animation), NOT huge files.
const canTranscode = (name: string, ent: ZipEntry): boolean =>
  /\.png$/i.test(name) && !/(^|\/)effects\//i.test(name) && ent.uncompSize > 0 && ent.uncompSize < 30 * 1048576;

// media kept deflated couldn't serve Range requests from the pack — re-store
const isMedia = (name: string) => /\.(webm|mp4|ogv|avi|ogg|mp3|m4a|wav)$/i.test(name);

// —— pack writer: a standard zip our own readers consume ——————————————————————
const enc = new TextEncoder();
function le(bytes: number, v: number): Uint8Array {
  const b = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (v / 2 ** (8 * i)) & 0xff;
  return b;
}
interface CdRec { nameB: Uint8Array; method: number; csize: number; usize: number; lho: number }

class PackWriter {
  h!: SyncHandle;
  off = 0;
  cd: CdRec[] = [];

  /** open fresh, or CONTINUE a partial pack at a recorded offset with the
   *  central-directory records collected so far (resumable installs) */
  async open(gameDir: FileSystemDirectoryHandle, at = 0, cd: CdRec[] = []) {
    this.h = await openSync(gameDir, ".rpgmpack");
    this.h.truncate(at);
    this.off = at;
    this.cd = cd;
  }
  flush() { this.h.flush(); }
  cdJson(): Prog["cd"] {
    const dec = new TextDecoder();
    return this.cd.map((r) => ({ n: dec.decode(r.nameB), m: r.method, c: r.csize, u: r.usize, l: r.lho }));
  }
  private put(...parts: Uint8Array[]) { for (const p of parts) { this.off += wsafe(this.h, p, this.off); } }

  /** zip64 extra for a local/central header when any value overflows 32 bits */
  private static extra(usize: number, csize: number, lho?: number): Uint8Array {
    const fields: Uint8Array[] = [];
    if (usize >= 0xffffffff) fields.push(le(8, usize));
    if (csize >= 0xffffffff) fields.push(le(8, csize));
    if (lho !== undefined && lho >= 0xffffffff) fields.push(le(8, lho));
    if (!fields.length) return new Uint8Array(0);
    const body = new Uint8Array(fields.reduce((s, f) => s + f.length, 0));
    let o = 0; for (const f of fields) { body.set(f, o); o += f.length; }
    const out = new Uint8Array(4 + body.length);
    out.set(le(2, 1), 0); out.set(le(2, body.length), 2); out.set(body, 4);
    return out;
  }
  private cap = (v: number) => (v >= 0xffffffff ? 0xffffffff : v);

  /** begin an entry whose sizes are known up front; then stream data chunks */
  begin(name: string, method: number, csize: number, usize: number): number {
    const lho = this.off;
    const nameB = enc.encode(name);
    const extra = PackWriter.extra(usize, csize);
    this.put(
      le(4, 0x04034b50), le(2, 45), le(2, 0x800), le(2, method), le(4, 0), le(4, 0),
      le(4, this.cap(csize)), le(4, this.cap(usize)), le(2, nameB.length), le(2, extra.length),
      nameB, extra,
    );
    this.cd.push({ nameB, method, csize, usize, lho });
    return lho;
  }
  chunk(c: Uint8Array) { this.put(c); }
  /** abort a partially-written entry (retry path): rewind to its start */
  rewindTo(lho: number) {
    if (this.off === lho) return; // nothing of this entry was written yet
    this.cd.pop();
    this.h.truncate(lho);
    this.off = lho;
  }

  finish() {
    const cdOff = this.off;
    for (const r of this.cd) {
      const extra = PackWriter.extra(r.usize, r.csize, r.lho);
      this.put(
        le(4, 0x02014b50), le(2, 45), le(2, 45), le(2, 0x800), le(2, r.method), le(4, 0), le(4, 0),
        le(4, this.cap(r.csize)), le(4, this.cap(r.usize)), le(2, r.nameB.length), le(2, extra.length),
        le(2, 0), le(2, 0), le(2, 0), le(4, 0), le(4, this.cap(r.lho)),
        r.nameB, extra,
      );
    }
    const cdSize = this.off - cdOff;
    const n = this.cd.length;
    if (n > 0xfffe || cdOff >= 0xffffffff || cdSize >= 0xffffffff) {
      const z64 = this.off;
      this.put( // zip64 EOCD
        le(4, 0x06064b50), le(8, 44), le(2, 45), le(2, 45), le(4, 0), le(4, 0),
        le(8, n), le(8, n), le(8, cdSize), le(8, cdOff),
      );
      this.put(le(4, 0x07064b50), le(4, 0), le(8, z64), le(4, 1)); // locator
      this.put( // EOCD with overflowed fields
        le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, Math.min(n, 0xffff)), le(2, Math.min(n, 0xffff)),
        le(4, this.cap(cdSize)), le(4, this.cap(cdOff)), le(2, 0),
      );
    } else {
      this.put(le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, n), le(2, n), le(4, cdSize), le(4, cdOff), le(2, 0));
    }
    this.h.flush();
    this.h.close();
    return this.off;
  }
}

// —— extracted mode (fallback) ————————————————————————————————————————————————
async function extractEntry(gameDir: FileSystemDirectoryHandle, file: File, ent: ZipEntry): Promise<number> {
  const dataStart = await entryDataStart(file, ent);
  const { dir, name } = await dirFor(gameDir, ent.name);
  const h = await openSync(dir, name);
  try {
    h.truncate(0);
    let at = 0;
    const reader = (file.slice(dataStart, dataStart + ent.compSize).stream() as ReadableStream<Uint8Array>).getReader();
    if (ent.method === 0) {
      for (;;) {
        const { done, value } = await reader.read();
        if (value?.length) at += wsafe(h, value, at);
        if (done) break;
      }
    } else {
      const q: Uint8Array[] = [];
      const inf = new Inflate();
      inf.ondata = (chunk) => { if (chunk?.length) q.push(chunk.slice()); };
      for (;;) {
        const { done, value } = await reader.read();
        if (value?.length) inf.push(value, false);
        if (done) inf.push(new Uint8Array(0), true);
        while (q.length) at += wsafe(h, q.shift()!, at);
        if (done) break;
      }
    }
    h.flush();
    return at;
  } finally {
    try { h.close(); } catch { /* already closed */ }
  }
}

async function writeWhole(gameDir: FileSystemDirectoryHandle, path: string, data: Uint8Array): Promise<number> {
  const { dir, name } = await dirFor(gameDir, path);
  const h = await openSync(dir, name);
  try {
    h.truncate(0);
    for (let o = 0; o < data.length; o += 4194304) wsafe(h, data.subarray(o, Math.min(o + 4194304, data.length)), o);
    h.flush();
    return data.length;
  } finally {
    try { h.close(); } catch { /* already closed */ }
  }
}

const TRANSIENT = /transient|out of memory|UnknownError|NoModificationAllowed|InvalidState|truncate|NotReadable/i;
const isImg = (n: string) => /\.png$/i.test(n) && !/(^|\/)effects\//i.test(n);

// —— RAR / 7z via libarchive-wasm ————————————————————————————————————————————
// These formats can't be lazily disk-sliced like zip — libarchive needs the
// whole archive in memory, and each entry decompresses whole. So peak memory
// is ~archive size + the largest entry: fine for reasonable games, tight for
// multi-GB ones on a phone. Entries are re-deflated (or media/images stored/
// transcoded) into the SAME .rpgmpack, so play-time serving + resume are
// identical to zip. Resumable: re-open, skip to the recorded file index.
async function extractViaLibarchive(file: File, id: string, skipAudio: boolean, compressImages: boolean): Promise<void> {
  let ctx = "", curIndex = 0;
  let pw: PackWriter | null = null;
  let gameDir: FileSystemDirectoryHandle | null = null;
  const names: string[] = [];
  const snap = (nextIndex: number): Prog => ({ srcSize: file.size, skipAudio, compressImages, total: names.length, nextIndex, packOff: pw!.off, cd: pw!.cdJson(), fmt: "libarchive" });
  try {
    const root = await navigator.storage.getDirectory();
    gameDir = await (await root.getDirectoryHandle("rpgm", { create: true })).getDirectoryHandle(id, { create: true });
    // resume from a matching checkpoint
    const prog = await readProg(gameDir);
    let startIndex = 0, resumeOff = 0, resumeCd: CdRec[] = [];
    if (prog && prog.fmt === "libarchive" && prog.srcSize === file.size && prog.skipAudio === skipAudio && prog.compressImages === compressImages && prog.nextIndex > 0) {
      try { const pf = await (await gameDir.getFileHandle(".rpgmpack")).getFile();
        if (pf.size >= prog.packOff) { startIndex = prog.nextIndex; resumeOff = prog.packOff; resumeCd = prog.cd.map((r) => ({ nameB: enc.encode(r.n), method: r.m, csize: r.c, usize: r.u, lho: r.l })); } } catch { /* fresh */ }
    }
    const { libarchiveWasm, ArchiveReader } = await import("libarchive-wasm");
    const mod = await libarchiveWasm({ locateFile: () => libarchiveWasmUrl as string });
    const data = new Int8Array(await file.arrayBuffer()); // whole archive in memory (format requires it)
    pw = new PackWriter(); await pw.open(gameDir, resumeOff, resumeCd);
    if (startIndex > 0) post({ type: "progress", pct: Math.min(95, Math.round(pw.off / Math.max(file.size, 1) * 100)) });

    const reader = new (ArchiveReader as unknown as { new (m: unknown, d: Int8Array): { entries(): Iterable<{ getFiletype(): string; getPathname(): string; isEncrypted(): boolean; readData(): { buffer: ArrayBufferLike; byteOffset: number; length: number } | undefined }>; free(): void } })(mod, data);
    let lastPct = -1;
    try {
      for (const entry of reader.entries()) {
        if (entry.getFiletype() === "Directory") continue;
        const name = entry.getPathname();
        names.push(name);
        const fileIdx = names.length - 1;
        curIndex = fileIdx;
        if (fileIdx < startIndex) continue;                 // already packed in a prior run
        if (skipAudio && isAudioPath(name)) continue;
        if (entry.isEncrypted()) throw new Error("This archive is password-protected — re-export it without a password and try again.");
        ctx = ` (at file ${fileIdx + 1}: ${name.split("/").pop()}, ${(pw.off / 1048576).toFixed(0)} MB written)`;
        const raw = entry.readData();
        const u = raw ? new Uint8Array(raw.buffer, raw.byteOffset, raw.length) : new Uint8Array(0);
        for (let attempt = 0; ; attempt++) {
          const packStart = pw.off;
          try {
            if (compressImages && isImg(name) && u.length > 0 && u.length < 30 * 1048576) {
              const out = await maybeTranscodePng(u.slice()); pw.begin(name, 0, out.length, out.length); pw.chunk(out);
            } else if (isMedia(name) || isImg(name) || u.length === 0) {
              pw.begin(name, 0, u.length, u.length); if (u.length) pw.chunk(u); // already-compressed → store as-is
            } else {
              const def = deflateSync(u, { level: 6 }); pw.begin(name, 8, def.length, u.length); pw.chunk(def); // re-deflate text/data to keep the pack small
            }
            break;
          } catch (e) { pw.rewindTo(packStart); const msg = e instanceof Error ? e.name + " " + e.message : String(e);
            if (attempt < 5 && TRANSIENT.test(msg)) { await sleep(400 * (attempt + 1) ** 2); continue; } throw e; }
        }
        if ((fileIdx + 1) % 12 === 0) { pw.flush(); await writeProg(gameDir, snap(fileIdx + 1)); }
        const pct = Math.min(99, Math.round(pw.off / Math.max(file.size, 1) * 100));
        if (pct !== lastPct) { lastPct = pct; post({ type: "progress", pct }); }
      }
    } finally { try { reader.free(); } catch { /* freed */ } }
    const bytes = pw.finish();
    await delProg(gameDir);
    post({ type: "done", names, bytes, packed: true });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    let resumable = false;
    if (pw && gameDir && curIndex > 0) { try { await writeProg(gameDir, snap(curIndex)); resumable = true; } catch { /* can't save */ } }
    post({ type: "error", fallback: false, message: err.message, name: err.name, ctx, resumable, done: curIndex, total: names.length });
  }
}

// —— resume sidecar io ————————————————————————————————————————————————————————
async function readProg(gameDir: FileSystemDirectoryHandle): Promise<Prog | null> {
  try {
    const fh = await gameDir.getFileHandle(".rpgmprog");
    return JSON.parse(await (await fh.getFile()).text()) as Prog;
  } catch { return null; }
}
async function writeProg(gameDir: FileSystemDirectoryHandle, prog: Prog): Promise<void> {
  const h = await openSync(gameDir, ".rpgmprog");
  try {
    const b = enc.encode(JSON.stringify(prog));
    h.truncate(0);
    wsafe(h, b, 0);
    h.flush();
  } finally {
    try { h.close(); } catch { /* closed */ }
  }
}
async function delProg(gameDir: FileSystemDirectoryHandle): Promise<void> {
  try { await gameDir.removeEntry(".rpgmprog"); } catch { /* absent */ }
}

self.onmessage = async (ev: MessageEvent<Job>) => {
  const { file, id, skipAudio, compressImages, failAfter } = ev.data;
  let ctx = "";
  // resumable state — hoisted so the catch can persist progress
  let gameDir: FileSystemDirectoryHandle | null = null;
  let pw: PackWriter | null = null;
  let curIndex = 0, totalFiles = 0;
  const snapshot = (nextIndex: number): Prog => ({
    srcSize: file.size, skipAudio: !!skipAudio, compressImages: !!compressImages,
    total: totalFiles, nextIndex, packOff: pw!.off, cd: pw!.cdJson(), fmt: "zip",
  });
  try {
    if (!("createSyncAccessHandle" in FileSystemFileHandle.prototype)) {
      post({ type: "error", fallback: true, message: "sync access handles unavailable" });
      return;
    }
    // RAR / 7z → libarchive path (self-contained: posts done/error itself)
    if ((await archiveKind(file)) !== "zip") { await extractViaLibarchive(file, id, !!skipAudio, !!compressImages); return; }
    const entries = await zipEntries(file);
    if (!entries.length) throw new Error("Couldn't read this zip — it looks empty or isn't a standard .zip archive.");
    const names = entries.map((e) => e.name);
    const skipRt = runtimeSkipper(names.filter((p) => !p.endsWith("/")));
    const files = entries.filter((e) => !e.name.endsWith("/") && !skipRt(e.name) && !(skipAudio && isAudioPath(e.name)));
    totalFiles = files.length;

    // PACKED needs the SW to be able to inflate on demand
    const packed = typeof DecompressionStream === "function";

    const root = await navigator.storage.getDirectory();
    gameDir = await (await root.getDirectoryHandle("rpgm", { create: true })).getDirectoryHandle(id, { create: true });

    // RESUME: a previous attempt left a sidecar — continue from where it died
    // instead of starting over (each attempt only ever has to get FURTHER).
    let startIndex = 0;
    let resumeCd: CdRec[] = [];
    let resumeOff = 0;
    if (packed) {
      const prog = await readProg(gameDir);
      if (prog && prog.fmt !== "libarchive" && prog.srcSize === file.size && prog.skipAudio === !!skipAudio
        && prog.compressImages === !!compressImages && prog.total === files.length
        && prog.nextIndex > 0 && prog.nextIndex <= files.length && Array.isArray(prog.cd)) {
        try {
          const pf = await (await gameDir.getFileHandle(".rpgmpack")).getFile();
          if (pf.size >= prog.packOff) {
            startIndex = prog.nextIndex;
            resumeOff = prog.packOff;
            resumeCd = prog.cd.map((r) => ({ nameB: enc.encode(r.n), method: r.m, csize: r.c, usize: r.u, lho: r.l }));
          }
        } catch { /* pack missing — fresh start */ }
      }
    }

    // quota: only what's still LEFT to write needs to fit. This can trip on a
    // RESUMED attempt (the partial pack itself now occupies space) — that's
    // fine: the failure is resumable (progress is NEVER discarded), the user
    // frees some space and continues.
    const rest = files.slice(startIndex);
    const need = rest.reduce((s, f) => s + (packed ? (isMedia(f.name) && f.method !== 0 ? f.uncompSize : f.compSize) : f.uncompSize), 0);
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est && est.quota != null && est.usage != null && need > (est.quota - est.usage)) {
      const mb = (n: number) => Math.ceil(n / 1048576);
      throw new Error(`Not enough room to continue: about ${mb(need)} MB still to write but only ${mb(est.quota - est.usage)} MB free. Free up some space, then import the same zip again — your progress is kept.`);
    }

    const totalComp = files.reduce((s, f) => s + f.compSize, 0) || 1;
    let readComp = files.slice(0, startIndex).reduce((s, f) => s + f.compSize, 0);
    let bytes = 0, lastPct = -1;

    // TEST HOOK: failAfter < 0 throws BEFORE pw exists (simulates the early
    // quota-check failure on a resume — worker reports resumable=false, yet a
    // prior checkpoint is on disk; rpgm.ts must still keep it).
    if (failAfter !== undefined && failAfter < 0) {
      const err = new Error("synthetic early failure (test hook)");
      err.name = "TestEarly";
      throw err;
    }

    pw = packed ? new PackWriter() : null;
    if (pw) await pw.open(gameDir, resumeOff, resumeCd);
    if (startIndex > 0) post({ type: "progress", pct: Math.min(99, Math.round((readComp / totalComp) * 100)) });

    for (let i = startIndex; i < files.length; i++) {
      const ent = files[i];
      curIndex = i;
      ctx = ` (at file ${i + 1}/${files.length}: ${ent.name.split("/").pop()}, ${((pw ? pw.off : bytes) / 1048576).toFixed(0)} MB written)`;
      checkEntry(ent);
      if (failAfter !== undefined && i >= failAfter && i < files.length - 1) {
        const err = new Error("synthetic failure (test hook)");
        err.name = "TestFatal";
        throw err;
      }
      for (let attempt = 0; ; attempt++) {
        const packStart = pw ? pw.off : 0;
        try {
          if (compressImages && canTranscode(ent.name, ent)) {
            const out = await maybeTranscodePng(await inflateWhole(file, ent));
            if (pw) { pw.begin(ent.name, 0, out.length, out.length); pw.chunk(out); }
            else bytes += await writeWhole(gameDir!, ent.name, out);
          } else if (pw && isMedia(ent.name) && ent.method !== 0) {
            // re-store deflated media so Range requests work by offset math
            const mds = await entryDataStart(file, ent);
            pw.begin(ent.name, 0, ent.uncompSize, ent.uncompSize);
            const inf = new Inflate();
            const q: Uint8Array[] = [];
            inf.ondata = (c) => { if (c?.length) q.push(c.slice()); };
            const reader = (file.slice(mds, mds + ent.compSize).stream() as ReadableStream<Uint8Array>).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (value?.length) inf.push(value, false);
              if (done) inf.push(new Uint8Array(0), true);
              while (q.length) pw.chunk(q.shift()!);
              if (done) break;
            }
          } else if (pw) {
            // verbatim: append the raw (still-compressed) bytes — no inflation
            pw.begin(ent.name, ent.method, ent.compSize, ent.uncompSize);
            const ds = await entryDataStart(file, ent);
            const reader = (file.slice(ds, ds + ent.compSize).stream() as ReadableStream<Uint8Array>).getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (value?.length) pw.chunk(value);
              if (done) break;
            }
          } else {
            bytes += await extractEntry(gameDir!, file, ent);
          }
          break;
        } catch (e) {
          if (pw) pw.rewindTo(packStart); // truncate the partial entry
          const msg = e instanceof Error ? e.name + " " + e.message : String(e);
          if (attempt < 5 && TRANSIENT.test(msg)) {
            await sleep(400 * (attempt + 1) ** 2); // 0.4s · 1.6s · 3.6s · 6.4s · 10s
            continue;
          }
          throw e;
        }
      }
      // checkpoint: flush to disk + persist resume state every 12 files, so a
      // failure (or even an OOM-killed tab) never costs more than 12 files of
      // work and a durable checkpoint exists early — the whole point is that
      // progress is NEVER lost, so each retry only has to get a bit further.
      if (pw && (i + 1) % 12 === 0) {
        pw.flush();
        await writeProg(gameDir, snapshot(i + 1));
      }
      readComp += ent.compSize;
      const pct = Math.min(99, Math.round((readComp / totalComp) * 100));
      if (pct !== lastPct) { lastPct = pct; post({ type: "progress", pct }); }
    }

    if (pw) {
      bytes = pw.finish();
      await delProg(gameDir);
    }
    post({ type: "done", names, bytes, packed: !!pw, resumedFrom: startIndex });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // persist progress so the NEXT attempt continues from here instead of zero
    let resumable = false;
    if (pw && gameDir && curIndex > 0) {
      try { await writeProg(gameDir, snapshot(curIndex)); resumable = true; } catch { /* can't save — full restart */ }
    }
    post({ type: "error", fallback: false, message: err.message, name: err.name, ctx, resumable, done: curIndex, total: totalFiles });
  }
};
