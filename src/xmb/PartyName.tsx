// "You appear as ___" — asked once, optional, remembered on the device.
//
// Deliberately NOT a gate. A modal in front of a room is a wall in front of the
// only thing the visitor came for, and the room works fine with a fallback name.
// So this is one inline row: loud the first time (it has something to ask), quiet
// afterwards (it is just showing you what you are called, editable in place).
//
// It can be changed at any time, including mid-room — the caller re-announces,
// which the host already handles idempotently.
import { Show, createSignal } from "solid-js";
import * as sfx from "../audio";
import { MAX_NAME, isDefaultName, partyNameAsked, skipPartyName, writePartyName } from "../ps2mp/partyName";

export default function PartyName(props: {
  /** what the room currently calls you */
  name: string;
  /** true when the current name is only the profile's fallback */
  isFallback?: boolean;
  onChange: (name: string) => void;
  /** fired once the question is answered either way, so a caller that only
   *  wanted to ask can stop rendering this — localStorage is not reactive, so
   *  the caller cannot work it out on its own */
  onDone?: () => void;
  /** compact placement: inside the connecting screen rather than a page */
  inline?: boolean;
}) {
  // Asking is a first-run thing. Once answered — including by walking past it —
  // this collapses to a line you can click.
  const [asking, setAsking] = createSignal(!partyNameAsked());
  const [draft, setDraft] = createSignal(isDefaultName(props.name) ? "" : props.name);

  const commit = () => {
    props.onChange(writePartyName(draft()));
    setAsking(false);
    sfx.confirm();
    props.onDone?.();
  };
  const skip = () => { skipPartyName(); setAsking(false); sfx.back(); props.onDone?.(); };

  return (
    <div class="pname" classList={{ asking: asking(), inline: !!props.inline }}>
      <Show
        when={asking()}
        fallback={
          <button class="pname-as" onClick={() => { sfx.tickH(); setAsking(true); }}>
            <span class="pname-k">You appear as</span>
            <span class="pname-v">{props.name}</span>
            <span class="pname-edit">change</span>
          </button>
        }
      >
        <p class="pname-k">What should people call you?</p>
        <div class="pname-row">
          <input
            class="pname-field"
            maxLength={MAX_NAME}
            placeholder={props.name}
            value={draft()}
            aria-label="Your name in the room"
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setDraft(e.currentTarget.value)}
            // The console swallows Enter with a global handler, so claim it here.
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.preventDefault(); skip(); }
            }}
          />
          <button class="pname-ok" disabled={!draft().trim()} onClick={commit}>
            <span class="btn-x" aria-hidden="true" />use this
          </button>
          <button class="ps-act pname-skip" onClick={skip}>skip</button>
        </div>
        <p class="pname-note">
          Optional, and only for this console — it is remembered here so nobody asks again.
          {props.isFallback ? " Skip it and you appear as " : " Skip it and you stay "}
          <b>{props.name}</b>.
        </p>
      </Show>
    </div>
  );
}
