// The loop that wedged the tab: a short chunk must raise, never spin.
import assert from "node:assert/strict";

const CHUNK = 1024 * 1024;
const make = (chunkFor) => (file, buffer, offset, length, position) => {
  if (position >= file.size) return 0;
  const size = Math.min(file.size - position, length);
  let done = 0;
  while (done < size) {
    const at = position + done;
    const index = (at / CHUNK) | 0;
    const within = at - index * CHUNK;
    const chunk = chunkFor(index);
    const take = Math.min(chunk.length - within, size - done);
    if (take <= 0) throw new Error(`no progress at ${at}: chunk ${index} holds ${chunk.length}, needed ${within}`);
    buffer.set(chunk.subarray(within, within + take), offset + done);
    done += take;
  }
  return done;
};

const file = { key: "t", size: 3 * CHUNK };
const buf = new Uint8Array(4096);

// healthy: full chunks, read completes
const ok = make(() => new Uint8Array(CHUNK).fill(7));
assert.equal(ok(file, buf, 0, 4096, 0), 4096, "a normal read returns what was asked");
assert.equal(buf[0], 7, "and actually copies bytes");

// the failure that hung it: an empty chunk where bytes were expected
const empty = make(() => new Uint8Array(0));
assert.throws(() => empty(file, buf, 0, 4096, 0), /no progress/, "an empty chunk must raise, not spin");

// a short chunk read from beyond its end
const short = make(() => new Uint8Array(16));
assert.throws(() => short(file, buf, 0, 4096, 1000), /no progress/, "a short chunk must raise too");

console.log("lazyRead ok · a chunk that cannot satisfy the read raises instead of looping");
