// Pure half of the Ren'Py desktop->web converter. These rules decide whether a
// game boots or exhausts memory (everything in game.zip lives in emscripten's
// in-memory FS for the whole session), and the manifest format is read by
// renpy/loader.py, so a wrong separator silently drops every remote file.
import assert from "node:assert/strict";
globalThis.btoa ??= (b) => Buffer.from(b, "binary").toString("base64");
import {
  parseRenpyVersion, webZipCandidates, placeFile, buildRemoteManifest, imageSize, INLINE_MAX,
  planSplit, budgetRefusal, LOCAL_BUDGET, archiveKey, toBase64, isEngineTreeFile,
  hasPhoneVariantAssets,
} from "./renpyPack.ts";

// —— version ——————————————————————————————————————————————————————————————
assert.equal(parseRenpyVersion("version_tuple = (7, 5, 3, vc_version)"), "7.5.3");
assert.equal(parseRenpyVersion("version_tuple=(8,3,7,None)"), "8.3.7");
assert.equal(parseRenpyVersion("nothing here"), null);

// Walk DOWN only: a newer engine can reject older bytecode, so never guess up.
assert.deepEqual(webZipCandidates("7.5.3", 4), ["7.5.3", "7.5.2", "7.5.1", "7.5.0"]);
assert.deepEqual(webZipCandidates("8.1.0", 3), ["8.1.0"]);
assert.deepEqual(webZipCandidates("7.3.5"), [], "web support starts at 7.4");
assert.deepEqual(webZipCandidates("6.99.12"), []);
assert.deepEqual(webZipCandidates("garbage"), []);

// —— placement ————————————————————————————————————————————————————————————
const big = INLINE_MAX + 1;
assert.deepEqual(placeFile("script.rpyc", big), { where: "zip" }, "scripts are needed at startup");
assert.deepEqual(placeFile("gui/font.ttf", big), { where: "zip" }, "fonts are needed to draw anything");
assert.deepEqual(placeFile("archive.rpa", 900e6), { where: "zip" },
  "an .rpa is monolithic — it cannot be fetched per file");
assert.deepEqual(placeFile("images/bg.png", 8), { where: "zip" }, "too small to be worth a request");
// remote here means our own service worker reading OPFS, so inlining buys almost
// nothing — a 40KB image belongs on demand, not resident
assert.deepEqual(placeFile("images/bg.png", 40 * 1024), { where: "remote", rtype: "image" },
  "40KB must not be inlined: a remote read is same-origin, not a network trip");
assert.deepEqual(placeFile("images/bg.png", big), { where: "remote", rtype: "image" });
assert.deepEqual(placeFile("audio/theme.ogg", big), { where: "remote", rtype: "music" });
// voice is unlinked right after playback, music is kept for looping — the
// distinction is real memory, not cosmetic
assert.deepEqual(placeFile("voice/ch1/line1.ogg", big), { where: "remote", rtype: "voice" });
assert.deepEqual(placeFile("audio/voices/x.opus", big), { where: "remote", rtype: "voice" });
// video is its own rtype: renpy/audio/audio.py returns a URL for it, so the
// browser fetches it directly and no placeholder is involved
assert.deepEqual(placeFile("movies/op.webm", big), { where: "remote", rtype: "video" });
// an unrecognised rtype falls through Ren'Py's audio path to a silence
// placeholder in renpy/common, so unknown types are inlined rather than guessed
assert.deepEqual(placeFile("data/blob.bin", big), { where: "zip" },
  "an unknown large file must not become a remote entry with no placeholder");

// —— manifest format ——————————————————————————————————————————————————————
const man = buildRemoteManifest([
  { rel: "images/bg.png", rtype: "image", size: 500000, w: 1920, h: 1080 },
  { rel: "audio/t.ogg", rtype: "music", size: 4321 },
]);
assert.equal(man, "images/bg.png\nimage 1920,1080\naudio/t.ogg\nmusic 4321\n");
assert.equal(man.split("\n").filter(Boolean).length % 2, 0, "loader.py reads strict line pairs");
assert.equal(buildRemoteManifest([]), "", "no remote files means no manifest at all");

