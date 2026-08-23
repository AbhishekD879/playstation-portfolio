// Ren'Py desktop → web conversion, IO half. See src/renpyPack.ts for the rules
// and why the game.zip/remote split matters.
//
// A desktop build is a game/ tree next to a native engine we cannot run. The
// engine has an official WebAssembly twin published per version, so the
// conversion is: work out the version, fetch the matching prebuilt engine, and
// hand it the game/ tree as game.zip.
//
// This lands the engine as LOOSE files under the archive's own root in the game's
// OPFS dir. The service worker resolves loose first and the pack second, and
// prepends .rpgmroot to BOTH, so the engine answers /rpgm/renpy/<id>/index.html
// while the game's own assets keep streaming out of the pack at
// /rpgm/renpy/<id>/game/... — no extra serving code. Writing the engine at the
// game-dir root instead looks right and 404s, because that prefix is not
// optional.
import { Zip, ZipPassThrough, unzipSync } from "fflate";
import { trace } from "./importTrace";
import { decodeRpaIndex, parseRpaHeader, type RpaEntry } from "./rpaIndex";
import {
  archiveKey, budgetRefusal, buildRemoteManifest, findGameRoot, imageSize, parseRenpyVersion,
  placeFile, planSplit, toBase64, webZipCandidates, type RemoteEntry,
} from "./renpyPack";

const PROXY = "https://abhishekstation-mp.abhishekdiwate879.workers.dev/renpy-web";

// The package layout is NOT stable across engine lines. 7.x ships index.wasm
// with pyapp.data + pythonhome.data; 8.x ships renpy.wasm, renpy.data and
// renpy-pre.js instead. So keep everything under web/ and name only what must be
// dropped — an allow-list built from one version silently ships a broken engine
// for the other, and will break again on the next layout change.
const ENGINE_SKIP = [
  /\.symbols$/,              // ~1MB of debug symbols, never loaded
  /(^|\/)hash\.txt$/,
  /(^|\/)htaccess\.txt$/,
  // Ren'Py's own service worker. 8.x only registers it when the page is not
  // already controlled, and our /rpgm/ worker always controls this iframe, so
  // it never runs — but a worker registered at /rpgm/renpy/<id>/ would take
  // precedence over ours for that scope, so don't ship the file at all.
  /(^|\/)service-worker\.js$/,
];
const engineWanted = (name: string): boolean =>
  name.startsWith("web/") && !name.endsWith("/") && !ENGINE_SKIP.some((re) => re.test(name));

