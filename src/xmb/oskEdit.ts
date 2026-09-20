// Text editing rules for the on-screen keyboard.
//
// Separated from the component so they can be tested without a DOM: the bug
// that prompted this was invisible at runtime — delete did nothing on the
// room-code screens while typing worked — and a rule with no test is exactly
// how that survives.

/** What a backspace should do to `cur` given a selection.
 *
 *  Exported and named because the inline version had a hole: with a collapsed
 *  caret at 0 it fell to the "delete the selection" branch, which deletes an
 *  empty range — a no-op. An input driven entirely by the pad never focuses,
 *  and an unfocused field reports selectionStart 0, so delete did nothing at
 *  all while typing kept working. Now a collapsed caret at 0 in a field that
 *  HAS text takes the last character, which is what someone pressing delete on
 *  a code they cannot see a caret in means. */
export function applyBackspace(cur: string, s: number, e: number): [string, number] {
  if (s !== e) return [cur.slice(0, s) + cur.slice(e), s];   // drop the selection
  if (s > 0) return [cur.slice(0, s - 1) + cur.slice(s), s - 1];
  if (cur.length > 0) return [cur.slice(0, -1), Math.max(0, cur.length - 1)];
  return [cur, 0];
}
