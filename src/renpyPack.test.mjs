// Pure half of the Ren'Py desktop->web converter. These rules decide whether a
// game boots or exhausts memory (everything in game.zip lives in emscripten's
// in-memory FS for the whole session), and the manifest format is read by
// renpy/loader.py, so a wrong separator silently drops every remote file.
import assert from "node:assert/strict";
import {
  parseRenpyVersion, webZipCandidates, placeFile, buildRemoteManifest, imageSize, INLINE_MAX,
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
assert.deepEqual(placeFile("images/bg.png", 8), { where: "zip" }, "a round trip costs more than 8 bytes");
assert.deepEqual(placeFile("images/bg.png", big), { where: "remote", rtype: "image" });
assert.deepEqual(placeFile("audio/theme.ogg", big), { where: "remote", rtype: "music" });
// voice is unlinked right after playback, music is kept for looping — the
// distinction is real memory, not cosmetic
assert.deepEqual(placeFile("voice/ch1/line1.ogg", big), { where: "remote", rtype: "voice" });
assert.deepEqual(placeFile("audio/voices/x.opus", big), { where: "remote", rtype: "voice" });
assert.deepEqual(placeFile("movies/op.webm", big), { where: "remote", rtype: "other" });

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

console.log("renpy pack ok · version, placement, manifest, 5 image formats");
