// What other people in a room call you.
//
// The profile name is local and defaults to "PLAYER 1", so three strangers in
// one room were three rows all reading PLAYER 1 — the pad number told them
// apart, but only if you looked for it. A room needs to distinguish two people
// for an hour; it does not need accounts.
//
// So: one name, asked once, remembered on the device, and always optional. The
// distinction that matters is CHOSEN vs never-asked — a name someone typed is
// theirs, and the profile fallback is a guess we should stop showing off as one.

import { MAX_NAME, cleanName } from "./party";

const KEY = "asp.party.name";

/** Has this device ever been asked? Separate from "has a name", because
 *  deliberately skipping is an answer and must not re-prompt forever. */
const ASKED = "asp.party.named";

export function readPartyName(fallback?: string): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return cleanName(v);
  } catch {
    // Private-mode Safari throws on localStorage. A room still works without a
    // remembered name, so fall through rather than failing the join.
  }
  return cleanName(fallback);
}

/** True once the device has either chosen a name or declined to. */
export function partyNameAsked(): boolean {
  try { return localStorage.getItem(ASKED) === "1"; } catch { return false; }
}

/** Empty or whitespace clears the stored name and falls back to the profile. */
export function writePartyName(raw: string): string {
  const name = cleanName(raw);
  const keep = raw.trim().length > 0;
  try {
    if (keep) localStorage.setItem(KEY, name);
    else localStorage.removeItem(KEY);
    localStorage.setItem(ASKED, "1");
  } catch { /* nothing to remember it in; the session still has it */ }
  return keep ? name : "";
}

/** Record that we asked and they walked past it. */
export function skipPartyName(): void {
  try { localStorage.setItem(ASKED, "1"); } catch { /* ignore */ }
}

/** A profile name that is really just the console's default is a placeholder,
 *  not an answer — so the field starts empty and invites a real one. */
export const isDefaultName = (n: string) => /^player\s*\d*$/i.test(n.trim());

export { MAX_NAME };
