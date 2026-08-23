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
  archiveKey, budgetRefusal, buildRemoteManifest, findGameRoot, imageSize, isEngineTreeFile,
  parseRenpyVersion, placeFile, planSplit, toBase64, webZipCandidates, type RemoteEntry,
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

// Games routinely import networking they only use for a phone-home or update
// check, and the web build's Python has no sockets so those modules are trimmed
// out. A missing httplib then kills the whole game at init:
//
//   File "game/apo.rpy", line 4, in <module>
//     from urllib2 import urlopen
//   ImportError: No module named httplib
//
// This installs a LAST-RESORT import finder: it returns a stub only for network
// modules that genuinely cannot be found, so a real module always wins. The
// import then succeeds and raises only if the game actually makes a request,
// which for optional telemetry usually means it is simply skipped.
//
// Not ctypes: Ren'Py already handles its absence ("Failed to initialize steam"),
// and stubbing it would push that code further down a path it cannot finish.
const WEB_IMPORT_SHIM = `# Injected by AbhishekStation: browser import fallback.
#
# Two rules, both learned the hard way.
#
# 1. Only stub modules whose absence is FATAL. socket, ssl and _ssl are imported
#    by the standard library inside try/except ImportError, so their absence is
#    already handled gracefully. Stubbing _ssl made "import _ssl" succeed, the
#    stdlib went on to "from _ssl import RAND_add", and a handled failure became
#    an unhandled one. Same reason ctypes is left alone: Ren'Py already reports
#    "Failed to initialize steam" and carries on.
#
# 2. A stub must answer ANY attribute. Turning one ImportError into a different
#    ImportError is no better than the original.
import sys as _asp_sys

def _asp_install():
    # py2-only HTTP plumbing that urllib2 imports unconditionally: missing it
    # takes the whole game down, over code that is usually just telemetry.
    _names = ("httplib", "mimetools", "rfc822")

    try:
        import imp as _imp
    except ImportError:
        return

    class _Stub(object):
        def __init__(self, name):
            self.__name__ = name
            self.__file__ = "<unavailable in browser>"
            self._asp_cache = {}

        def __getattr__(self, attr):
            if attr.startswith("__") and attr.endswith("__"):
                raise AttributeError(attr)
            cache = self.__dict__.setdefault("_asp_cache", {})
            if attr not in cache:
                # An Exception subclass is usable both in an except clause and as
                # a constructor, which covers how these names actually get used.
                cache[attr] = type(str(attr), (Exception,), {})
            return cache[attr]

    class _Finder(object):
        def find_module(self, name, path=None):
            top = name.split(".")[0]
            if top not in _names:
                return None
            try:
                _imp.find_module(top)
                return None          # a real one exists, stay out of the way
            except ImportError:
                return self

        def load_module(self, name):
            if name in _asp_sys.modules:
                return _asp_sys.modules[name]
            mod = _Stub(name)
            mod.responses = {}
            mod.HTTP_PORT = 80
            mod.HTTPS_PORT = 443
            _asp_sys.modules[name] = mod
            return mod

    _asp_sys.meta_path.append(_Finder())

try:
    _asp_install()
    _asp_sys.stderr.write("ASP: browser import fallback installed" + chr(10))
except Exception:
    _asp_sys.stderr.write("ASP: browser import fallback FAILED" + chr(10))

# The real bootstrap is executed from its own file so its encoding declaration
# still lands in the first two lines, where Python 2 requires it.
execfile("_asp_bootstrap.py")
`;

// im.py, on DownloadNeeded, does open(os.path.join("_placeholders", relpath))
// and then transform_scale()s the result to the size carried in the manifest. So
// every remote image needs a real file there — a missing one is a hard IOError
// mid-render, which is what stopped the splash screen:
//   IOError: [Errno 44] No such file or directory:
//     '_placeholders/images/gui/splash_xred.png'
// Because the size is forced, the content can be one 1x1 transparent PNG reused
// for every entry: 68 bytes each, and stored, so the cost is mostly zip overhead.
const PLACEHOLDER_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

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

  // Ren'Py's own Python tree and its common scripts, which the prebuilt engine
  // does NOT contain, plus the bootstrap the wasm runs as main.py. All are
  // needed by Python's import machinery before anything renders, so all are
  // local by definition — none of this can be fetched on demand.
  const engineTree = all.filter((f) => !f.path.endsWith("/")
    && isEngineTreeFile(f.path.startsWith(root) ? f.path.slice(root.length) : f.path));
  // The desktop bootstrap is renpy.py renamed after the game; it is the only
  // top-level .py beside game/ and renpy/.
  const bootstrap = all.find((f) => {
    const rel = f.path.startsWith(root) ? f.path.slice(root.length) : f.path;
    return /^[^/]+\.py$/.test(rel);
  });
  const engineTreeBytes = engineTree.reduce((n, f) => n + f.size, 0) + (bootstrap?.size ?? 0);
  trace("convert: engine tree", { files: engineTree.length,
    mb: Math.round(engineTreeBytes / 1048576), bootstrap: bootstrap ? bootstrap.path.slice(root.length) : "MISSING" });
  if (!engineTree.length || !bootstrap) {
    throw new Error("This build is missing Ren'Py's own renpy/ folder or its bootstrap .py, "
      + "which the web engine doesn't ship and can't run without. Only a full desktop build converts.");
  }

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
  // The engine tree is unconditionally resident, so it belongs in the budget.
  plan.localBytes += engineTreeBytes;
  plan.localFiles += engineTree.length + 1;
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

  // index.wasm runs /main.py, so its absence is fatal. It is written as the
  // import shim plus an execfile of the untouched bootstrap, rather than the
  // shim prepended to it — prepending would push the bootstrap's own coding
  // declaration past line 2, where Python 2 stops looking for it.
  {
    const shim = new TextEncoder().encode(WEB_IMPORT_SHIM);
    const mainEntry = new ZipPassThrough("main.py");
    zip.add(mainEntry);
    mainEntry.push(shim, true);
    await drain();
    await addFile("_asp_bootstrap.py", bootstrap.path, bootstrap.size);
    trace("convert: bootstrap wrapped", { from: bootstrap.path.slice(root.length), shimBytes: shim.length });
  }
  for (const f of engineTree) {
    await addFile(f.path.startsWith(root) ? f.path.slice(root.length) : f.path, f.path, f.size);
  }
  trace("convert: engine tree packed", { files: engineTree.length + 1 });

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

  // Placeholders for every remote image, or the first one to render throws.
  const phBytes = Uint8Array.from(atob(PLACEHOLDER_PNG_B64), (c) => c.charCodeAt(0));
  let placeholders = 0;
  for (const r of remote) {
    if (r.rtype !== "image") continue;         // music/voice retry, video is a URL
    const entry = new ZipPassThrough(`_placeholders/${r.rel}`);
    zip.add(entry);
    entry.push(phBytes, true);
    placeholders++;
    if ((placeholders & 255) === 0) await drain();
  }
  await drain();
  trace("convert: placeholders written", { images: placeholders });

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
