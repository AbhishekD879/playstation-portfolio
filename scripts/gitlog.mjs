// Repo Rewind data — parses this repo's own history into src/data/commits.json.
// Run manually (or before a deploy) with: node scripts/gitlog.mjs
// Kept out of the build so `npm run build` works from a tarball too.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const raw = execSync('git log --reverse --date=unix --pretty=format:"@%h|%ad|%s" --numstat', {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// debris that slipped into history before .gitignore caught up — test-runner
// artifacts and stray root-level debug screenshots. They were deleted from
// the tree long ago; keep them out of the replay too.
const junk = (p) =>
  p.startsWith(".playwright-cli/") ||
  p.startsWith("public/rpgm/easyrpg/") || // vendored EasyRPG engine + RTP (not our code)
  (/\.(png|jpe?g|webm)$/i.test(p) && !p.includes("/"));

const commits = [];
let cur = null;
for (const line of raw.split("\n")) {
  if (line.startsWith("@")) {
    const [h, d, ...rest] = line.slice(1).split("|");
    cur = { h, d: Number(d), s: rest.join("|").slice(0, 90), f: [] };
    commits.push(cur);
  } else if (cur && line.trim()) {
    const [add, del, ...path] = line.split("\t");
    const p = path.join("\t");
    if (!p) continue;
    // renames show as "old => new" — keep the new path
    const clean = p.includes("=>") ? p.replace(/^.*=>\s*/, "").replace(/[{}]/g, "") : p;
    if (junk(clean)) continue;
    cur.f.push([clean, add === "-" ? 0 : Number(add), del === "-" ? 0 : Number(del)]);
  }
}

mkdirSync(new URL("../src/data", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../src/data/commits.json", import.meta.url),
  JSON.stringify(commits),
);
console.log(`wrote ${commits.length} commits, ${commits.reduce((s, c) => s + c.f.length, 0)} file touches`);
