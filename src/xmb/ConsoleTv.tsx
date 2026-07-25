// Console TV — watch whatever is being played on this console right now.
//
// Netplay already streams a host's canvas to a peer; a spectator is that same
// peer with the input channel removed, so the whole channel is nearly free. It
// turns a single-player session into something with an audience: the host taps
// "let people watch", anyone opens the link, and they're in.
//
// Watching is strictly opt-in for the host. A room only appears here if its
// host asked to be listed — hosting a private 2-player game never advertises
// you, which is why the listing rides on the host message rather than being
// inferred from the room existing.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { fetchLive, startJoiner, type JoinerHandle, type LiveRoom, type Marquee } from "../ps2mp/webrtc";
import { setNavEnabled } from "../input";
import { Icon } from "./icons";
import * as sfx from "../audio";

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

export default function ConsoleTv(props: { onClose: () => void; code?: string }) {
  const [marquee, setMarquee] = createSignal<Marquee>({ live: [], recent: [] });
  const [stage, setStage] = createSignal<"guide" | "tuning" | "live">(props.code ? "tuning" : "guide");
  const [status, setStatus] = createSignal("");
  const [code, setCode] = createSignal(props.code ?? "");
  const [now, setNow] = createSignal<LiveRoom | null>(null);
  const [typed, setTyped] = createSignal("");
  let watcher: JoinerHandle | null = null;
  let video: HTMLVideoElement | undefined;

  const refresh = async () => setMarquee(await fetchLive());

  const tune = (c: string, room?: LiveRoom) => {
    const target = c.trim().toUpperCase();
    if (!target) return;
    sfx.confirm?.();
    setCode(target); setNow(room ?? null); setStage("tuning"); setStatus("tuning in…");
    watcher?.stop();
    watcher = startJoiner({
      room: target,
      watch: true, // no player slot, no input channel
      onStream: (s) => {
        setStage("live"); setStatus("");
        if (video) { video.srcObject = s; video.play().catch(() => {}) }
      },
      onStatus: (st) => {
        setStatus(st);
        if (st === "host left" || st.includes("no such room")) { setStage("guide"); void refresh() }
      },
    });
  };

  const backToGuide = () => {
    sfx.back?.();
    watcher?.stop(); watcher = null;
    if (video) video.srcObject = null;
    setStage("guide"); setStatus(""); setNow(null);
    void refresh();
  };

  onMount(() => {
    setNavEnabled(true); // watching is passive — the crossbar keeps working
    void refresh();
    if (props.code) tune(props.code);
    const poll = setInterval(() => { if (stage() === "guide") void refresh() }, 8000);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      stage() === "guide" ? props.onClose() : backToGuide();
    };
    addEventListener("keydown", esc);
    onCleanup(() => { clearInterval(poll); removeEventListener("keydown", esc); watcher?.stop() });
  });

  const shareUrl = () => `${location.origin}${location.pathname}?tv=${code()}`;

  return (
    <div class="bg-root pad-focus-scope">
      <div class="bg-head">
        <div class="panel-tag">CONSOLE TV</div>
        <Show when={stage() === "live"}>
          <div class="bg-turn mine">watching{now() ? ` · ${now()!.title}` : ""}</div>
        </Show>
        <button class="ps-act" onClick={() => (stage() === "guide" ? props.onClose() : backToGuide())}>
          <span class="btn-o" /> {stage() === "guide" ? "close" : "back to guide"}
        </button>
      </div>

      <Show when={stage() === "guide"}>
        <div class="bg-lobby">
          <div class="bg-lobby-head">
            <div class="panel-tag">ON NOW</div>
            <p>
              Whatever someone is playing on this console, live. Watching takes no
              controller slot, so a room stays open to players even with an audience.
            </p>
          </div>

          <Show
            when={marquee().live.length}
            fallback={
              <div class="tv-empty">
                <Icon name="broadcast" />
                <p>Nothing is on right now.</p>
                <span>
                  Start a game, choose <b>let people watch</b>, and it appears here for
                  anyone with the link.
                </span>
              </div>
            }
          >
            <div class="bg-rows">
              <For each={marquee().live}>
                {(r) => (
                  <button class="bg-grow tv-row" onClick={() => tune(r.code, r)}>
                    <span class="bg-grow-ic tv-onair"><Icon name="broadcast" /></span>
                    <span class="bg-grow-head">
                      <span class="bg-grow-name">{r.title}</span>
                      <span class="bg-grow-sub">
                        {r.kind || "live"} · on for {ago(r.since)}
                        {r.watchers > 0 ? ` · ${r.watchers} watching` : ""}
                      </span>
                    </span>
                    <span class="bg-grow-acts"><span class="ps-act"><span class="btn-x" /> watch</span></span>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <div class="bg-rows tv-manual">
            <div class="bg-grow bg-grow-join">
              <span class="bg-grow-ic"><Icon name="gamepad" /></span>
              <span class="bg-grow-head">
                <span class="bg-grow-name">Have a code?</span>
                <span class="bg-grow-sub">Watch a room that isn't listed</span>
              </span>
              <span class="bg-grow-acts">
                <input
                  class="bg-codein" placeholder="CODE" maxlength={8} autocomplete="off" autocapitalize="characters"
                  onInput={(e) => setTyped(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") tune(typed()) }}
                />
                <button class="ps-act" disabled={!typed()} onClick={() => tune(typed())}>Watch</button>
              </span>
            </div>
          </div>

          <Show when={marquee().recent.length}>
            <div class="tv-recent">
              <div class="panel-tag">LAST ON</div>
              <For each={marquee().recent}>
                {(r) => <div class="tv-recent-row"><span>{r.title}</span><span>{ago(r.at)} ago</span></div>}
              </For>
            </div>
          </Show>

          <div class="ps-legend"><span><span class="btn-x" /> watch</span><span><span class="btn-o" /> close</span></div>
        </div>
      </Show>

      <Show when={stage() !== "guide"}>
        <div class="ps2-join-view">
          <video ref={video} class="ps2-join-video" classList={{ live: stage() === "live" }} autoplay playsinline muted />
          <Show when={stage() !== "live"}>
            <div class="bg-connecting">
              <div class="bg-spinner" />
              <p>Tuning in to {code()}… {status()}</p>
              <button class="ps-act" onClick={backToGuide}><span class="btn-o" /> cancel</button>
            </div>
          </Show>
          <Show when={stage() === "live"}>
            <div class="tv-strip">
              <span class="tv-live-dot" /> LIVE
              <span class="tv-strip-code">{code()}</span>
              <button class="ps-act" onClick={() => { void navigator.clipboard?.writeText(shareUrl()); setStatus("link copied") }}>
                <span class="btn-t" /> copy link
              </button>
              <Show when={status()}><span class="tv-strip-note">{status()}</span></Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