// —— image headers (built by hand, so the offsets are the thing under test) ——
const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
png.set([0x49, 0x48, 0x44, 0x52], 12);
png.set([0, 0, 0x03, 0x20], 16);   // 800
png.set([0, 0, 0x02, 0x58], 20);   // 600
assert.deepEqual(imageSize(png), { w: 800, h: 600 }, "PNG IHDR");

const gif = new Uint8Array(10);
gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
gif.set([0x40, 0x01, 0xf0, 0x00], 6);
assert.deepEqual(imageSize(gif), { w: 320, h: 240 }, "GIF");

// JPEG: an APP0 segment first, so the walker has to skip it to reach SOF0
const jpg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80,
  0, 0, 0, 0, 0, 0, 0, 0,
]);
assert.deepEqual(imageSize(jpg), { w: 1920, h: 1080 }, "JPEG SOF0 after APP0");

const webp = new Uint8Array(30);
webp.set([0x52, 0x49, 0x46, 0x46], 0);
webp.set([0x57, 0x45, 0x42, 0x50], 8);
webp.set([0x56, 0x50, 0x38, 0x20], 12);
webp.set([0x90, 0x01], 26);  // 400
webp.set([0x2c, 0x01], 28);  // 300
assert.deepEqual(imageSize(webp), { w: 400, h: 300 }, "WebP lossy");

assert.equal(imageSize(new Uint8Array([1, 2, 3, 4])), null, "unknown format must not guess");
assert.equal(imageSize(new Uint8Array(0)), null);

// —— the budget gate ——————————————————————————————————————————————————————
// Everything game.zip carries is extracted into emscripten's in-memory FS and
// never freed, so this is what stands between a clear refusal and the tab being
// killed mid-import. It must decide from sizes ALONE — before any file is read.
const MB = 1048576;
const modest = planSplit([
  { rel: "script.rpyc", size: 8 * MB },
  { rel: "images/bg.png", size: 40 * MB },
  { rel: "movies/op.webm", size: 300 * MB },
]);
assert.equal(modest.localFiles, 1, "only the script is local");
assert.equal(modest.localBytes, 8 * MB, "a remote image costs no resident memory");
// composition is what makes an over-budget game reducible rather than just refused
assert.deepEqual(modest.localByExt, [{ ext: "rpyc", mb: 8 }]);
assert.deepEqual(modest.localByDir, [{ dir: "(root)", mb: 8 }]);
assert.equal(modest.videoBytes, 300 * MB);
assert.equal(modest.remoteFiles, 2, "image and video are remote, the script is not");
assert.equal(budgetRefusal(modest), null, "8 MB resident is fine");

// an .rpa is one blob, so it cannot be fetched per file and must stay resident
const archived = planSplit([{ rel: "archive.rpa", size: 700 * MB }]);
assert.equal(archived.rpaBytes, 700 * MB);
assert.equal(archived.localBytes, 700 * MB, ".rpa is forced local");
const rpaWhy = budgetRefusal(archived);
assert.ok(rpaWhy, "700 MB resident must be refused, not attempted");
assert.match(rpaWhy, /\.rpa/, "the message must name the actual cause");
assert.match(rpaWhy, /700 MB/, "and quote the real number");

// script bulk without archives gets the other explanation
const bulky = planSplit(Array.from({ length: 400 }, (_, i) => ({ rel: `s${i}.rpyc`, size: 1 * MB })));
const bulkWhy = budgetRefusal(bulky);
assert.ok(bulkWhy && !/\.rpa/.test(bulkWhy), "no archives, so do not blame archives");
assert.match(bulkWhy, /Largest single file/);

// the refusal must point at WHERE the weight is, so it can be acted on
const tl = planSplit([
  ...Array.from({ length: 200 }, (_, i) => ({ rel: `tl/Spanish/s${i}.rpyc`, size: 1 * MB })),
  ...Array.from({ length: 60 }, (_, i) => ({ rel: `game/s${i}.rpyc`, size: 1 * MB })),
]);
assert.equal(tl.localByDir[0].dir, "tl", "the heaviest directory must come first");
const tlWhy = budgetRefusal(tl);
assert.match(tlWhy, /tl\/ \(200 MB\)/, "the refusal must name the directory to cut");

