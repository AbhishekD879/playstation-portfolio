// Party: who is in the room, what they said, and who is talking.
//
// All of it rides the EXISTING input data channel. A second channel would need
// its own negotiation and could be open while input is not (or the reverse),
// giving two different answers to "is this player connected". One channel means
// one truth: if they can press a button, they can be seen and talked to.
//
// The host is the only authority. Joiners never talk to each other — they send
// to the host, the host stamps and fans out. That kills the whole class of bugs
// where two clients disagree about who is in the room, and it matches how seats
// are already allocated (ps2/netSeats.ts).
//
// Wire messages, all on the input channel alongside {t:"input"}:
//   joiner -> host   {t:"hello", name}          announce (also after reconnect)
//   joiner -> host   {t:"say", text}            chat
//   joiner -> host   {t:"mic", on}              mic opened/closed
//   joiner -> host   {t:"level", v}             0..1 speaking level, throttled
//   host -> joiner   {t:"roster", members}      full state, host is authority
//   host -> joiner   {t:"said", from, text, at} one chat line, host-stamped

export interface Member {
  /** joiner id, or "host" */
  id: string;
  name: string;
  /** 1-based player number; the host is always 1 */
  pad: number;
  host?: boolean;
  /** mic is open (not necessarily speaking) */
  mic?: boolean;
  /** 0..1 speaking level, for the pad ring */
  level?: number;
}

export interface ChatLine {
  id: string;
  from: string;
  text: string;
  /** host clock, ms — the host stamps so ordering can't disagree */
  at: number;
  /** local echo that the host has not confirmed yet */
  pending?: boolean;
  /** not speech: "PLAYER TWO joined" */
  system?: boolean;
}

export const MAX_CHAT = 60;
export const MAX_NAME = 18;
export const MAX_TEXT = 140;

/** Names arrive from other people's browsers. Strip control characters and
 *  anything that could impersonate the system voice, then clamp. */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return (s || "Player").slice(0, MAX_NAME);
}

export function cleanText(raw: unknown): string {
  return String(raw ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, MAX_TEXT);
}

/** Append with a hard cap. Chat in a game room is a tail, not an archive —
 *  an unbounded log is a memory leak on a machine already running an emulator. */
export function pushLine(log: readonly ChatLine[], line: ChatLine): ChatLine[] {
  const next = [...log, line];
  return next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next;
}

/** Replace the local echo of a line the host has now confirmed. Matched on
 *  sender + text rather than id, because the host mints its own ids. */
export function confirmLine(log: readonly ChatLine[], line: ChatLine): ChatLine[] {
  const i = log.findIndex((l) => l.pending && l.from === line.from && l.text === line.text);
  if (i === -1) return pushLine(log, line);
  const next = [...log];
  next[i] = line;
  return next;
}

/** Build the roster the host broadcasts. Seats come from the seat map that
 *  already drives input routing, so the roster can never disagree with which
 *  pad a player is actually holding. */
export function buildRoster(opts: {
  hostName: string;
  hostMic?: boolean;
  hostLevel?: number;
  /** joiner id -> pad index (0 = host's pad), as ps2/netSeats produces */
  seats: ReadonlyMap<string, number>;
  names: ReadonlyMap<string, string>;
  mics: ReadonlyMap<string, boolean>;
  levels: ReadonlyMap<string, number>;
}): Member[] {
  const out: Member[] = [{
    id: "host", name: cleanName(opts.hostName), pad: 1, host: true,
    mic: !!opts.hostMic, level: opts.hostLevel ?? 0,
  }];
  for (const [id, pad] of opts.seats) {
    out.push({
      id,
      name: cleanName(opts.names.get(id) ?? "Player"),
      pad: pad + 1,
      mic: !!opts.mics.get(id),
      level: opts.levels.get(id) ?? 0,
    });
  }
  return out.sort((a, b) => a.pad - b.pad);
}

let seq = 0;
export const lineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Rows for the panel: every real seat plus the empty ones, so "3 open" is
 *  visible rather than implied by absence. */
export function rosterRows(members: readonly Member[], capacity: number) {
  const byPad = new Map(members.map((m) => [m.pad, m]));
  return Array.from({ length: Math.max(capacity, members.length) }, (_, i) => ({
    pad: i + 1,
    member: byPad.get(i + 1) ?? null,
  }));
}
