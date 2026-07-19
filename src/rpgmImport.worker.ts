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
import { Inflate } from "fflate";
import { checkEntry, entryDataStart, isAudioPath, runtimeSkipper, zipEntries, type ZipEntry } from "./zipcd";

interface Job { file: File; id: string; skipAudio?: boolean; compressImages?: boolean }
// minimal local typings — lib.dom doesn't carry the worker-only OPFS sync API
interface SyncHandle { write(b: Uint8Array, opts?: { at?: number }): number; truncate(n: number): void; flush(): void; close(): void }

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  private cur: Uint8Array[] = [];

  async open(gameDir: FileSystemDirectoryHandle) { this.h = await openSync(gameDir, ".rpgmpack"); this.h.truncate(0); }
  private put(...parts: Uint8Array[]) { for (const p of parts) { this.h.write(p, { at: this.off }); this.off += p.length; } }

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
        if (value?.length) { h.write(value, { at }); at += value.length; }
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
        while (q.length) { const c = q.shift()!; h.write(c, { at }); at += c.length; }
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
    for (let o = 0; o < data.length; o += 4194304) h.write(data.subarray(o, Math.min(o + 4194304, data.length)), { at: o });
    h.flush();
    return data.length;
  } finally {
    try { h.close(); } catch { /* already closed */ }
  }
}

const TRANSIENT = /transient|out of memory|UnknownError|NoModificationAllowed|InvalidState|truncate/i;

self.onmessage = async (ev: MessageEvent<Job>) => {
  const { file, id, skipAudio, compressImages } = ev.data;
  let ctx = "";
  try {
    if (!("createSyncAccessHandle" in FileSystemFileHandle.prototype)) {
      post({ type: "error", fallback: true, message: "sync access handles unavailable" });
      return;
    }
    const entries = await zipEntries(file);
    if (!entries.length) throw new Error("Couldn't read this zip — it looks empty or isn't a standard .zip archive.");
    const names = entries.map((e) => e.name);
    const skipRt = runtimeSkipper(names.filter((p) => !p.endsWith("/")));
    const files = entries.filter((e) => !e.name.endsWith("/") && !skipRt(e.name) && !(skipAudio && isAudioPath(e.name)));

    // PACKED needs the SW to be able to inflate on demand
    const packed = typeof DecompressionStream === "function";

    // quota: packed installs need ~compressed size (media re-stored at usize);
    // extracted installs need the full unpacked size
    const need = files.reduce((s, f) => s + (packed ? (isMedia(f.name) && f.method !== 0 ? f.uncompSize : f.compSize) : f.uncompSize), 0);
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est && est.quota != null && est.usage != null && need > (est.quota - est.usage)) {
      const gb = (n: number) => (n / 1073741824).toFixed(1);
      throw new Error(`Not enough room: this game needs ${gb(need)} GB but only ${gb(est.quota - est.usage)} GB is free on this device.`);
    }

    const root = await navigator.storage.getDirectory();
    const gameDir = await (await root.getDirectoryHandle("rpgm", { create: true })).getDirectoryHandle(id, { create: true });

    const totalComp = files.reduce((s, f) => s + f.compSize, 0) || 1;
    let readComp = 0, bytes = 0, fileNo = 0, lastPct = -1;

    const pw = packed ? new PackWriter() : null;
    if (pw) await pw.open(gameDir);

    for (const ent of files) {
      ctx = ` (at file ${++fileNo}/${files.length}: ${ent.name.split("/").pop()}, ${((pw ? pw.off : bytes) / 1048576).toFixed(0)} MB written)`;
      checkEntry(ent);
      for (let attempt = 0; ; attempt++) {
        const packStart = pw ? pw.off : 0;
        try {
          if (compressImages && canTranscode(ent.name, ent)) {
            const out = await maybeTranscodePng(await inflateWhole(file, ent));
            if (pw) { pw.begin(ent.name, 0, out.length, out.length); pw.chunk(out); }
            else bytes += await writeWhole(gameDir, ent.name, out);
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
            bytes += await extractEntry(gameDir, file, ent);
          }
          break;
        } catch (e) {
          if (pw) pw.rewindTo(packStart); // truncate the partial entry
          const msg = e instanceof Error ? e.name + " " + e.message : String(e);
          if (attempt < 3 && TRANSIENT.test(msg)) {
            await sleep(500 * (attempt + 1) ** 2); // 0.5s · 2s · 4.5s
            continue;
          }
          throw e;
        }
      }
      readComp += ent.compSize;
      const pct = Math.min(99, Math.round((readComp / totalComp) * 100));
      if (pct !== lastPct) { lastPct = pct; post({ type: "progress", pct }); }
    }

    if (pw) bytes = pw.finish();
    post({ type: "done", names, bytes, packed: !!pw });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    post({ type: "error", fallback: false, message: err.message, name: err.name, ctx });
  }
};