// right at the edge: at the limit is allowed, one byte over is not
assert.equal(budgetRefusal(planSplit([{ rel: "a.rpyc", size: LOCAL_BUDGET }])), null);
assert.ok(budgetRefusal(planSplit([{ rel: "a.rpyc", size: LOCAL_BUDGET + 1 }])));
assert.equal(budgetRefusal(planSplit([])), null, "an empty plan is not a refusal");

// —— the path invariant ————————————————————————————————————————————————————
// The service worker prepends .rpgmroot to EVERY lookup, so what .rpaindex
// stores must satisfy root + key === the real path. Breaking this prepends game/
// twice and 404s every asset in the game — it already did once.
for (const [root, full] of [
  ["LewdIsland-1.0-pc/", "LewdIsland-1.0-pc/game/sugar.rpa"],
  ["", "game/sugar.rpa"],
  ["a/b/", "a/b/game/x.rpa"],
]) {
  const key = archiveKey(root, full);
  assert.equal(root + key, full, `root + archiveKey must rebuild the path (${full})`);
  assert.ok(key.startsWith("game/"), "the stored key must still carry the game/ segment");
}
// a path outside the root is returned untouched rather than silently truncated
assert.equal(archiveKey("x/", "other/game/a.rpa"), "other/game/a.rpa");

// base64 must not spread a large buffer into a call (stack overflow reads as a
// corrupt archive, which is the worst way to fail)
const wide = new Uint8Array(200_000).fill(65);
assert.equal(toBase64(wide).length, Math.ceil(wide.length / 3) * 4);
assert.equal(toBase64(new Uint8Array([104, 105])), "aGk=");

// —— the engine tree ————————————————————————————————————————————————————————
// The prebuilt package ships the Cython half in index.wasm and the stdlib in
// pyapp.data, and contains no /renpy* files at all. So Ren'Py's Python tree and
// common scripts must travel in game.zip or the engine stops at
// "fopen: No such file or directory" with nothing to run.
for (const f of [
  "renpy/__init__.py", "renpy/bootstrap.py", "renpy/common/00console.rpy",
  "renpy/common/_compat/gamemenu.rpyc", "renpy/display/core.py", "renpy/common/DejaVuSans.ttf",
]) assert.ok(isEngineTreeFile(f), `the engine needs ${f}`);

// native modules and Cython sources are already compiled into the wasm, so
// shipping them would only cost resident memory
for (const f of [
  "renpy/display/render.so", "renpy/uguu/gl.pyd", "renpy/text/textsupport.pyx",
  "renpy/display/matrix.pxd", "renpy/gl2/gl2mesh.c", "renpy/audio/renpysound.h",
]) assert.ok(!isEngineTreeFile(f), `must not ship ${f}`);

// only the renpy/ tree — game files and the bootstrap are handled separately
assert.equal(isEngineTreeFile("game/script.rpyc"), false);
assert.equal(isEngineTreeFile("lib/py2-linux-x86_64/libpython.so"), false);
assert.equal(isEngineTreeFile("LewdIsland.py"), false, "the bootstrap is added as main.py, not here");
assert.equal(isEngineTreeFile("myrenpy/x.py"), false, "must be the renpy/ segment, not a prefix match");

console.log("renpy pack ok · version, placement, manifest, 5 image formats, budget gate");

// Whether to suppress Ren'Py's phone/small variants is decided from the file
// list, not from the platform: a game shipping real phone art keeps its phone
// layout, and only a game that declares the variant without the assets is
// forced back to the layout it actually has.
assert.equal(hasPhoneVariantAssets(["gui/phone/overlay/gm.png", "script.rpyc"]), true);
assert.equal(hasPhoneVariantAssets(["phone/bg.png"]), true, "a top-level variant dir counts");
assert.equal(hasPhoneVariantAssets(["gui/small/frame.png"]), true, "small is a variant too");
assert.equal(hasPhoneVariantAssets(["gui/overlay/gm.png", "images/bg.png"]), false);
assert.equal(hasPhoneVariantAssets(["images/telephone/ring.png"]), false,
  "must match a path segment, not a substring");
assert.equal(hasPhoneVariantAssets(["images/smallish/x.png"]), false);
assert.equal(hasPhoneVariantAssets([]), false);
console.log("phone-variant detection ok");
