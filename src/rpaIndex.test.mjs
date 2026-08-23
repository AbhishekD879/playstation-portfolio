// .rpa index reading, verified against a REAL archive built by Python's own
// pickle -- not against my reading of the format. The fixture below is a genuine
// RPA-3.0 holding four files that between them exercise every shape the format
// allows: a plain (offset, length) entry, a 3-tuple with an inline prefix, a file
// split across two segments, and a non-ASCII path.
//
// This matters because a misread index yields a plausible-but-wrong offset, which
// serves silent garbage instead of failing.
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { parseRpaHeader, decodeRpaIndex, unpickle } from "./rpaIndex.ts";

const RPA_B64 =
  "UlBBLTMuMCAwMDAwMDAwMDAwMDAwMjE4IDQyNDI0MjQyCgAAAAAAAIlQTkcNChoKAAECAwQFBgcICQoLDA0ODxAREhMUFRYX" +
  "GBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+PwABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f" +
  "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYn" +
  "KCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAFJFTlBZIFJQQzIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIlQTkcNChoK" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4nGtgqi1k0IjgZWBgyMxNTE8t1k9K1yvISy9kjC1k8spycnLy6gIS" +
  "bYXMiRH8QEWJpSmZ+folGam5qXr56emFLLGFrF6bQMragEQEB1CJf3p6MJBiKGRrL2RPjOAGMouTizILSvSKCiqTCzliCzk1" +
  "vL45A7WEgU3m8uoCcbLAHO7UCCGghtK8zOT8lFT9x41NjxtbwA7iiS3k9dqEUMmXWKoHAIpgOaI=" +
  "";
const rpa = new Uint8Array(Buffer.from(RPA_B64, "base64"));

const h = parseRpaHeader(rpa);
assert.ok(h, "header must parse");
assert.equal(h.version, 3);
assert.equal(h.key, 0x42424242, "the XOR key is what makes the offsets meaningful");

const index = decodeRpaIndex(new Uint8Array(inflateSync(rpa.subarray(h.indexOffset))), h.key);
assert.equal(index.size, 4);

/** Reassemble exactly the way the service worker will: prefix first, then range. */
function readEntry(entry) {
  const parts = [];
  for (const s of entry.segments) {
    if (s.prefix) parts.push(s.prefix);
    parts.push(rpa.subarray(s.offset, s.offset + s.length));
  }
  const total = parts.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of parts) { out.set(b, o); o += b.length; }
  return out;
}

for (const [path, magic, size, segs] of [
  ["images/bg.png", [0x89, 0x50, 0x4e, 0x47], 200, 1],
  ["audio/theme.ogg", [0x4f, 0x67, 0x67, 0x53], 204, 1],   // magic lives in the inline prefix
  ["script.rpyc", [0x52, 0x45, 0x4e, 0x50], 60, 2],        // split across two segments
  ["unicode/あい.png", [0x89, 0x50, 0x4e, 0x47], 40, 1],
]) {
  const e = index.get(path);
  assert.ok(e, `missing ${path}`);
  assert.equal(e.segments.length, segs, `${path} segment count`);
  assert.equal(e.size, size, `${path} declared size`);
  const bytes = readEntry(e);
  assert.equal(bytes.length, size, `${path} reassembled size`);
  magic.forEach((v, k) => assert.equal(bytes[k], v, `${path} byte ${k} -- a wrong offset reads garbage`));
}

// dropping the inline prefix silently truncates a file's first bytes
assert.ok(index.get("audio/theme.ogg").segments.some((s) => s.prefix?.length === 8),
  "the inline prefix must be preserved");

// anything that is not an archive must be refused, never guessed at
assert.equal(parseRpaHeader(new TextEncoder().encode("PK not an rpa")), null);
assert.equal(parseRpaHeader(new Uint8Array(0)), null);
assert.throws(() => unpickle(new Uint8Array([0xff, 0xff])), /unsupported opcode/,
  "an unknown opcode must throw rather than return a partial index");

console.log("rpa index ok - real RPA-3.0, prefix, multi-segment, unicode path");
