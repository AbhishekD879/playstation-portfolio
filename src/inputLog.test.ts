// Self-check for the input event ring.
// Run: npx tsx src/inputLog.test.ts
import { strict as assert } from "node:assert";
import { clearInput, inputEvents, logInput, subscribeInput } from "./inputLog";

clearInput();
logInput("a"); logInput("b");
assert.equal(inputEvents()[0].msg, "b", "newest first");
assert.equal(inputEvents().length, 2);

// ★ repeats collapse — a 60Hz poll must not erase the history behind it
clearInput();
logInput("poll"); logInput("poll"); logInput("poll");
assert.equal(inputEvents().length, 1, "duplicates collapse to one entry");
assert.equal(inputEvents()[0].n, 3, "…with a count");
logInput("other");
assert.equal(inputEvents().length, 2, "a different message starts a new entry");

// ★ bounded: spam cannot grow without limit
clearInput();
for (let i = 0; i < 500; i++) logInput("e" + i);
assert.ok(inputEvents().length <= 60, `ring stays bounded, got ${inputEvents().length}`);
assert.equal(inputEvents()[0].msg, "e499", "newest survives");

// —— subscribers get current state immediately, and on change ——
clearInput();
let seen: number[] = [];
const off = subscribeInput((e) => seen.push(e.length));
assert.deepEqual(seen, [0], "subscriber is called on subscribe");
logInput("x");
assert.deepEqual(seen, [0, 1], "…and on change");
off();
logInput("y");
assert.deepEqual(seen, [0, 1], "…and not after unsubscribing");

// —— never throws, whatever it is handed ——
clearInput();
for (const bad of [undefined, null, {}, 123]) logInput(bad as unknown as string);
assert.ok(true, "logInput never throws");

console.log("inputLog: ring ok");
