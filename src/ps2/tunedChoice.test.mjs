// This module decides whether a game's tuning applies at all, so the two
// things worth pinning down are that declining it declines ALL of it — a
// half-applied override is the worst of both — and that a player's explicit
// choice always beats our recommendation.
import assert from "node:assert/strict";

// localStorage, enough of it, plus a switch to make it throw the way a private
// window does — the module has to survive that without losing the default.
let store = new Map();
let blocked = false;
globalThis.localStorage = {
  getItem: (k) => { if (blocked) throw new Error("blocked"); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (blocked) throw new Error("blocked"); store.set(k, String(v)); },
  removeItem: (k) => { if (blocked) throw new Error("blocked"); store.delete(k); },
};

const {
  readChoice, writeChoice, clearChoice, recommends, effectiveChoice, activeOverride,
} = await import("./tunedChoice.ts");

const ID = "SLUS-21198";
const FULL = { why: "verified to the end of the first level", clock: "full", res: 2, knobs: { patch: [{ address: "1", value: "2" }] } };

// —— nothing known about a game means standard, always ————————————————————
assert.equal(effectiveChoice(null, FULL), "standard", "no title id — nothing to key a choice on");
assert.equal(effectiveChoice(ID, null), "standard", "no override — nothing to apply");
assert.equal(activeOverride(ID, null), null);
assert.equal(activeOverride(null, FULL), null);

// —— our recommendation is the default ————————————————————————————————————
store.clear();
assert.equal(recommends(FULL), true, "an override exists because a game needed it");
assert.equal(recommends({ ...FULL, recommend: false }), false, "unless it says otherwise");
assert.equal(recommends(null), false);
assert.equal(effectiveChoice(ID, FULL), "tuned");
assert.equal(effectiveChoice(ID, { ...FULL, recommend: false }), "standard",
  "tuning we are less sure of has to be asked for");

// —— the player's choice beats the recommendation, both ways ————————————————
store.clear();
writeChoice(ID, "standard");
assert.equal(readChoice(ID), "standard");
assert.equal(effectiveChoice(ID, FULL), "standard", "declined, even though we recommend it");
writeChoice(ID, "tuned");
assert.equal(effectiveChoice(ID, { ...FULL, recommend: false }), "tuned", "asked for, even though we did not");
clearChoice(ID);
assert.equal(readChoice(ID), null, "cleared — back to the recommendation");
assert.equal(effectiveChoice(ID, FULL), "tuned");

// —— declining declines ALL of it ————————————————————————————————————————
store.clear();
writeChoice(ID, "standard");
assert.equal(activeOverride(ID, FULL), null,
  "not the clock, not the resolution, not the knobs — a half-applied override is the worst case");
writeChoice(ID, "tuned");
assert.deepEqual(activeOverride(ID, FULL), FULL, "accepted means the whole thing");

// —— the choice is per game ——————————————————————————————————————————————
store.clear();
writeChoice(ID, "standard");
assert.equal(effectiveChoice("SLUS-21209", FULL), "tuned",
  "declining one game must not decline every other disc");

// —— junk in storage, and storage that throws ——————————————————————————————
store.clear();
store.set("asp.ps2.tuned." + ID, "banana");
assert.equal(readChoice(ID), null, "an unrecognised value is not a choice");
assert.equal(effectiveChoice(ID, FULL), "tuned", "and falls back to the recommendation");

blocked = true;
assert.equal(readChoice(ID), null, "private mode does not throw out of readChoice");
assert.equal(effectiveChoice(ID, FULL), "tuned", "the recommendation still applies");
assert.doesNotThrow(() => writeChoice(ID, "standard"), "a blocked write is not an error");
assert.doesNotThrow(() => clearChoice(ID));
blocked = false;

// —— a title id becomes a storage key, so it is checked ————————————————————
store.clear();
for (const bad of ["", "nonsense", "../../x", "SLUS-2119", "slus-21198", "SLUS-21198 "]) {
  assert.equal(readChoice(bad), null, `${JSON.stringify(bad)} is not a title id`);
  writeChoice(bad, "tuned");
}
assert.equal(store.size, 0, "no key was written for any malformed id");

console.log("tunedChoice ok");
