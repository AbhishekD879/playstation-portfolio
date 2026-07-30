// The party column: who is in the room, what they said, who is talking.
//
// Docked to the right edge over the game, hairline-divided into three zones —
// roster, log, composer. Deliberately NOT a floating card: it is console
// furniture, so it shares the translucency and the 1px seams the option sheets
// use, and it reads as part of the machine rather than a web widget over it.
//
// SIGNATURE: the pad ring. Every roster row identifies a player by their
// controller number inside a thin ring, extending PadLadder's "pads are
// identity" vocabulary. When someone speaks, THEIR ring lights and thickens
// with the live level. That replaces the level meter every voice chat ships —
// the identity and the activity are the same object, so a glance at the roster
// answers both "who is here" and "who is talking".
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import * as sfx from "../audio";
import { MAX_TEXT, rosterRows, type ChatLine, type Member } from "../ps2mp/party";
import PartyName from "./PartyName";

export type MicState = "off" | "on" | "blocked" | "unsupported";

export default function PartyPanel(props: {
  code: string;
  /** first-run name prompt, shown here because the connecting screen it used to
   *  live on can be gone in under a second on a fast link */
  name?: string;
  nameIsFallback?: boolean;
  /** undefined once the question has been answered — the roster row below then
   *  shows your name with "you" beside it, so a second copy is furniture */
  onName?: (n: string) => void;
  onNameDone?: () => void;
  /** total seats in this room, so empty ones can show as open */
  capacity: number;
  members: Member[];
  log: ChatLine[];
  /** our own id, to mark "you" without a second lookup */
  meId: string;
  mic: MicState;
  /** true while push-to-talk is held or the mic is latched open */
  talking: boolean;
  /** our own live level, metered locally so our ring never waits for the host */
  myLevel: number;
  onSay: (text: string) => void;
  onToggleMic: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = createSignal("");
  let logEl: HTMLDivElement | undefined;
  let field: HTMLInputElement | undefined;

  // Follow the tail only when the reader is already at the bottom. Yanking the
  // view down while someone scrolls back through the last exchange is worse
  // than missing a line.
  createEffect(() => {
    props.log.length;
    if (!logEl) return;
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
    if (nearBottom) requestAnimationFrame(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; });
  });

  const send = () => {
    const text = draft().trim();
    if (!text) return;
    props.onSay(text);
    setDraft("");
    sfx.tickH();
  };

  const micLabel = () => {
    switch (props.mic) {
      case "on": return props.talking ? "Talking" : "Mic on";
      case "blocked": return "Mic blocked";
      case "unsupported": return "No mic";
      default: return "Mic off";
    }
  };

  // Our own row is metered here; everyone else's level comes from the host.
  const levelOf = (m: Member | null) =>
    !m ? 0 : m.id === props.meId ? Math.max(props.myLevel, m.level ?? 0) : m.level ?? 0;

  const clock = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <aside class="pty" aria-label="Party">
      <div class="pty-top">
        <span class="pty-k">PARTY</span>
        <span class="pty-room">{props.code}</span>
        <button class="ps-act pty-hide" onClick={() => { sfx.back(); props.onClose(); }}>hide</button>
      </div>

      {/* Only while it has something to ask. Once answered, the roster row below
          already shows your name with "you" next to it — a second copy would be
          furniture. */}
      <Show when={props.onName}>
        <div class="pty-name">
          <PartyName name={props.name ?? "Player"} isFallback={props.nameIsFallback}
            onChange={props.onName!} onDone={props.onNameDone} inline />
        </div>
      </Show>

      <div class="pty-roster" role="list">
        <For each={rosterRows(props.members, props.capacity)}>{(row) => (
          <div class="pty-row" classList={{ open: !row.member }} role="listitem">
            {/* the ring: identity and voice activity in one object */}
            <span
              class="pty-ring"
              classList={{ live: !!row.member, talk: levelOf(row.member) > 0 }}
              style={levelOf(row.member) > 0 ? `--lvl:${Math.min(1, levelOf(row.member)).toFixed(2)}` : undefined}
            >
              {row.pad}
            </span>
            <Show when={row.member} fallback={<span class="pty-open">open</span>}>
              <span class="pty-who">
                {row.member!.name}
                <Show when={row.member!.id === props.meId}><i class="pty-you">you</i></Show>
              </span>
              <span class="pty-tag">
                {row.member!.host ? "HOST" : ""}
                <Show when={row.member!.mic}>
                  <i class="pty-mic" classList={{ hot: levelOf(row.member) > 0 }} aria-label="microphone on" />
                </Show>
              </span>
            </Show>
          </div>
        )}</For>
      </div>

      <div class="pty-log" ref={logEl} aria-live="polite" aria-label="Chat">
        <Show when={props.log.length} fallback={
          <p class="pty-empty">No one has said anything yet. Say hello.</p>
        }>
          <For each={props.log}>{(line) => (
            <div class="pty-line" classList={{ sys: !!line.system, pending: !!line.pending }}>
              <Show when={!line.system} fallback={<span class="pty-sys">{line.text}</span>}>
                <span class="pty-meta">
                  <span class="pty-from">{line.from}</span>
                  <span class="pty-at">{clock(line.at)}</span>
                </span>
                <span class="pty-said">{line.text}</span>
              </Show>
            </div>
          )}</For>
        </Show>
      </div>

      <div class="pty-say">
        <input
          ref={field}
          class="pty-field"
          maxLength={MAX_TEXT}
          placeholder="Say something"
          aria-label="Message"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            // The game owns the keyboard; while typing, this field owns it.
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); send(); }
            if (e.key === "Escape") { e.preventDefault(); field?.blur(); }
          }}
        />
        <button
          class="pty-talk"
          classList={{ on: props.mic === "on", hot: props.talking, bad: props.mic === "blocked" }}
          aria-pressed={props.mic === "on"}
          onClick={props.onToggleMic}
        >
          <i class="pty-talk-ring" />
          {micLabel()}
        </button>
      </div>
      <p class="pty-hint">
        <Show when={props.mic === "blocked"} fallback={<>Enter to send · the mic stays on until you turn it off</>}>
          Allow the microphone in your browser's address bar, then try again.
        </Show>
      </p>
    </aside>
  );
}
