// Self-check for the practice-mode hit logic. Run: npx tsx src/practice.test.ts
import { strict as assert } from "node:assert";
import { HIT_WINDOW, LESSONS, PracticeRun } from "./practice";

// —— every lesson is playable on Studio's two octaves (C4..D5 = 60..74) ——
for (const l of LESSONS) {
  assert.ok(l.notes.length > 0, `${l.id} has notes`);
  for (const n of l.notes) {
    assert.ok(n.midi >= 60 && n.midi <= 74, `${l.id}: ${n.midi} is outside Studio's keys`);
    assert.ok(n.len > 0, `${l.id}: note length must be positive`);
  }
  // notes must be in time order — the falling-note renderer assumes it
  for (let i = 1; i < l.notes.length; i++) {
    assert.ok(l.notes[i].at >= l.notes[i - 1].at, `${l.id}: notes out of order at ${i}`);
  }
}

const twinkle = LESSONS.find((l) => l.id === "twinkle")!;
const scale = LESSONS.find((l) => l.id === "scale")!;

// —— a perfect run ——
{
  const run = new PracticeRun(twinkle);
  for (const n of twinkle.notes) run.play(n.midi, n.at);
  assert.equal(run.hits, twinkle.notes.length);
  assert.equal(run.misses, 0);
  assert.equal(run.percent, 100);
  assert.ok(run.done);
}

// —— wrong note never counts ——
{
  const run = new PracticeRun(twinkle);
  assert.equal(run.play(61, twinkle.notes[0].at), -1, "C# is not C");
  assert.equal(run.hits, 0);
}

// —— outside the window never counts ——
// Uses the scale, whose adjacent notes differ in pitch: on a lesson that opens
// with a repeated note, "too late for the first" can legitimately be "in time
// for the second", which would make this assertion meaningless.
{
  const run = new PracticeRun(scale);
  const n = scale.notes[0];
  assert.equal(run.play(n.midi, n.at + HIT_WINDOW + 0.05), -1, "too late");
  assert.equal(run.play(n.midi, n.at - HIT_WINDOW - 0.05), -1, "too early");
  assert.ok(run.play(n.midi, n.at + HIT_WINDOW * 0.9) >= 0, "just inside is a hit");
}

// —— ★ repeated notes: one press must not consume the wrong one ——
// Twinkle opens C C — pressing C once must satisfy exactly one, and pressing it
// near the SECOND one must claim the second, not the already-passed first.
{
  const run = new PracticeRun(twinkle);
  const [n0, n1] = twinkle.notes;
  assert.equal(n0.midi, n1.midi, "test assumes the first two notes repeat");
  const got = run.play(n1.midi, n1.at);
  assert.equal(got, 1, "a press at the second note's time must claim the SECOND note");
  assert.equal(run.hits, 1, "one press = one hit");
  // the first is still available until its window closes
  assert.equal(run.play(n0.midi, n0.at), 0);
  assert.equal(run.hits, 2);
}

// —— tick closes the window and books a miss, exactly once ——
{
  const run = new PracticeRun(twinkle);
  run.tick(twinkle.notes[0].at + HIT_WINDOW + 0.01);
  assert.equal(run.misses, 1);
  run.tick(twinkle.notes[0].at + HIT_WINDOW + 0.02);
  assert.equal(run.misses, 1, "a missed note must not be counted twice");
  // and a late press can't rescue it
  assert.equal(run.play(twinkle.notes[0].midi, twinkle.notes[0].at), -1);
}

// —— a run of nothing is 0%, not NaN ——
{
  const run = new PracticeRun(twinkle);
  assert.equal(run.percent, 0);
  run.tick(9999);
  assert.equal(run.misses, twinkle.notes.length);
  assert.equal(run.percent, 0);
  assert.ok(run.done);
}

// —— ★ OVERLAPPING windows must still resolve correctly ——
// Ode to Joy has two Ds only 0.31s apart, so at a 0.2s window their hit ranges
// genuinely overlap. That's musically legitimate (a quaver pickup), so the
// matcher has to cope rather than the songs having to avoid it: "closest
// unclaimed note wins" must attribute each press to the note it was aimed at.
{
  const ode = LESSONS.find((l) => l.id === "ode")!;
  let pair = -1;
  for (let i = 1; i < ode.notes.length; i++) {
    if (ode.notes[i].midi === ode.notes[i - 1].midi &&
        ode.notes[i].at - ode.notes[i - 1].at < HIT_WINDOW * 2) { pair = i - 1; break }
  }
  assert.ok(pair >= 0, "expected Ode to contain an overlapping repeated pair");
  const a = ode.notes[pair], b = ode.notes[pair + 1];

  const run = new PracticeRun(ode);
  assert.equal(run.play(a.midi, a.at), pair, "a press at the first note's time claims the first");
  assert.equal(run.play(b.midi, b.at), pair + 1, "the next press claims the second, not a re-hit");
  assert.equal(run.hits, 2, "two presses, two distinct notes");

  // and out of order: a press aimed at the SECOND must not steal the first
  const run2 = new PracticeRun(ode);
  assert.equal(run2.play(b.midi, b.at), pair + 1, "closest wins, even when an earlier note is unclaimed");
}

// every lesson plays perfectly when every note is hit on time — the real
// end-to-end guarantee, overlaps and all
for (const l of LESSONS) {
  const run = new PracticeRun(l);
  for (const n of l.notes) run.play(n.midi, n.at);
  assert.equal(run.hits, l.notes.length, `${l.id}: a perfect run must hit every note`);
  assert.equal(run.percent, 100, `${l.id}: perfect run = 100%`);
}

console.log("practice: hit logic ok");
