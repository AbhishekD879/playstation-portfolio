// Whether a disc runs on our per-game tuning, or the standard settings.
//
// Every override we ship was verified somewhere — Urban Reign at full clock,
// Batman Begins past its hang — but "verified somewhere" is not "verified to
// the end credits". A clock that fixes the intro can starve a later level; a
// knob found for one scene can be wrong for the next; a tuned build renders an
// effect the shared core drops and might saturate a room the shared core draws
// fine. We only ever tested as far as we tested.
//
// So the tuning is a recommendation, not a verdict, and the player can decline
// it. That also means an override no longer has to be proven strictly better
// everywhere before it can ship: it can ship as the option it actually is,
// labelled with what we checked.
//
// Remembered per title, because the answer is per game — a player who hits a
// wall in one game should not have to re-decide for every other disc.
//
// Switching restarts the game, since the clock, the knobs and the core are all
// latched at boot. The memory card is keyed independently of any of this, so a
// player who switches picks up from their last save rather than the beginning.

import type { Ps2Override } from "../ps2knobs";

export type TunedChoice = "tuned" | "standard";

const PREFIX = "asp.ps2.tuned.";

/** Title ids are `SLUS-21198`. Checked before it reaches a storage key. */
const TITLE_ID = /^[A-Z]{4}-\d{5}$/;

const keyFor = (titleId: string) => PREFIX + titleId;

/** What the player last chose for this game, or null if they never have. */
export function readChoice(titleId: string): TunedChoice | null {
  if (!TITLE_ID.test(titleId)) return null;
  try {
    const v = localStorage.getItem(keyFor(titleId));
    return v === "tuned" || v === "standard" ? v : null;
  } catch {
    return null; // private mode — fall back to the recommendation
  }
}

export function writeChoice(titleId: string, choice: TunedChoice): void {
  if (!TITLE_ID.test(titleId)) return;
  try {
    localStorage.setItem(keyFor(titleId), choice);
  } catch {
    /* nothing to do if storage is blocked; the recommendation still applies */
  }
}

export function clearChoice(titleId: string): void {
  if (!TITLE_ID.test(titleId)) return;
  try {
    localStorage.removeItem(keyFor(titleId));
  } catch {
    /* as above */
  }
}

/** Our default for a game we have tuned.
 *
 *  On, unless the override says otherwise. An override exists because a game
 *  needed it, so withholding it by default would mean shipping a fix nobody
 *  gets. `recommend: false` is for tuning we believe in less than that —
 *  something that fixes one thing and might cost another — which then has to
 *  be asked for. */
export const recommends = (over: Ps2Override | null | undefined) =>
  !!over && over.recommend !== false;

/** The choice that applies: what the player picked, else our recommendation.
 *  A game we have nothing for is always "standard". */
export function effectiveChoice(titleId: string | null, over: Ps2Override | null | undefined): TunedChoice {
  if (!titleId || !over) return "standard";
  return readChoice(titleId) ?? (recommends(over) ? "tuned" : "standard");
}

/** The override to actually apply, or null to run the disc on stock settings.
 *  Every consumer of an override should go through this, so that declining the
 *  tuning declines all of it — the clock and the knobs as well as the build. */
export function activeOverride(
  titleId: string | null,
  over: Ps2Override | null | undefined,
): Ps2Override | null {
  return effectiveChoice(titleId, over) === "tuned" ? (over ?? null) : null;
}
