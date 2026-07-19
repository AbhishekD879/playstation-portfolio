// Game-zip extraction WORKER. Why a worker: on phones the main thread runs the
// whole console UI (WebGL wave, XMB) and extraction there kept hitting
// Chromium's "operation failed for an unknown transient reason (e.g. out of
// memory)". Here extraction gets its own isolated thread and — the bigger win —
// OPFS *synchronous access handles*, which write in place with no per-write
// swap-file copies (createWritable's model). Transient errors are retried with
// backoff per file; the archive itself stays on disk (central-directory reads,
// entry-by-entry streaming) so peak memory is a few chunk buffers.
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
 *  WebP isn't actually smaller. Typical win on RPG Maker art: 50-80%. */
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

// candidates: plain .png only. NOT the encrypted variants (.rpgmvp/.png_ —
// can't decode without the game key), NOT effects/ textures (effekseer's WASM
// decodes PNG bytes itself and would choke on WebP), NOT gifs (animation).
const canTranscode = (name: string, ent: ZipEntry): boolean =>
  /\.png$/i.test(name) && !/(^|\/)effects\//i.test(name) && ent.uncompSize > 0 && ent.uncompSize < 30 * 1048576;

/** Write one whole buffer via a sync access handle. */
async function writeWhole(gameDir: FileSystemDirectoryHandle, path: string, data: Uint8Array): Promise<number> {
  const { dir, name } = await dirFor(gameDir, path);
  const fh = await dir.getFileHandle(name, { create: true });
  const h = await (fh as unknown as { createSyncAccessHandle: () => Promise<SyncHandle> }).createSyncAccessHandle();
  try {
    h.truncate(0);
    for (let o = 0; o < data.length; o += 4194304) h.write(data.subarray(o, Math.min(o + 4194304, data.length)), { at: o });
    h.flush();
    return data.length;
  } finally {
    try { h.close(); } catch { /* already closed */ }
  }
}

/** Extract one entry into OPFS via a sync access handle. Restartable: on any
 *  failure the caller retries this whole function — it truncates and rewrites. */
async function extractEntry(gameDir: FileSystemDirectoryHandle, file: File, ent: ZipEntry): Promise<number> {
  const dataStart = await entryDataStart(file, ent);
  const { dir, name } = await dirFor(gameDir, ent.name);
  const fh = await dir.getFileHandle(name, { create: true });
  const h = await (fh as unknown as { createSyncAccessHandle: () => Promise<SyncHandle> }).createSyncAccessHandle();
  try {
    h.truncate(0);
    let at = 0;
    const reader = (file.slice(dataStart, dataStart + ent.compSize).stream() as ReadableStream<Uint8Array>).getReader();
    if (ent.method === 0) {
      for (;;) { // stored: pipe as-is
        const { done, value } = await reader.read();
        if (value?.length) { h.write(value, { at }); at += value.length; }
        if (done) break;
      }
    } else {
      const q: Uint8Array[] = [];
      const inf = new Inflate();
      inf.ondata = (chunk) => { if (chunk?.length) q.push(chunk.slice()); }; // copy: fflate reuses buffers
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

    // quota against the real UNPACKED size, before anything is written
    const totalOut = files.reduce((s, f) => s + f.uncompSize, 0);
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est && est.quota != null && est.usage != null && totalOut > (est.quota - est.usage)) {
      const gb = (n: number) => (n / 1073741824).toFixed(1);
      throw new Error(`Not enough room: this game unpacks to ${gb(totalOut)} GB but only ${gb(est.quota - est.usage)} GB is free on this device.`);
    }

    const root = await navigator.storage.getDirectory();
    const gameDir = await (await root.getDirectoryHandle("rpgm", { create: true })).getDirectoryHandle(id, { create: true });

    const totalComp = files.reduce((s, f) => s + f.compSize, 0) || 1;
    let readComp = 0, bytes = 0, fileNo = 0, lastPct = -1;
    for (const ent of files) {
      ctx = ` (at file ${++fileNo}/${files.length}: ${ent.name.split("/").pop()}, ${(bytes / 1048576).toFixed(0)} MB written)`;
      checkEntry(ent);
      // transient errors are exactly that — give the device a breather & retry
      let written = 0;
      for (let attempt = 0; ; attempt++) {
        try {
          if (compressImages && canTranscode(ent.name, ent)) {
            const out = await maybeTranscodePng(await inflateWhole(file, ent));
            written = await writeWhole(gameDir, ent.name, out);
          } else {
            written = await extractEntry(gameDir, file, ent);
          }
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.name + " " + e.message : String(e);
          if (attempt < 3 && /transient|out of memory|UnknownError|NoModificationAllowed|InvalidState|truncate/i.test(msg)) {
            await sleep(500 * (attempt + 1) ** 2); // 0.5s · 2s · 4.5s
            continue;
          }
          throw e;
        }
      }
      bytes += written;
      readComp += ent.compSize;
      const pct = Math.min(99, Math.round((readComp / totalComp) * 100));
      if (pct !== lastPct) { lastPct = pct; post({ type: "progress", pct }); }
    }
    post({ type: "done", names, bytes });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    post({ type: "error", fallback: false, message: err.message, name: err.name, ctx });
  }
};
