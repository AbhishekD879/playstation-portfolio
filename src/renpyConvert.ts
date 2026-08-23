// Ren'Py desktop → web conversion, IO half. See src/renpyPack.ts for the rules
// and why the game.zip/remote split matters.
//
// A desktop build is a game/ tree next to a native engine we cannot run. The
// engine has an official WebAssembly twin published per version, so the
// conversion is: work out the version, fetch the matching prebuilt engine, and
// hand it the game/ tree as game.zip.
//
// This lands the engine as LOOSE files in the game's OPFS dir. The service
// worker resolves loose first and the pack second, so the engine answers
// /rpgm/renpy/<id>/index.html while the game's own assets keep streaming out of
// the pack at /rpgm/renpy/<id>/game/... — which is exactly what the remote-file
// manifest needs, with no extra serving code.
import { Zip, ZipPassThrough, unzipSync } from "fflate";
import { trace } from "./importTrace";
import {
  budgetRefusal, buildRemoteManifest, findGameRoot, imageSize, parseRenpyVersion, placeFile,
  planSplit, webZipCandidates, type RemoteEntry,
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
  for (const name of engineNames) await io.write(name.replace(/^web\//, ""), engine[name]);

  // —— split the game tree ————————————————————————————————————————————————
  const gamePrefix = `${root}game/`;
  const gameFiles = all.filter((f) => f.path.startsWith(gamePrefix) && !f.path.endsWith("/"));
  if (!gameFiles.length) throw new Error("The game/ folder is empty.");

  // —— refuse the impossible before touching a single byte ————————————————
  // Everything game.zip carries is extracted into emscripten's in-memory
  // filesystem and never freed, so an oversized game does not import slowly, it
  // kills the tab. Decide from the listing, where it costs nothing to be wrong.
  const rels = gameFiles.map((f) => ({ rel: f.path.slice(gamePrefix.length), size: f.size }));
  const plan = planSplit(rels);
  trace("convert: plan", { localFiles: plan.localFiles, localMB: Math.round(plan.localBytes / 1048576),
    remoteFiles: plan.remoteFiles, rpaMB: Math.round(plan.rpaBytes / 1048576),
    videoMB: Math.round(plan.videoBytes / 1048576),
    biggest: plan.biggestLocal ? `${plan.biggestLocal.rel}:${Math.round(plan.biggestLocal.size / 1048576)}MB` : "none" });
  const refusal = budgetRefusal(plan);
  if (refusal) throw new Error(refusal);

  // —— stream game.zip ——————————————————————————————————————————————————————
  // One file at a time, in slices, with each chunk written straight out. Peak
  // memory is one slice, not the whole archive — the previous version built the
  // entire zip in RAM and then let zipSync copy it, which is twice the total.
  say("sorting game files", 22);
  const sink = await io.openWrite("game.zip");
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

  const manifest = buildRemoteManifest(remote);
  if (manifest) {
    const bytes = new TextEncoder().encode(manifest);
    const entry = new ZipPassThrough("game/renpyweb_remote_files.txt");
    zip.add(entry);
    entry.push(bytes, true);
    await drain();
  }

  say("finishing game.zip", 92);
  zip.end();
  await drain();
  await sink.close();
  trace("convert: game.zip written", { remoteEntries: remote.length });

  if (plan.rpaBytes > 0) {
    notes.push(`${Math.round(plan.rpaBytes / 1048576)} MB of .rpa archives have to stay in memory — `
      + "an .rpa is one blob and can't be fetched per file.");
  }
  if (videoBytes > 0) {
    notes.push(`${Math.round(videoBytes / 1048576)} MB of video is fetched on demand but not freed after playing.`);
  }

  say("ready", 100);

  // Report the archive's own root back: the pack keys carry it, so the service
  // worker needs it to resolve the on-demand game/... fetches. Engine files are
  // loose and are found without it.
  return {
    version: used, entry: "index.html", root,
    inZip: plan.localFiles, remote: remote.length,
    zipBytes: plan.localBytes, notes,
  };
}
