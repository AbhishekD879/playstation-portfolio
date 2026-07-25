// Falling-notes practice for Studio.
//
// Studio already plays a plugged-in MIDI keyboard; what it couldn't do was
// teach you anything. This is the missing half: notes fall toward a hit line
// and you play them. Pure logic, no DOM — the component owns the drawing, this
// owns "is that the right note at the right time", which is the part worth
// testing.

/** One note in a lesson: when it lands, and what to play. */
export interface Note { at: number; midi: number; len: number } // seconds, MIDI, seconds

export interface Lesson { id: string; name: string; sub: string; bpm: number; notes: Note[] }

/** Build a lesson from a compact "midi:beats" score so the tunes stay readable. */
function score(id: string, name: string, sub: string, bpm: number, seq: [number, number][]): Lesson {
  const spb = 60 / bpm;
  let t = 0;
  const notes: Note[] = [];
  for (const [midi, beats] of seq) {
    if (midi > 0) notes.push({ at: t, midi, len: beats * spb * 0.9 });
    t += beats * spb;
  }
  return { id, name, sub, bpm, notes };
}

// Public-domain melodies only — all far older than any copyright term, which is
// why they're safe to ship in a portfolio. Ranges sit inside Studio's two
// octaves from C4 so every note is playable on the on-screen keys.
const R = 0; // rest
export const LESSONS: Lesson[] = [
  score("ode", "Ode to Joy", "Beethoven, 1824 · start here", 96, [
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
    [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
  ]),
  score("twinkle", "Twinkle, Twinkle", "traditional · easiest", 100, [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  ]),
  score("scale", "C Major Scale", "up and down · warm-up", 110, [
    [60, 1], [62, 1], [64, 1], [65, 1], [67, 1], [69, 1], [71, 1], [72, 1],
    [71, 1], [69, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 2],
  ]),
  score("greensleeves", "Greensleeves", "traditional, c.1580 · a longer phrase", 90, [
    [69, 1], [72, 1], [74, 1.5], [71, 0.5], [69, 1], [67, 1],
    [65, 1.5], [64, 0.5], [62, 1], [R, 1],
    [64, 1], [65, 1], [67, 1.5], [65, 0.5], [64, 1], [62, 1], [60, 2],
  ]),
];

/**
 * How close in time counts as a hit — forgiving, since this is practice rather
 * than a rhythm game. Kept below half the shortest gap we use (0.55s at the
 * fastest lesson tempo) so two adjacent notes of the SAME pitch never have
 * overlapping windows; otherwise one press could ambiguously satisfy either.
 */
export const HIT_WINDOW = 0.2; // seconds either side

export type NoteState = "waiting" | "hit" | "missed";

/**
 * Tracks a run through a lesson. The component feeds it the clock and key
 * presses; it decides what was hit.
 */
export class PracticeRun {
  readonly lesson: Lesson;
  readonly states: NoteState[];
  hits = 0;
  misses = 0;

  constructor(lesson: Lesson) {
    this.lesson = lesson;
    this.states = lesson.notes.map(() => "waiting");
  }

  get total() { return this.lesson.notes.length }
  get done() { return this.hits + this.misses >= this.total }
  get percent() { return this.total ? Math.round((this.hits / this.total) * 100) : 0 }
  get length() { return this.lesson.notes.reduce((m, n) => Math.max(m, n.at + n.len), 0) }

  /**
   * A key was played at time `now`. Returns the note index it satisfied, or -1.
   * Matches the CLOSEST unplayed note of that pitch inside the window — with
   * repeated notes (Twinkle opens with two Cs) matching the first one found
   * would let a single early press consume the wrong one.
   */
  play(midi: number, now: number): number {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < this.lesson.notes.length; i++) {
      if (this.states[i] !== "waiting") continue;
      const n = this.lesson.notes[i];
      if (n.midi !== midi) continue;
      const dist = Math.abs(n.at - now);
      if (dist <= HIT_WINDOW && dist < bestDist) { best = i; bestDist = dist }
    }
    if (best >= 0) { this.states[best] = "hit"; this.hits++ }
    return best;
  }

  /** Advance the clock; anything whose window has closed is a miss. */
  tick(now: number) {
    for (let i = 0; i < this.lesson.notes.length; i++) {
      if (this.states[i] !== "waiting") continue;
      if (now > this.lesson.notes[i].at + HIT_WINDOW) { this.states[i] = "missed"; this.misses++ }
    }
  }
}
