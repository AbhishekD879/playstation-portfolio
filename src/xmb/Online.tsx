import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchLive, type LiveRoom } from "../ps2mp/webrtc";
import SeatPicker from "./SeatPicker";
import PartyName from "./PartyName";
import { seatPlan } from "../ps2/seatPlan";
import * as sfx from "../audio";

// PlayStation 2 · Online — a real destination, not a dropdown.
//
// Multiplayer used to be scattered: a picker in the shelf's toolbar, a code box
// behind a button, a banner that only existed mid-game. You could not see the
// feature without already knowing how to use it. This is the one place it all
// lives, and it is reachable before you own a disc — because a joiner brings
// nothing but a pad.
//
// ★ Every control here follows one rule: the console's own button glyph, then a
// verb, then the object, so it reads as a sentence about what will happen.
// "WWE SmackDown!  HOST" was three ambiguous things at once — a truncated title,
// and a dim word that could have been a label, a status or a button.

const AGO = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

/** The room's own address. A code is easiest read down a phone call; a link is
 *  easiest everywhere else, so a room has both. */
export const roomLink = (code: string) => `${location.origin}${location.pathname}#/room/${code}`;

export default function Online(props: {
  players: number;
  onPlayers: (n: number) => void;
  /** the PS2 games this profile owns — hosting means picking one of these */
  library: { id: string; title: string; plays?: number; size?: number }[];
  onHost: (id: string) => void;
  /** no game in the library? insert a disc and host that instead */
  onInsert: () => void;
  onJoin: (code: string, title: string) => void;
  /** take no seat — watch the host's stream instead */
  onWatch: (code: string) => void;
  /** listed in Open rooms, or code-and-link only */
  isPublic: boolean;
  onPublic: (v: boolean) => void;
  /** what the room will call you, and whether that is only a fallback */
  name: string;
  nameIsFallback: boolean;
  onName: (n: string) => void;
  /** the room's code, minted before the room exists so the link is real */
  code: string;
  onNewCode: () => void;
  onClose: () => void;
}) {
  const [rooms, setRooms] = createSignal<LiveRoom[]>([]);
  const [state, setState] = createSignal<"loading" | "ok" | "error">("loading");
  const [code, setCode] = createSignal("");
  const [copied, setCopied] = createSignal(false);

  const load = async () => {
    try { setRooms((await fetchLive()).live.filter((r) => r.kind === "ps2")); setState("ok"); }
    catch { setState("error"); }
  };
  let t: ReturnType<typeof setInterval>;
  onMount(() => {
    void load();
    t = setInterval(load, 5000);
    // One controller means zero seats to give away — an online room nobody can
    // enter. The console's own default is 1, so raise it on the way in here.
    if (props.players < 2) props.onPlayers(2);
  });
  onCleanup(() => clearInterval(t));

  const full = (r: LiveRoom) => r.seats >= r.max;
  const taps = () => seatPlan(props.players).taps;

  // ★ The code is minted before the room exists, so this link is the one people
  // actually arrive on — not a preview of the shape. A button that copies a dead
  // URL is worse than no button.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(props.code));
      sfx.confirm();
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated and can simply refuse. Say nothing false —
      // the link is on screen and selectable either way.
      sfx.deny();
    }
  };

  const GB = (b?: number) => (b ? `${(b / 1024 ** 3).toFixed(1)} GB` : "");
  const played = (g: { plays?: number; size?: number }) =>
    !g.plays ? ["never played", GB(g.size)].filter(Boolean).join(" · ")
      : `played ${g.plays}${g.plays === 1 ? " time" : " times"}`;

  return (
    <div class="online">
      <div class="online-in">
        <div class="online-head">
          <div>
            <p class="online-eyebrow">PlayStation 2 · Online</p>
            <h1 class="online-h1">Six controllers, one console, anywhere.</h1>
            <p class="online-lede">
              A PS2 has two controller ports, and a multitap fans each into four — which is
              how six people ever played on one machine. The seats below are laid out the
              same way, whether a player is on your sofa or on the other side of the world.
            </p>
          </div>
          <button class="ps-act online-x" onClick={props.onClose}>close</button>
        </div>

        {/* Before any of it: who the room calls you. Optional, asked once, and
            it applies whether you host or join — a host is a row in the roster
            like everyone else. */}
        <PartyName name={props.name} isFallback={props.nameIsFallback} onChange={props.onName} />

        {/* ── your room ─────────────────────────────────────────────── */}
        <p class="online-k">Your room</p>
        <div class="online-card">
          <p class="online-sub">How many are playing</p>
          <SeatPicker count={props.players} min={2} onPick={props.onPlayers} />
          {/* The braces name each port's state in the width the seats give them;
              what a multitap actually IS belongs here, said once. */}
          <p class="online-note" style="margin-top:12px">
            {taps() === 0
              ? "A pad in each of the console's own two ports — no multitap needed."
              : taps() === 1
              ? "One multitap, on controller port 1. Players 1–4 share it."
              : "Two multitaps. Players 1–4 on port 1, players 5–6 on port 2."}
          </p>

          {/* Who can join belongs HERE, at the moment it is decided — it used to
              live on a panel over the running game, which is after everyone has
              already arrived or failed to. */}
          <div class="online-act">
            <p class="online-sub" style="margin:0">Who can join</p>
          </div>
          <div class="party-vis" role="group" aria-label="Who can join">
            <button class="party-tab" classList={{ on: props.isPublic }} aria-pressed={props.isPublic}
              onClick={() => { sfx.tickH(); props.onPublic(true); }}>Anyone can join</button>
            <button class="party-tab" classList={{ on: !props.isPublic }} aria-pressed={!props.isPublic}
              onClick={() => { sfx.tickH(); props.onPublic(false); }}>Invite only</button>
          </div>
          <p class="online-note" style="margin-top:10px">
            {props.isPublic
              ? "Listed in Open rooms, so anyone on the console can find it. The code and the link work too."
              : "Not listed. Only the people you send the code or the link to can get in."}
          </p>

          <div class="inv">
            <p class="online-sub">Invite</p>
            <div class="inv-row">
              <span class="inv-code">{props.code}</span>
              <span class="inv-sep" aria-hidden="true" />
              <span class="inv-link">
                <span class="inv-url">{roomLink(props.code)}</span>
                <button class="inv-copy" classList={{ done: copied() }} onClick={copyLink}
                  aria-label="Copy the room link">
                  <span class="btn-s" aria-hidden="true" />{copied() ? "copied" : "copy"}
                </button>
              </span>
              <button class="ps-act" onClick={() => { sfx.tickH(); props.onNewCode(); }}>new code</button>
            </div>
            <p class="online-note" style="margin-top:10px">
              Read the code down a phone call. Send the link everywhere else — it opens straight
              into this room.
            </p>
          </div>

          {/* ── what to play ──────────────────────────────────────────
              Verb first. A row that says "Start with Tekken" cannot be mistaken
              for a label, and the title is never truncated mid-word. */}
          <div class="online-act">
            <p class="online-sub" style="margin:0">What do you want to play</p>
          </div>
          <p class="online-note">
            It boots, then opens the room — with {props.players - 1}{" "}
            {props.players === 2 ? "seat" : "seats"} for other people.
          </p>

          <div class="oact-list">
            <For each={props.library}>
              {(g) => (
                <button class="oact" onClick={() => props.onHost(g.id)}>
                  <span class="btn-x oact-g" aria-hidden="true" />
                  <span class="oact-t">Start with <b>{g.title}</b></span>
                  <span class="oact-m">{played(g)}</span>
                </button>
              )}
            </For>
            <button class="oact" onClick={props.onInsert}>
              <span class="btn-s oact-g" aria-hidden="true" />
              <span class="oact-t">Choose a disc from your drive</span>
              <span class="oact-m">.iso · .chd · .cso</span>
            </button>
          </div>
          <Show when={!props.library.length}>
            <p class="online-empty" style="margin-top:14px">
              Nothing in your PS2 library yet — pick a disc from your drive and it will be here
              next time.
            </p>
          </Show>
        </div>

        {/* ── open rooms ────────────────────────────────────────────── */}
        <div class="online-k-row">
          <p class="online-k">Open rooms</p>
          <button class="ps-act" onClick={load}>refresh</button>
        </div>

        <Show when={state() !== "loading"} fallback={<p class="online-empty">Looking for open rooms…</p>}>
          <Show
            when={rooms().length}
            fallback={
              <p class="online-empty">
                {state() === "error"
                  ? "Could not reach the room directory. Check your connection, then refresh."
                  : "Nobody is hosting yet. Start a game and host it — your room shows up here for everyone else."}
              </p>
            }
          >
            <div class="online-rooms">
              <For each={rooms()}>
                {(r) => (
                  <div class="online-room two">
                    <span class="online-room-t">{r.title}</span>
                    <span class="online-room-c">{r.code}</span>
                    {/* Occupancy as numbered pads: how many AND which ones, in
                        the space the old ladder used to say less. Pad 1 is the
                        host — the directory counts only the seats they gave away. */}
                    <span class="rm-who" aria-label={`${r.seats + 1} of ${r.max + 1} pads taken`}>
                      <For each={Array.from({ length: r.max + 1 }, (_, i) => i + 1)}>
                        {(n) => <span class="rm-seat" classList={{ on: n === 1 || n - 1 <= r.seats }}>{n}</span>}
                      </For>
                    </span>
                    <span class="online-room-s">{full(r) ? "Full" : `${r.max - r.seats} free`}</span>
                    <Show when={r.watchers > 0}>
                      <span class="rm-watch">{r.watchers} watching</span>
                    </Show>
                    <span class="online-room-m">{AGO(r.since)}</span>
                    <span class="rm-acts">
                      <Show when={!full(r)}>
                        <button class="rm-act" onClick={() => props.onJoin(r.code, r.title)}>
                          <span class="btn-x" aria-hidden="true" />take a pad
                        </button>
                      </Show>
                      <button class="rm-act quiet" onClick={() => props.onWatch(r.code)}>
                        {full(r) ? "join the audience" : "just watch"}
                      </button>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* ── code fallback ─────────────────────────────────────────── */}
        <p class="online-k" style="margin-top:34px">Somebody sent you a room</p>
        <form class="online-code" onSubmit={(e) => { e.preventDefault(); if (code().length === 4) props.onJoin(code(), ""); }}>
          <input
            class="online-input" maxLength={4} placeholder="ABCD" value={code()} aria-label="Room code"
            onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          <button class="online-btn ghost" disabled={code().length !== 4}>Join with code</button>
          <span class="online-note">
            Invite-only rooms are not listed above — you need the code or the link from whoever is
            hosting. A link opens straight into the room.
          </span>
        </form>
      </div>
    </div>
  );
}
