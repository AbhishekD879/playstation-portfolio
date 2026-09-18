// Keep public/gtavc/build.txt equal to the PAGE_BUILD constant in the host page.
//
// The page reloads itself when the two disagree, which is what stops a tab that has been open
// since before the lazy filesystem from running — and being killed by Chrome — for another day.
// That only works if the file is right, so it is generated rather than hand-edited.
import { readFileSync, writeFileSync } from "node:fs";

const PAGE = "public/gtavc/index.html";
const STAMP = "public/gtavc/build.txt";

let html;
try { html = readFileSync(PAGE, "utf8"); } catch { process.exit(0); }  // gitignored; absent in a clean clone

const found = html.match(/const PAGE_BUILD = "([^"]+)"/);
if (!found) {
  console.error("gtavc: PAGE_BUILD not found in the host page — build.txt left alone");
  process.exit(1);
}
writeFileSync(STAMP, found[1] + "\n");
console.log("gtavc build stamp:", found[1]);
