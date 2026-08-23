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
import { unzipSync, zipSync } from "fflate";
import {
  buildRemoteManifest, findGameRoot, imageSize, parseRenpyVersion, placeFile, webZipCandidates,
  type RemoteEntry,
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
  write: (path: string, bytes: Uint8Array) => Promise<void>;
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
  const notes: string[] = [];

  const all = await io.list();
  const root = findGameRoot(all.map((f) => f.path));
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
  if (used !== version) notes.push(`Engine ${used} used for a ${version} game — the nearest published web build.`);

  say("unpacking the engine", 18);
  const engine = unzipSync(engineZip, { filter: (f) => engineWanted(f.name) });
  const engineNames = Object.keys(engine);
  if (!engineNames.some((n) => /\.wasm$/.test(n))) throw new Error("The downloaded engine package contains no .wasm — its layout is unrecognised.");
  for (const name of engineNames) await io.write(name.replace(/^web\//, ""), engine[name]);

  // —— split the game tree ————————————————————————————————————————————————
  const gamePrefix = `${root}game/`;
  const gameFiles = all.filter((f) => f.path.startsWith(gamePrefix) && !f.path.endsWith("/"));
  if (!gameFiles.length) throw new Error("The game/ folder is empty.");

  const zipEntries: Record<string, Uint8Array> = {};
  const remote: RemoteEntry[] = [];
  let rpaBytes = 0, videoBytes = 0, done = 0;

  for (const f of gameFiles) {
    const rel = f.path.slice(gamePrefix.length);
    let place = placeFile(rel, f.size);

    if (place.where === "remote" && place.rtype === "image") {
      // The engine draws a correctly-sized placeholder while the real image is
      // in flight, so an image entry without true dimensions is worse than
      // keeping the file local. Read the header only, never the whole file.
      const head = await io.read(f.path);
      const dim = head ? imageSize(head.subarray(0, Math.min(head.length, 65536))) : null;
      if (dim) remote.push({ rel, rtype: "image", size: f.size, w: dim.w, h: dim.h });
      else place = { where: "zip" };
    } else if (place.where === "remote") {
      remote.push({ rel, rtype: place.rtype, size: f.size });
    }

    if (place.where === "zip") {
      const bytes = await io.read(f.path);
      if (bytes) {
        zipEntries[`game/${rel}`] = bytes;
        if (/\.rpa$/i.test(rel)) rpaBytes += bytes.length;
      }
    } else if (/\.(webm|mp4|ogv|mkv|avi|mov)$/i.test(rel)) {
      videoBytes += f.size;
    }

    if ((++done & 63) === 0) say("sorting game files", 20 + Math.round((done / gameFiles.length) * 55));
  }

  const manifest = buildRemoteManifest(remote);
  if (manifest) zipEntries["game/renpyweb_remote_files.txt"] = new TextEncoder().encode(manifest);

  // Everything in game.zip is extracted into emscripten's in-memory filesystem
  // and stays there, so these two are the difference between running and dying.
  if (rpaBytes > 64 * 1024 * 1024) {
    notes.push(`${Math.round(rpaBytes / 1048576)} MB of .rpa archives must stay in memory — `
      + "an .rpa is one blob and can't be fetched per file. This game may be too heavy for a phone.");
  }
  if (videoBytes > 0) {
    notes.push(`${Math.round(videoBytes / 1048576)} MB of video is fetched on demand but not freed after playing.`);
  }

  say("building game.zip", 82);
  // Store, don't deflate: assets are already compressed and this zip is thrown
  // away seconds later, so spending CPU on it only delays the boot.
  const gameZip = zipSync(zipEntries, { level: 0 });
  await io.write("game.zip", gameZip);

  say("ready", 100);

  // Report the archive's own root back: the pack keys carry it, so the service
  // worker needs it to resolve the on-demand game/... fetches. Engine files are
  // loose and are found without it.
  return {
    version: used, entry: "index.html", root,
    inZip: Object.keys(zipEntries).length, remote: remote.length,
    zipBytes: gameZip.length, notes,
  };
}
