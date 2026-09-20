// How loud the game is, for whoever is listening.
//
// Two people, two independent settings, and that separation is the whole point.
// A host playing alongside friends on a voice call turns the game down to hear
// them; that must not reach into the room and quieten the game for everyone
// watching. So the host's slider moves a gain on the SPEAKER branch only (see
// __setGameVolume in the emulator page, where the graph forks), the stream goes
// out at full level, and each joiner sets their own on the element playing it.
//
// Stored per role for the same reason: they are answers to different questions
// ("how loud next to my friends" vs "how loud next to the host's voice"), and
// sharing one number would make changing one silently change the other.

export type VolumeRole = "host" | "joiner";

const KEY: Record<VolumeRole, string> = {
  host: "asp.ps2.vol.game",
  joiner: "asp.ps2.vol.remote",
};

/** Full volume. The setting only ever attenuates — there is no boost, because
 *  gain above 1 clips a signal that is already mixed to full scale. */
export const DEFAULT_VOLUME = 1;

/** Coerce anything to a usable gain. Rejects NaN and out-of-range rather than
 *  letting a corrupt stored value mute the game with no way to tell why. */
export function clampVolume(v: unknown): number {
  // Number("") and Number(" ") are 0, not NaN — so an empty or blank stored
  // value would read as SILENCE and look exactly like the emulator having no
  // sound, with nothing to point at. Treat "no usable value" as full volume.
  if (typeof v === "string" && v.trim() === "") return DEFAULT_VOLUME;
  if (v === null || v === undefined) return DEFAULT_VOLUME;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, n));
}

export function readVolume(role: VolumeRole): number {
  try {
    const raw = localStorage.getItem(KEY[role]);
    if (raw === null) return DEFAULT_VOLUME;
    return clampVolume(raw);
  } catch {
    return DEFAULT_VOLUME; // private mode
  }
}

export function writeVolume(role: VolumeRole, v: number): number {
  const g = clampVolume(v);
  try { localStorage.setItem(KEY[role], String(g)); } catch { /* nothing to do */ }
  return g;
}

/** For the label on the slider. Rounded to whole percent so a drag does not
 *  produce a flickering "73.4%". */
export const volumePercent = (v: number) => Math.round(clampVolume(v) * 100);
