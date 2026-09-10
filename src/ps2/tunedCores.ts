// Per-game emulator builds.
//
// Some games need a change to the emulator itself, not a setting. Batman Begins
// needed one to stop hanging; the fix for its glow pass changes how every game
// that samples its own render target draws. Making that change in the one core
// everything boots means one game's fix is every game's risk.
//
// So: a game that has been worked out gets its own build, from its own branch
// of the fork, and only discs we have matched to it ever load it. The shared
// core stays the thing that works for everything else, untouched.
//
// This is the same shape as the existing engine switch (engineChoice.ts maps a
// choice to a directory, engineRouter probes whether the build is really
// deployed) — a tuned core is one more directory, chosen by title id instead of
// by a preference.
//
// The registry is shipped in code on purpose. The override table it is used
// from lives in KV, which an admin edits by hand; if a core id were a free
// string, a bad write there would point the emulator frame at an arbitrary
// path. Selecting among builds we have deployed is all KV gets to do.

export interface TunedCore {
  /** Directory under public/, as `play-<id>`. Also the id used in overrides. */
  id: string;
  /** Which fork branch builds it, so it can be rebuilt or rebased. */
  branch: string;
  /** What it changes, and why that should not go in the shared core. */
  why: string;
}

/** Every core a disc is allowed to be routed to. Add a build here before
 *  referencing it from an override, or the override is ignored. */
export const TUNED_CORES: readonly TunedCore[] = [
  // Nothing shipped yet. The Batman Begins glow build exists on the fork at
  // diag/stall-hunting but is not better than the shared core yet — it renders
  // the glow the shared core drops, and still saturates on some frames — so no
  // disc is pointed at it.
];

const BY_ID = new Map(TUNED_CORES.map((c) => [c.id, c]));

/** Shape check first, then membership. Both, because the shape rules out a
 *  path even if the registry is ever built from something less trusted. */
const ID_SHAPE = /^[a-z0-9][a-z0-9-]{0,30}$/;

export function isTunedCore(id: unknown): id is string {
  return typeof id === "string" && ID_SHAPE.test(id) && BY_ID.has(id);
}

export function tunedCore(id: string): TunedCore | null {
  return BY_ID.get(id) ?? null;
}

/** The frame URL for a tuned core. Callers must have checked isTunedCore. */
export const tunedCoreUrl = (id: string) => `/play-${id}/index.html`;

// —— is it actually deployed? ——————————————————————————————————————————————
//
// Same guarantee the multitap engine gives: a core that is missing or failed to
// upload must degrade to "this game runs on the shared build", never to a blank
// screen. One HEAD per core, remembered for the life of the page.

const probes = new Map<string, Promise<boolean>>();

export function tunedCoreAvailable(id: string, doFetch: typeof fetch = fetch): Promise<boolean> {
  if (!isTunedCore(id)) return Promise.resolve(false);
  let probe = probes.get(id);
  if (!probe) {
    probe = doFetch(`/play-${id}/Play.wasm`, { method: "HEAD" })
      .then((r) => r.ok)
      .catch(() => false);
    probes.set(id, probe);
  }
  return probe;
}

/** Only for tests — the probe cache is per-page otherwise. */
export function resetTunedCoreProbes(): void {
  probes.clear();
}
