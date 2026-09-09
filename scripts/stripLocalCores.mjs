// Keep local-only emulator builds out of a deploy.
//
// public/ is copied into dist wholesale, and .gitignore has no say in that — so
// a diagnostic core sitting in public/ for local debugging rides along into
// production unless something removes it. It happened once: play-diag (CPU
// sampling bindings, CLog enabled) and play-oph (an A/B baseline) were both
// live, 7.3 MB of cores nobody should be served.
//
// These directories are gitignored by the same names, so this list and
// .gitignore have to agree.
import { rmSync, existsSync } from "node:fs";

const LOCAL_ONLY = ["dist/play-diag", "dist/play-oph"];

let removed = 0;
for (const dir of LOCAL_ONLY) {
  if (!existsSync(dir)) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log("stripped local-only core:", dir);
  removed++;
}
console.log(`local cores stripped: ${removed}`);
