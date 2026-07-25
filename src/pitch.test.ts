// Self-check for the karaoke scoring maths. Run: npx tsx src/pitch.test.ts
// The YIN worklet itself needs an audio thread, so it's verified in the browser;
// what's checked here is the octave-folding and scoring, where an off-by-one
// silently makes every score wrong without ever throwing.
import { strict as assert } from "node:assert";
import { SingScore, centsOff, hzToMidi, midiToHz, noteName, rankFor, scoreFor } from "./pitch";

// —— frequency ↔ note ————————————————————————————————————————————————————
assert.equal(Math.round(hzToMidi(440)), 69);              // A4
assert.equal(Math.round(hzToMidi(261.63)), 60);           // middle C
assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
assert.equal(noteName(69), "A4");
assert.equal(noteName(60), "C4");

// —— cents, with octave folding ——————————————————————————————————————————
assert.equal(Math.round(centsOff(69, 69)), 0);            // dead on
assert.equal(Math.round(centsOff(69.5, 69)), 50);         // quarter-tone sharp
assert.equal(Math.round(centsOff(68.5, 69)), -50);        // quarter-tone flat
// the whole point: an octave down is the SAME note, not 1200 cents of error
assert.equal(Math.round(centsOff(57, 69)), 0, "octave down must score as correct");
assert.equal(Math.round(centsOff(81, 69)), 0, "octave up must score as correct");
assert.equal(Math.round(centsOff(45, 69)), 0, "two octaves down must score as correct");
// a tritone is the worst possible miss, and must not wrap to something small
assert.equal(Math.abs(Math.round(centsOff(75, 69))), 600);

// —— score curve ——————————————————————————————————————————————————————————
assert.equal(scoreFor(0), 1);
assert.equal(scoreFor(100), 0);
assert.equal(scoreFor(-100), 0);
assert.ok(Math.abs(scoreFor(50) - 0.5) < 1e-9);
assert.equal(scoreFor(600), 0);

// —— accumulation ——————————————————————————————————————————————————————————
const s = new SingScore();
// frames where the ORIGINAL isn't singing must not count at all — otherwise an
// instrumental intro tanks a perfect performance
for (let i = 0; i < 100; i++) s.push(null, null);
assert.equal(s.sungFrames, 0, "silent-target frames must not be counted");
assert.equal(s.percent, 0);

for (let i = 0; i < 10; i++) s.push(69, 69);              // ten perfect frames
assert.equal(s.percent, 100);
assert.equal(s.accuracy, 100);
assert.equal(s.currentStreak, 10);

for (let i = 0; i < 10; i++) s.push(75, 69);              // ten tritone misses
assert.equal(s.percent, 50, "half perfect, half zero");
assert.equal(s.accuracy, 50);
assert.equal(s.currentStreak, 0, "a miss must break the streak");
assert.equal(s.best, 10, "best streak is remembered");

// not singing at all while the original sings counts as a missed frame
const q = new SingScore();
q.push(null, 69);
assert.equal(q.sungFrames, 1);
assert.equal(q.percent, 0);

s.reset();
assert.equal(s.percent, 0);
assert.equal(s.best, 0);

// —— ranks are ordered and cover the range ————————————————————————————————
assert.equal(rankFor(95), "PERFECT");
assert.equal(rankFor(80), "GREAT");
assert.equal(rankFor(60), "GOOD");
assert.equal(rankFor(40), "OK");
assert.equal(rankFor(0), "KEEP PRACTISING");

console.log("pitch: scoring ok");
