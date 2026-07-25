import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchLive, type LiveRoom } from "../ps2mp/webrtc";
import PadLadder from "./PadLadder";

// Rooms that are open right now.
//
// Before this, joining meant someone telling you a four-character code out of
// band — which works for two friends and for nobody else. A room that wants
// players says so, and this is where they are found. Rooms are only listed if
// the host chose to be public; a private room still works, it just isn't here.

const AGO = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

export default function Lobby(props: { onJoin: (code: string) => void; onClose: () => void }) {
  const [rooms, setRooms] = createSignal<LiveRoom[]>([]);
  const [state, setState] = createSignal<"loading" | "ok" | "error">("loading");

  const load = async () => {
    try {
      const m = await fetchLive();
      setRooms(m.live.filter((r) => r.kind === "ps2"));
      setState("ok");
    } catch {
      setState("error");
    }
  };

  let timer: ReturnType<typeof setInterval>;
  onMount(() => { void load(); timer = setInterval(load, 5000); });
  onCleanup(() => clearInterval(timer));

  const full = (r: LiveRoom) => r.seats >= r.max;

  return (
    <div class="lobby">
      <div class="lobby-head">
        <span class="lobby-k">OPEN ROOMS</span>
        <button class="ps-act" onClick={load}>refresh</button>
        <button class="ps-act" onClick={props.onClose}>close</button>
      </div>

      <Show when={state() !== "loading"} fallback={<p class="lobby-note">Looking for open rooms…</p>}>
        <Show
          when={rooms().length > 0}
          fallback={
            <p class="lobby-note">
              {state() === "error"
                ? "Could not reach the room directory. Check your connection and try refresh."
                : "No one is hosting right now. Start a game, choose how many controllers you want, and press Host online — your room shows up here for everyone else."}
            </p>
          }
        >
          <For each={rooms()}>
            {(r) => (
              <button
                class="lobby-row"
                classList={{ full: full(r) }}
                disabled={full(r)}
                onClick={() => props.onJoin(r.code)}
              >
                <span class="lobby-title">{r.title}</span>
                <PadLadder
                  count={r.max}
                  size="sm"
                  slots={Array.from({ length: r.seats }, (_, i) => ({ player: i + 1, taken: true, remote: true }))}
                />
                <span class="lobby-seats">
                  {full(r) ? "full" : `${r.max - r.seats} free`}
                </span>
                <span class="lobby-meta">
                  {AGO(r.since)}
                  <Show when={r.watchers > 0}> · {r.watchers} watching</Show>
                </span>
                <span class="lobby-go">{full(r) ? "" : "join"}</span>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
