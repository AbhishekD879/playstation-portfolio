import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchLive, type LiveRoom } from "../ps2mp/webrtc";
import PadLadder from "./PadLadder";

// PlayStation 2 · Online — a real destination, not a dropdown.
//
// Multiplayer used to be scattered: a picker in the shelf's toolbar, a code box
// behind a button, a banner that only existed mid-game. You could not see the
// feature without already knowing how to use it. This is the one place it all
// lives, and it is reachable before you own a disc — because a joiner brings
// nothing but a pad.

const AGO = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

export default function Online(props: {
  players: number;
  onPlayers: (n: number) => void;
  /** the PS2 games this profile owns — hosting means picking one of these */
  library: { id: string; title: string }[];
  onHost: (id: string) => void;
  /** no game in the library? insert a disc and host that instead */
  onInsert: () => void;
  onJoin: (code: string, title: string) => void;
  onClose: () => void;
}) {
  const [rooms, setRooms] = createSignal<LiveRoom[]>([]);
  const [state, setState] = createSignal<"loading" | "ok" | "error">("loading");
  const [code, setCode] = createSignal("");

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
  const taps = () => (props.players > 4 ? 2 : props.players > 2 ? 1 : 0);

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

        {/* ── your room ─────────────────────────────────────────────── */}
        <p class="online-k">Your room</p>
        <div class="online-card">
          <div class="online-seatrow">
            <div>
              <p class="online-sub">How many controllers</p>
              <PadLadder count={props.players} min={2} showPorts onPick={props.onPlayers} />
            </div>
            <p class="online-taps">
              {taps() === 0
                ? "No multitap needed — both players fit on the console's own two ports."
                : taps() === 1
                ? "One multitap, on controller port 1. Players 1–4 share it."
                : "Two multitaps. Players 1–4 on port 1, players 5–6 on port 2."}
            </p>
          </div>

          <div class="online-act">
            <p class="online-sub" style="margin:0 0 2px">What are you hosting</p>
            <p class="online-note">
              It boots, then opens the room — your game appears in Open rooms
              with {props.players - 1} {props.players === 2 ? "seat" : "seats"} free.
            </p>
          </div>

          <Show
            when={props.library.length}
            fallback={
              <p class="online-empty" style="margin-top:14px">
                No PS2 games in your library yet.{" "}
                <button class="ps-act" onClick={props.onInsert}>Insert a disc</button>{" "}
                and it will be here next time.
              </p>
            }
          >
            <div class="online-pick">
              <For each={props.library}>
                {(g) => (
                  <button class="online-game" onClick={() => props.onHost(g.id)}>
                    <span class="online-game-t">{g.title}</span>
                    <span class="online-game-go">Host</span>
                  </button>
                )}
              </For>
              <button class="online-game ins" onClick={props.onInsert}>
                <span class="online-game-t">Insert a disc…</span>
                <span class="online-game-go">Host</span>
              </button>
            </div>
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
                  <button class="online-room" classList={{ full: full(r) }} disabled={full(r)}
                    onClick={() => props.onJoin(r.code, r.title)}>
                    <span class="online-room-t">{r.title}</span>
                    <span class="online-room-c">{r.code}</span>
                    <PadLadder count={r.max} size="sm"
                      slots={Array.from({ length: r.seats }, (_, i) => ({ player: i + 1, taken: true, remote: true }))} />
                    <span class="online-room-s">{full(r) ? "Full" : `${r.max - r.seats} free`}</span>
                    <span class="online-room-m">
                      {AGO(r.since)}<Show when={r.watchers > 0}> · {r.watchers} watching</Show>
                    </span>
                    <span class="online-room-go">{full(r) ? "" : "Join"}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* ── code fallback ─────────────────────────────────────────── */}
        <p class="online-k" style="margin-top:34px">Got a code?</p>
        <form class="online-code" onSubmit={(e) => { e.preventDefault(); if (code().length === 4) props.onJoin(code(), ""); }}>
          <input
            class="online-input" maxLength={4} placeholder="ABCD" value={code()} aria-label="Room code"
            onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          <button class="online-btn ghost" disabled={code().length !== 4}>Join with code</button>
          <span class="online-note">Private rooms are not listed above — you need the code from the host.</span>
        </form>
      </div>
    </div>
  );
}
