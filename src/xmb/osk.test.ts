// The on-screen keyboard's delete key. Part of `npm test`.
//
// This is here because the bug it guards was invisible: delete did nothing at
// all on the room-code screens while typing worked perfectly, so it read as
// "there is no way to fix a typo" rather than as an error. The cause was a
// collapsed caret at position 0 falling into the "remove the selection" branch,
// which removes an empty range.
//
// An input driven entirely by a gamepad is never focused, and an unfocused
// field reports selectionStart 0 — so that was the normal case on a TV, not an
// edge case.
import { strict as assert } from "node:assert";
import { applyBackspace } from "./oskEdit.ts";

// —— the ordinary case ————————————————————————————————————————————————————
{
  assert.deepEqual(applyBackspace("ABCD", 4, 4), ["ABC", 3], "caret at the end takes the last character");
  assert.deepEqual(applyBackspace("ABCD", 2, 2), ["ACD", 1], "caret mid-string takes the one before it");
  assert.deepEqual(applyBackspace("A", 1, 1), ["", 0], "down to empty");
}

// —— a selection is removed whole ——————————————————————————————————————————
{
  assert.deepEqual(applyBackspace("ABCD", 1, 3), ["AD", 1], "a range goes in one press");
  assert.deepEqual(applyBackspace("ABCD", 0, 4), ["", 0], "select-all then delete clears it");
}

// —— THE BUG: a collapsed caret at 0 must still delete ————————————————————
{
  // Previously this returned ["ABCD", 0] — a no-op, every time, with no error.
  assert.deepEqual(applyBackspace("ABCD", 0, 0), ["ABC", 3],
    "a pad-driven field reports caret 0; delete must still remove something, " +
    "or the player has no way to correct a mistyped code");
  assert.deepEqual(applyBackspace("A", 0, 0), ["", 0], "works down to the last character");
}

// —— nothing to delete ————————————————————————————————————————————————————
{
  assert.deepEqual(applyBackspace("", 0, 0), ["", 0], "empty stays empty rather than throwing");
}

// —— the caret it reports is always usable ————————————————————————————————
{
  for (const [cur, s, e] of [
    ["ABCD", 4, 4], ["ABCD", 0, 0], ["ABCD", 2, 2], ["ABCD", 1, 3], ["", 0, 0], ["A", 0, 0],
  ] as [string, number, number][]) {
    const [next, caret] = applyBackspace(cur, s, e);
    assert.ok(caret >= 0 && caret <= next.length,
      `caret ${caret} out of range for ${JSON.stringify(next)} (from ${JSON.stringify(cur)} ${s},${e})`);
  }
}

console.log("osk: ok");
