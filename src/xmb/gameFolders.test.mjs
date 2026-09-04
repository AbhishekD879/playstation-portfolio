// "No one knows where the games are" is the bug this file guards against: every
// id is placed once, folder ids are unique route segments, no folder is empty.
import assert from "node:assert/strict";
const { GAME_TOP, HIDDEN_GAME_ITEMS, folderOf, placedGameItemIds } = await import("./gameFolders.ts");

const seen = new Map();
for (const e of GAME_TOP) {
  const ids = e.kind === "folder" ? e.items : [e.id];
  for (const id of ids) { assert.ok(!seen.has(id), `${id} placed twice (${seen.get(id)} and ${e.kind === "folder" ? e.id : "top"})`); seen.set(id, e.kind === "folder" ? e.id : "top"); }
  if (e.kind === "folder") {
    assert.ok(e.items.length >= 2, `${e.id}: a folder with fewer than two items is just indirection`);
    assert.match(e.id, /^[a-z0-9-]+$/, `${e.id}: folder id must be a route segment`);
    assert.ok(e.title && e.blurb && e.icon, `${e.id}: needs title, blurb, icon`);
  }
}
const folderIds = GAME_TOP.filter((e) => e.kind === "folder").map((e) => e.id);
assert.equal(new Set(folderIds).size, folderIds.length, "folder ids unique");
for (const id of HIDDEN_GAME_ITEMS) assert.ok(!seen.has(id), `${id} is hidden and must not also be placed`);
assert.equal(folderOf("doom")?.id, "pc");
assert.equal(folderOf("nintendo"), undefined, "top-level items have no folder");
assert.ok(placedGameItemIds().has("ps2") && placedGameItemIds().has("nintendo"));
console.log("game folders ok");
