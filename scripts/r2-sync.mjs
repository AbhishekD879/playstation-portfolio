// Upload the local R2 mirror (r2/<dir>/...) to the abhishekstation-assets
// bucket with the right content types. Run after adding or replacing a binary:
//   node scripts/r2-sync.mjs            # everything under r2/
//   node scripts/r2-sync.mjs quake      # one directory
// The Pages Functions under functions/<dir>/ serve these keys same-origin.
//
// Files over 300 MiB are split. Wrangler refuses to put anything larger —
//   "Wrangler only supports uploading files up to 300 MiB in size"
// — and it has no multipart mode, so a big data package cannot be uploaded
// whole with an OAuth login. Such a file goes up as <key>.part0, <key>.part1, …
// and functions/r2serve.ts stitches them back together on the way out, which
// the browser cannot tell apart from a single object. Endless Sky's 383 MiB
// package is the first to need this; it will not be the last.
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";

const BUCKET = "abhishekstation-assets";
const TYPES = { wasm: "application/wasm", data: "application/octet-stream", mpq: "application/octet-stream", zip: "application/zip", bin: "application/octet-stream", tar: "application/x-tar", js: "text/javascript" };
const root = "r2";
const only = process.argv[2];

/** Wrangler's hard ceiling. Parts are smaller so a file just over the line
 *  still splits into two sane halves rather than one part plus a sliver. */
const MAX_PUT = 300 * 1024 * 1024;
const PART = 200 * 1024 * 1024;

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (!n.startsWith(".")) out.push(p);
  }
  return out;
};

const put = (key, file, type) =>
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type, "--remote"],
    { stdio: ["ignore", "ignore", "inherit"] });

const files = walk(only ? join(root, only) : root);
let objects = 0;

for (const f of files) {
  const key = relative(root, f).split("\\").join("/");
  const type = TYPES[key.split(".").pop()] ?? "application/octet-stream";
  const size = statSync(f).size;
  process.stdout.write(`${key} (${(size / 1048576).toFixed(1)} MB) … `);

  if (size <= MAX_PUT) {
    put(key, f, type);
    objects++;
    console.log("ok");
    continue;
  }

  // too big for one put: slice it, upload the slices, throw the slices away
  const stage = join(tmpdir(), `r2-parts-${process.pid}`);
  mkdirSync(stage, { recursive: true });
  const parts = Math.ceil(size / PART);
  process.stdout.write(`split into ${parts} … `);
  try {
    for (let i = 0; i < parts; i++) {
      const start = i * PART;
      const end = Math.min(start + PART, size) - 1;   // createReadStream's end is inclusive
      const slice = join(stage, `part${i}`);
      await pipeline(createReadStream(f, { start, end }), createWriteStream(slice));
      put(`${key}.part${i}`, slice, type);
      objects++;
      rmSync(slice, { force: true });
      process.stdout.write(`${i + 1}/${parts} `);
    }
    console.log("ok");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
console.log(`${objects} object(s) synced to ${BUCKET}`);
