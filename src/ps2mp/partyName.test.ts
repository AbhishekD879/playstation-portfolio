// Self-check for the remembered display name. Node has no localStorage, so a
// minimal stand-in exercises the real code paths — including the one where
// storage throws, which is Safari in private mode and must not break a join.
import assert from "node:assert/strict";

const store = new Map<string, string>();
let throws = false;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => { if (throws) throw new Error("denied"); return store.get(k) ?? null; },
  setItem: (k: string, v: string) => { if (throws) throw new Error("denied"); store.set(k, v); },
  removeItem: (k: string) => { if (throws) throw new Error("denied"); store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const { readPartyName, writePartyName, partyNameAsked, skipPartyName, isDefaultName } =
  await import("./partyName");

// nothing stored yet: the profile name is a fallback, not an answer
assert.equal(partyNameAsked(), false);
assert.equal(readPartyName("Abhishek"), "Abhishek");
assert.equal(readPartyName(), "Player", "no fallback either → never blank");

// choosing one remembers it and counts as asked
assert.equal(writePartyName("  Ravi  "), "Ravi", "trimmed");
assert.equal(readPartyName("Abhishek"), "Ravi", "the chosen name wins over the profile");
assert.equal(partyNameAsked(), true);

// it is still untrusted input on the way in
assert.equal(writePartyName("Neha"), "Neha", "control characters stripped");
assert.equal(writePartyName("x".repeat(80)).length, 18, "clamped");

// clearing falls back to the profile, and stays "asked" so we don't nag
assert.equal(writePartyName("   "), "", "blank clears");
assert.equal(readPartyName("Abhishek"), "Abhishek");
assert.equal(partyNameAsked(), true);

// skipping is an answer
store.clear();
assert.equal(partyNameAsked(), false);
skipPartyName();
assert.equal(partyNameAsked(), true);
assert.equal(readPartyName("Abhishek"), "Abhishek", "skipping keeps the profile name");

// the console's own placeholder is not a name worth pre-filling
assert.equal(isDefaultName("PLAYER 1"), true);
assert.equal(isDefaultName("player"), true);
assert.equal(isDefaultName("Player 12"), true);
assert.equal(isDefaultName("Abhishek"), false);
assert.equal(isDefaultName("Player One"), false, "a typed name that starts with Player is real");

// storage that refuses must not throw through to the caller
throws = true;
assert.equal(readPartyName("Abhishek"), "Abhishek", "unreadable storage falls back");
assert.equal(partyNameAsked(), false);
assert.equal(writePartyName("Sam"), "Sam", "still usable for this session");
skipPartyName();
throws = false;

console.log("partyName: remembered name ok");
