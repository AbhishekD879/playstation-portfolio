// Every free game points at a real system, an https file, and an extension that
// system accepts — and relayed hosts are the ones the relay actually allows.
import assert from "node:assert/strict";
const { FREE_GAMES, RELAY_HOSTS, downloadUrl, fileNameOf } = await import("./freegames.ts");
const { SYSTEMS, SHARED_EXTS, classifyFile } = await import("./systems.ts");
const ids = new Set();
for (const g of FREE_GAMES) {
  assert.ok(!ids.has(g.id), `${g.id} duplicated`); ids.add(g.id);
  assert.ok(SYSTEMS[g.system], `${g.id}: unknown system ${g.system}`);
  assert.match(g.url, /^https:\/\//, `${g.id}: https only`);
  assert.ok(g.title && g.author && g.licence && g.note, `${g.id}: complete`);
  const cls = classifyFile(fileNameOf(g), [g.system]);
  assert.ok(cls && !("choose" in cls) && cls.core === g.system, `${g.id}: ${fileNameOf(g)} would not land on ${g.system}`);
  if (g.relay) assert.ok(RELAY_HOSTS.includes(new URL(g.url).hostname), `${g.id}: relayed host must be allow-listed`);
  else assert.ok(!RELAY_HOSTS.includes(new URL(g.url).hostname), `${g.id}: allow-listed host should use the relay`);
}
assert.equal(downloadUrl(FREE_GAMES[0]), "/api/rom?url=" + encodeURIComponent(FREE_GAMES[0].url));
assert.equal(fileNameOf({ url: "https://x/y/gridlee.zip?v=1" }), "gridlee.zip");
void SHARED_EXTS;
console.log("free games ok");
