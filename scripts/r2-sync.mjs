// Upload the local R2 mirror (r2/<dir>/...) to the abhishekstation-assets
// bucket with the right content types. Run after adding or replacing a binary:
//   node scripts/r2-sync.mjs            # everything under r2/
//   node scripts/r2-sync.mjs quake      # one directory
// The Pages Functions under functions/<dir>/ serve these keys same-origin.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BUCKET = "abhishekstation-assets";
const TYPES = { wasm: "application/wasm", data: "application/octet-stream", mpq: "application/octet-stream", zip: "application/zip", bin: "application/octet-stream", tar: "application/x-tar", js: "text/javascript" };
const root = "r2";
const only = process.argv[2];

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (!n.startsWith(".")) out.push(p);
  }
  return out;
};
const files = walk(only ? join(root, only) : root);
for (const f of files) {
  const key = relative(root, f).split("\\").join("/");
  const type = TYPES[key.split(".").pop()] ?? "application/octet-stream";
  const mb = (statSync(f).size / 1048576).toFixed(1);
  process.stdout.write(`${key} (${mb} MB) … `);
  execFileSync("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", f, "--content-type", type, "--remote"], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("ok");
}
console.log(`${files.length} object(s) synced to ${BUCKET}`);
