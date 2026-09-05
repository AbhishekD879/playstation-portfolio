// Every system and every web game must answer "how do I play this?" — keys or
// mouse, a controller line, a touch line, and which way to hold the phone.
import assert from "node:assert/strict";
const { SCHEMES, schemeFor } = await import("./controls.ts");
const { SYSTEMS } = await import("./systems.ts");
const { WEB_GAME_IDS } = await import("./webgames.ts");
const check = (id, s) => {
  assert.ok(s.keys.length || s.mouse, `${id}: no keys and no mouse`);
  for (const [k, what] of s.keys) assert.ok(k && what, `${id}: empty key row`);
  assert.ok(s.pad && s.touch, `${id}: controller and touch lines are required`);
  assert.ok(["landscape", "either"].includes(s.orientation), `${id}: orientation`);
};
for (const d of Object.values(SYSTEMS)) { assert.ok(SCHEMES[d.id], `${d.id}: needs its own controls card`); check(d.id, SCHEMES[d.id]); }
for (const id of WEB_GAME_IDS) { assert.ok(SCHEMES[id], `${id}: web game needs a controls card`); check(id, SCHEMES[id]); }
check("ps2", SCHEMES.ps2);
assert.equal(schemeFor("brand-new-system", "sega"), SCHEMES.segaMD, "unknown ids fall back by family");
assert.ok(schemeFor("nope").keys.length, "and never come back empty");
console.log("controls ok");