export interface ConvertIO {
  /** Every file in the install, with its uncompressed size. */
  list: () => Promise<{ path: string; size: number }[]>;
  read: (path: string) => Promise<Uint8Array | null>;
  /** Leading bytes only — an image's dimensions are in its header, and reading a
   *  20MB PNG to learn them is what made this run out of memory on a phone. */
  readHead: (path: string, n: number) => Promise<Uint8Array | null>;
  readSlice: (path: string, start: number, end: number) => Promise<Uint8Array | null>;
  /** True when this file can be sliced cheaply. A deflated pack entry cannot:
   *  reading any part of it inflates the whole thing, which for an 823MB archive
   *  is precisely the out-of-memory this design exists to avoid. */
  randomAccess: (path: string) => Promise<boolean>;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Sequential sink, so game.zip is never held in memory in full. */
  openWrite: (path: string) => Promise<{ write: (c: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}

export interface ConvertResult {
  version: string;
  entry: string;
  root: string;
  inZip: number;
  remote: number;
  zipBytes: number;
  notes: string[];
}


export async function convertRenpyDesktop(
  io: ConvertIO, onProgress?: (phase: string, pct: number) => void,
): Promise<ConvertResult> {
  const say = (phase: string, pct: number) => { try { onProgress?.(phase, pct); } catch { /* cosmetic */ } };
  trace("convert: start");
  const notes: string[] = [];

  const all = await io.list();
  const root = findGameRoot(all.map((f) => f.path));
  trace("convert: root", { root, files: all.length });
  if (root === null) throw new Error("No game/ folder found in this Ren'Py build — nothing to convert.");

  // —— version ————————————————————————————————————————————————————————————
  say("reading the engine version", 2);
  const initPy = await io.read(`${root}renpy/__init__.py`);
  if (!initPy) {
    throw new Error("This build has no renpy/__init__.py, so its Ren'Py version can't be read. "
      + "Only a full desktop build (the folder with game/, lib/ and renpy/) can be converted.");
  }
  const version = parseRenpyVersion(new TextDecoder().decode(initPy));
  if (!version) throw new Error("Couldn't read a Ren'Py version out of renpy/__init__.py.");
  trace("convert: version", { version });
  const candidates = webZipCandidates(version);
  if (!candidates.length) {
    throw new Error(`This game is Ren'Py ${version}. Web builds only exist for 7.4 and later, `
      + "so there's no engine to pair it with. Ask the developer for a web build.");
  }

  // —— engine ——————————————————————————————————————————————————————————————
  say(`fetching the Ren'Py ${version} web engine`, 6);
  let engineZip: Uint8Array | null = null;
  let used = "";
  for (const v of candidates) {
    const r = await fetch(`${PROXY}?v=${encodeURIComponent(v)}`).catch(() => null);
    if (r?.ok) { engineZip = new Uint8Array(await r.arrayBuffer()); used = v; break; }
  }
  if (!engineZip) {
    throw new Error(`Couldn't download a Ren'Py web engine for ${version}. `
      + "The conversion needs it once per version — check the connection and retry.");
  }
  trace("convert: engine downloaded", { used, bytes: engineZip.length });
  if (used !== version) notes.push(`Engine ${used} used for a ${version} game — the nearest published web build.`);

  say("unpacking the engine", 18);
  const engine = unzipSync(engineZip, { filter: (f) => engineWanted(f.name) });
  const engineNames = Object.keys(engine);
  if (!engineNames.some((n) => /\.wasm$/.test(n))) throw new Error("The downloaded engine package contains no .wasm — its layout is unrecognised.");
  trace("convert: engine unpacked", { files: engineNames.length,
    names: engineNames.map((n) => n.replace(/^web\//, "")).join(",").slice(0, 200) });
  // Written UNDER the archive root. The service worker prepends .rpgmroot to
  // EVERY loose lookup, not only pack lookups — opfsFile resolves (root + path)
  // — so engine files written at the game-dir root are invisible to it, which is
  // exactly how a successful conversion still 404'd on index.html.
  for (const name of engineNames) await io.write(root + name.replace(/^web\//, ""), engine[name]);
  trace("convert: engine written", { under: root });

  // —— split the game tree ————————————————————————————————————————————————
  const gamePrefix = `${root}game/`;
  const gameFiles = all.filter((f) => f.path.startsWith(gamePrefix) && !f.path.endsWith("/"));
  if (!gameFiles.length) throw new Error("The game/ folder is empty.");

  // —— open the .rpa archives ————————————————————————————————————————————
  // Left whole, an .rpa forces its entire contents to be resident. But it is
  // just a container: a zlib-deflated pickled index at a known offset, and each
  // asset a byte range inside. Read the index and every asset inside becomes
  // individually fetchable, exactly like a loose file — which is what takes a
  // 823MB archive off the memory budget entirely.
  const looseRels = new Set(
    gameFiles.filter((f) => !/\.rpa$/i.test(f.path)).map((f) => f.path.slice(gamePrefix.length)),
  );
  const archives: string[] = [];
  const rpaFiles: Record<string, [number, [number, number, string | 0][]]> = {};
  const rpaOwned = new Map<string, { ai: number; entry: RpaEntry }>();
  for (const f of gameFiles) {
    if (!/\.rpa$/i.test(f.path)) continue;
    try {
      if (!(await io.randomAccess(f.path))) {
        // Stored at import (needsRandomAccess) — but an install made before that
        // change is still deflated, and inflating it would blow up the tab.
        trace("rpa: not randomly accessible, skipping", { file: f.path.slice(root.length) });
        notes.push(`${f.path.split("/").pop()} was imported before archive support and can't be `
          + "opened without re-importing this game.");
        continue;
      }
      const head = await io.readHead(f.path, 40);
      const hdr = head ? parseRpaHeader(head) : null;
      if (!hdr) { trace("rpa: unrecognised header", { file: f.path }); continue; }
      const tail = await io.readSlice(f.path, hdr.indexOffset, f.size);
      if (!tail) { trace("rpa: index unreadable", { file: f.path }); continue; }
      // zlib-wrapped, so "deflate" rather than "deflate-raw"
      const inflated = new Uint8Array(await new Response(
        new Blob([tail as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")),
      ).arrayBuffer());
      const index = decodeRpaIndex(inflated, hdr.key);
      const ai = archives.length;
      archives.push(archiveKey(root, f.path));
      for (const [rel, entry] of index) {
        // A loose file of the same name wins, as it does in Ren'Py itself, and
        // emitting both would duplicate the manifest line.
        if (looseRels.has(rel) || rpaOwned.has(rel)) continue;
        rpaOwned.set(rel, { ai, entry });
        rpaFiles[rel] = [ai, entry.segments.map((sg) => [sg.offset, sg.length,
          sg.prefix?.length ? toBase64(sg.prefix) : 0])];
      }
      trace("rpa: index read", { file: f.path.slice(root.length), version: hdr.version, entries: index.size });
    } catch (e) {
      // A refusal here is safe: the archive simply stays whole and counts
      // against the budget, which is the pre-existing behaviour.
      trace("rpa: index FAILED", { file: f.path, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // —— refuse the impossible before touching a single byte ————————————————
  // Everything game.zip carries is extracted into emscripten's in-memory
  // filesystem and never freed, so an oversized game does not import slowly, it
  // kills the tab. Decide from the listing, where it costs nothing to be wrong.
  // An archive whose index was read no longer costs anything: it is replaced in
  // the plan by its contents, each of which can be fetched on demand.
  const opened = new Set<string>();
  for (const f of gameFiles) {
    if (/\.rpa$/i.test(f.path) && archives.includes(archiveKey(root, f.path))) opened.add(f.path);
  }
  const rels = gameFiles
    .filter((f) => !opened.has(f.path))
    .map((f) => ({ rel: f.path.slice(gamePrefix.length), size: f.size }));
  for (const [rel, o] of rpaOwned) rels.push({ rel, size: o.entry.size });
  const plan = planSplit(rels);
  trace("convert: plan", { localFiles: plan.localFiles, localMB: Math.round(plan.localBytes / 1048576),
    remoteFiles: plan.remoteFiles, rpaMB: Math.round(plan.rpaBytes / 1048576),
    videoMB: Math.round(plan.videoBytes / 1048576),
    biggest: plan.biggestLocal ? `${plan.biggestLocal.rel}:${Math.round(plan.biggestLocal.size / 1048576)}MB` : "none",
    byExt: plan.localByExt.map((e) => `${e.ext}:${e.mb}`).join(" "),
    byDir: plan.localByDir.map((d) => `${d.dir}:${d.mb}`).join(" ") });
  const refusal = budgetRefusal(plan);
  if (refusal) throw new Error(refusal);

  // —— stream game.zip ——————————————————————————————————————————————————————
  // One file at a time, in slices, with each chunk written straight out. Peak
  // memory is one slice, not the whole archive — the previous version built the
  // entire zip in RAM and then let zipSync copy it, which is twice the total.
  say("sorting game files", 22);
  const sink = await io.openWrite(`${root}game.zip`);
  let pending: Uint8Array[] = [];
  let zipErr: Error | null = null;
  const zip = new Zip((err, chunk, _final) => {
    if (err) zipErr = err instanceof Error ? err : new Error(String(err));
    if (chunk?.length) pending.push(chunk);
  });
  const drain = async () => {
    if (zipErr) throw zipErr;
    const out = pending;
    pending = [];
    for (const c of out) await sink.write(c);
  };
  // Store rather than deflate: the assets are already compressed, and this zip
  // is unpacked and discarded seconds later, so CPU here only delays the boot.
  const addFile = async (name: string, path: string, size: number) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    const STEP = 4 * 1024 * 1024;
    if (size === 0) { entry.push(new Uint8Array(0), true); await drain(); return; }
    for (let off = 0; off < size; off += STEP) {
      const end = Math.min(off + STEP, size);
      const part = await io.readSlice(path, off, end);
      if (!part) throw new Error(`Couldn't read ${name} out of the install.`);
      entry.push(part, end >= size);
      await drain();
    }
  };

  const remote: RemoteEntry[] = [];
  let done = 0, videoBytes = 0;

  for (const f of gameFiles) {
    if (opened.has(f.path)) continue;    // replaced by its contents below
    const rel = f.path.slice(gamePrefix.length);
    let place = placeFile(rel, f.size);

    if (place.where === "remote" && place.rtype === "image") {
      // The engine draws a placeholder at the real pixel size while the file is
      // in flight, so an image entry without true dimensions is worse than
      // keeping it local. Header only — 64KB reaches every format's size field.
      const head = await io.readHead(f.path, 65536);
      const dim = head ? imageSize(head) : null;
      if (dim) remote.push({ rel, rtype: "image", size: f.size, w: dim.w, h: dim.h });
      else place = { where: "zip" };
    } else if (place.where === "remote") {
      remote.push({ rel, rtype: place.rtype, size: f.size });
      if (/\.(webm|mp4|ogv|mkv|avi|mov)$/i.test(rel)) videoBytes += f.size;
    }

    if (place.where === "zip") await addFile(`game/${rel}`, f.path, f.size);

    if ((++done & 31) === 0) say("packing game files", 22 + Math.round((done / gameFiles.length) * 60));
  }

  // Archive contents: same rules, but the bytes are read through the archive.
  for (const [rel, o] of rpaOwned) {
    let place = placeFile(rel, o.entry.size);
    if (place.where === "remote" && place.rtype === "image") {
      const seg = o.entry.segments[0];
      const pfx = seg?.prefix?.length ?? 0;
      const head = seg
        ? await io.readSlice(`${root}${archives[o.ai]}`, seg.offset, seg.offset + Math.min(seg.length, 65536))
        : null;
      let probe: Uint8Array | null = head;
      if (head && seg?.prefix?.length) {
        const joined = new Uint8Array(pfx + head.length);
        joined.set(seg.prefix, 0);
        joined.set(head, pfx);
        probe = joined;
      }
      const dim = probe ? imageSize(probe) : null;
      if (dim) remote.push({ rel, rtype: "image", size: o.entry.size, w: dim.w, h: dim.h });
      else place = { where: "zip" };
    } else if (place.where === "remote") {
      remote.push({ rel, rtype: place.rtype, size: o.entry.size });
      if (/\.(webm|mp4|ogv|mkv|avi|mov)$/i.test(rel)) videoBytes += o.entry.size;
    }
    if (place.where === "zip") {
      // small or startup-critical: copy the bytes out of the archive into the zip
      const entry = new ZipPassThrough(`game/${rel}`);
      zip.add(entry);
      const chunks: Uint8Array[] = [];
      for (const sg of o.entry.segments) {
        if (sg.prefix?.length) chunks.push(sg.prefix);
        const part = await io.readSlice(`${root}${archives[o.ai]}`, sg.offset, sg.offset + sg.length);
        if (part) chunks.push(part);
      }
      chunks.forEach((c, k) => entry.push(c, k === chunks.length - 1));
      if (!chunks.length) entry.push(new Uint8Array(0), true);
      await drain();
    }
  }

  const manifest = buildRemoteManifest(remote);
  if (manifest) {
    const bytes = new TextEncoder().encode(manifest);
    const entry = new ZipPassThrough("game/renpyweb_remote_files.txt");
    zip.add(entry);
    entry.push(bytes, true);
    await drain();
  }

  if (archives.length) {
    // The map the service worker resolves archive-backed requests through.
    await io.write(`${root}.rpaindex`, new TextEncoder().encode(JSON.stringify({ v: 1, a: archives, f: rpaFiles })));
    trace("rpa: sidecar written", { archives: archives.length, files: Object.keys(rpaFiles).length });
  }

  say("finishing game.zip", 92);
  zip.end();
  await drain();
  await sink.close();
  trace("convert: game.zip written", { remoteEntries: remote.length });

  if (plan.rpaBytes > 0) {
    notes.push(`${Math.round(plan.rpaBytes / 1048576)} MB of .rpa archives couldn't be opened and have to `
      + "stay in memory. Unopened archives can't be fetched per file.");
  }
  if (plan.localBytes > 128 * 1024 * 1024) {
    notes.push(`${Math.round(plan.localBytes / 1048576)} MB of scripts and data stay in memory while playing `
      + "— this is a heavy build and may be unstable on a phone.");
  }
  if (videoBytes > 0) {
    notes.push(`${Math.round(videoBytes / 1048576)} MB of video is fetched on demand but not freed after playing.`);
  }

  // Verify the engine is reachable at the path the service worker will use.
  // A conversion that reports success but serves 404 is the worst outcome, and
  // this is one read.
  const check = await io.readHead(`${root}index.html`, 64);
  if (!check?.length) {
    throw new Error("The engine was written but index.html can't be read back — the conversion would 404.");
  }
  trace("convert: index.html verified", { bytes: check.length });

  say("ready", 100);

  // Report the archive's own root back. It is recorded as .rpgmroot, and the
  // service worker prepends it to every lookup — loose and packed alike — so the
  // engine files written under it and the pack's game/... entries both resolve
  // through the same prefix.
  return {
    version: used, entry: "index.html", root,
    inZip: plan.localFiles, remote: remote.length,
    zipBytes: plan.localBytes, notes,
  };
}
