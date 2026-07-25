// Watch Party — everyone in a room watches the SAME YouTube video in sync.
// No video is streamed between people (that's the PS2-MP feature); each viewer
// loads the video straight from YouTube and a Cloudflare Durable Object just
// broadcasts playback state (play/pause/seek), a shared queue, live chat and
// floating emoji reactions. First in the room hosts (drives playback); the host
// can hand the wheel to everyone with "anyone can control". Share the room via a
// code or a ?watch=CODE link; a refresh rejoins automatically.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import * as sfx from "../audio";
import { joinRoom, makeRoomCode, type RoomHandle, type WPMsg } from "../watchparty/room";
import { createAdapter, resolveSourceAsync, sourceToken, parseToken, kindLabel, type Adapter, type SourceKind } from "../watchparty/players";
import { ytSearch, type YtVideo } from "../apps";
import { labEnabled } from "../labs";

const AVATARS = ["🍿", "🎬", "🐱", "🦊", "🐼", "🐸", "🦄", "👾", "🎧", "🌮", "🍕", "⭐️"];
const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏", "🎉", "👍"];
const avatarFor = (name: string) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; };
// Best-guess Hyperbeam region (NA/EU/AS) from the browser's timezone — instant,
// no geolocation permission. The VM is ONE machine everyone connects to, so this
// picks the host's nearest region as the default (host can still override).
function guessRegion(): "NA" | "EU" | "AS" {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (/^(Asia|Australia|Indian)\//.test(tz)) return "AS";
    if (/^(Europe|Africa|Atlantic)\//.test(tz)) return "EU";
    if (/^America\//.test(tz)) return "NA";
    const off = -new Date().getTimezoneOffset() / 60; // hours from UTC, fallback
    if (off <= -2) return "NA";
    if (off < 4) return "EU";
    return "AS";
  } catch { return "NA"; }
}
const setQueryRoom = (code: string | null) => {
  const base = location.pathname + (code ? `?watch=${code}` : "") + location.hash.replace(/[?].*$/, "");
  history.replaceState(null, "", base);
};

type Member = { id: string; name: string; avatar: string; host: boolean };
type Chat = { name: string; avatar: string; text: string; self: boolean; sys?: boolean; id: number };
type Floater = { id: number; emoji: string; x: number };

export default function WatchParty(props: { onClose: () => void; userName: string }) {
  const me = { name: props.userName || "Guest", avatar: avatarFor(props.userName || "Guest") };

  const [room, setRoom] = createSignal<string | null>(null);
  const [codeInput, setCodeInput] = createSignal("");
  const [status, setStatus] = createSignal<"" | "connecting" | "open" | "closed">("");
  const [members, setMembers] = createSignal<Member[]>([]);
  const [selfId, setSelfId] = createSignal("");
  const [hostId, setHostId] = createSignal("");
  const [allowControl, setAllowControl] = createSignal(false);
  const [queue, setQueue] = createSignal<{ videoId: string; title: string; by: string }[]>([]);
  const [chat, setChat] = createSignal<Chat[]>([]);
  const [chatInput, setChatInput] = createSignal("");
  const [addInput, setAddInput] = createSignal("");
  const [results, setResults] = createSignal<YtVideo[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [unsupported, setUnsupported] = createSignal(""); // a pasted link we can't keep in sync
  const [floaters, setFloaters] = createSignal<Floater[]>([]);
  const [tab, setTab] = createSignal<"chat" | "queue" | "people">("chat");
  const [nowPlaying, setNowPlaying] = createSignal("");
  const [localPlaying, setLocalPlaying] = createSignal(false);
  const [hasVideo, setHasVideo] = createSignal(false);
  const [srcKind, setSrcKind] = createSignal<SourceKind | "">("");   // kind of the loaded source (drives the sync-vs-cobrowse UI)
  const [cobrowseBusy, setCobrowseBusy] = createSignal(false);
  const [cobrowseUrl, setCobrowseUrl] = createSignal("");   // the Hyperbeam embed URL, for the open-in-new-tab fallback
  const [adblock, setAdblock] = createSignal(true);          // start the shared browser with uBlock Origin (baked in at launch)
  const [region, setRegion] = createSignal<"NA" | "EU" | "AS">(guessRegion());   // auto-detected from timezone; host can override (one VM for the whole room)
  const [quality, setQuality] = createSignal<"smooth" | "sharp" | "saver">("smooth"); // stream quality preset
  const [closeOnEmpty, setCloseOnEmpty] = createSignal(true);          // end the cloud browser when everyone leaves (vs keep it alive to rejoin)
  const [roomState, setRoomState] = createSignal<{ videoId: string; position: number; playing: boolean } | null>(null);

  let handle: RoomHandle | null = null;
  let adapter: Adapter | null = null;   // the active source player (yt/vimeo/file/hls)
  let adapterKind: SourceKind | null = null;
  let playerEl!: HTMLDivElement;
  let videoBox!: HTMLDivElement;        // the 16:9 stage — target for fullscreen
  let curToken = "";          // canonical source token currently loaded (e.g. "yt:ID", "file:https://…")
  let applyingUntil = 0;      // suppress the echo of a programmatic play/seek
  let chatSeq = 1, floatSeq = 1;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let chatScroll: HTMLDivElement | undefined;

  const isHost = () => !!selfId() && selfId() === hostId();
  const driver = () => isHost() || allowControl();

  // —— sync engine ——————————————————————————————————————————————————————————
  const pushState = () => {
    if (!adapter || !driver() || !curToken || adapterKind === "cobrowse") return; // Hyperbeam self-syncs; nothing to broadcast
    handle?.send({ t: "state", videoId: curToken, position: adapter.getTime(), playing: adapter.playing() });
  };
  // the driver's own player firing play/pause → rebroadcast (unless it's the echo
  // of a programmatic change we just applied from a remote state).
  const onLocalPlay = () => { setLocalPlaying(true); if (Date.now() >= applyingUntil && driver()) pushState(); };
  const onLocalPause = () => { setLocalPlaying(false); if (Date.now() >= applyingUntil && driver()) pushState(); };
  const onLocalEnded = () => {
    setLocalPlaying(false);
    if (!driver()) return;
    const q = queue();
    if (q.length) { handle?.send({ t: "queue-remove", index: 0 }); loadVideo(q[0].videoId, q[0].title); }
    else handle?.send({ t: "state", videoId: curToken, position: adapter?.getTime() ?? 0, playing: false });
  };
  // create (or swap) the adapter for a source kind, mounted in the player box
  const ensureAdapter = (kind: SourceKind) => {
    if (adapter && adapterKind === kind) return;
    adapter?.destroy();
    adapterKind = kind; setSrcKind(kind);
    adapter = createAdapter(kind, playerEl, { onReady: () => {}, onPlay: onLocalPlay, onPause: onLocalPause, onEnded: onLocalEnded });
  };
  const applyRemote = (s: { videoId: string; position: number; playing: boolean }) => {
    setRoomState(s);
    if (!s.videoId) return;
    setHasVideo(true);
    applyingUntil = Date.now() + 900;
    if (s.videoId !== curToken) {          // a different source → (swap adapter and) load it
      curToken = s.videoId;
      const src = parseToken(s.videoId);
      setCobrowseUrl(src.kind === "cobrowse" ? src.ref : "");
      ensureAdapter(src.kind);
      adapter!.load(src.ref, Math.max(0, s.position), s.playing);
      return;
    }
    if (!adapter?.isReady()) return;        // same source, still loading → the load() above carries pos/play
    const target = (s.position || 0) + (s.playing ? 0.4 : 0); // nudge for one-way latency
    if (Math.abs(adapter.getTime() - target) > 1.2) adapter.seek(target);
    if (s.playing && !adapter.playing()) adapter.play();
    if (!s.playing && adapter.playing()) adapter.pause();
  };

  // —— room lifecycle ————————————————————————————————————————————————————————
  const connect = (code: string) => {
    const c = code.toUpperCase();
    setRoom(c); setStatus("connecting"); setQueryRoom(c);
    handle = joinRoom(c, me, onMsg, (s) => setStatus(s));
    heartbeat = setInterval(() => { if (driver() && adapter?.playing()) pushState(); }, 2000); // keeps seeks + late joiners in sync
  };
  const host = () => { sfx.confirm(); connect(makeRoomCode()); };
  const join = () => { const c = codeInput().trim().toUpperCase(); if (/^[A-Z0-9]{3,8}$/.test(c)) { sfx.confirm(); connect(c); } else sfx.deny(); };
  const leave = () => {
    sfx.back();
    handle?.close(); handle = null;
    if (heartbeat) clearInterval(heartbeat);
    adapter?.destroy(); adapter = null; adapterKind = null; curToken = "";
    setRoom(null); setMembers([]); setChat([]); setQueue([]); setSelfId(""); setHostId(""); setNowPlaying(""); setHasVideo(false); setRoomState(null); setSrcKind(""); setCobrowseUrl("");
    setQueryRoom(null);
  };

  const sysMsg = (text: string) => setChat((c) => [...c.slice(-199), { name: "", avatar: "", text, self: false, sys: true, id: chatSeq++ }]);

  const onMsg = (m: WPMsg) => {
    switch (m.t) {
      case "welcome":
        setSelfId(m.id); setHostId(m.hostId); setAllowControl(!!m.allowControl);
        setMembers(m.members || []); setQueue(m.queue || []);
        if (m.state?.videoId) applyRemote(m.state);
        break;
      case "members": {
        const prevHost = hostId();
        setMembers(m.members || []); if (m.hostId) setHostId(m.hostId);
        if (m.hostId && m.hostId !== prevHost && m.hostId === selfId()) sysMsg("You're the host now — you control playback.");
        break;
      }
      // WPMsg is an open bag, so pick the three fields out explicitly rather
      // than passing the whole message — same shape the "video" case builds.
      case "state":
        applyRemote({ videoId: String(m.videoId ?? ""), position: Number(m.position) || 0, playing: !!m.playing });
        break;
      case "video":
        setNowPlaying(m.title || "");
        if (m.by) sysMsg(`${m.by} started ${m.title ? `“${m.title}”` : "a video"}`);
        applyRemote({ videoId: m.videoId, position: 0, playing: true }); // routes through the ready/pending guard
        break;
      case "queue": setQueue(m.queue || []); break;
      case "allowControl": setAllowControl(!!m.value); sysMsg(m.value ? "Anyone can control playback now." : "Only the host controls playback now."); break;
      case "chat":
        setChat((c) => [...c.slice(-199), { name: m.name, avatar: m.avatar || avatarFor(m.name), text: m.text, self: m.from === selfId(), id: chatSeq++ }]);
        queueMicrotask(() => { if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight; });
        break;
      case "react": spawnFloater(m.emoji); break;
    }
  };

  // —— driver actions ————————————————————————————————————————————————————————
  // `token` is a canonical source token (yt:/vimeo:/file:/hls:).
  const loadVideo = (token: string, title = "") => { setNowPlaying(title); handle?.send({ t: "video", videoId: token, title }); }; // load happens when the echo returns (keeps curToken diff intact)
  const addToken = (token: string, title: string, playNow: boolean) => {
    if (playNow && driver()) loadVideo(token, title);
    else handle?.send({ t: "queue-add", videoId: token, title });
  };
  const addOrPlay = async (playNow: boolean) => {
    const raw = addInput().trim();
    if (!raw) return;
    setUnsupported("");
    if (/^https?:\/\//i.test(raw) || /^[\w-]{11}$/.test(raw)) { // it's a link/id → resolve to a playable source
      setSearching(true);
      const src = await resolveSourceAsync(raw).catch(() => null);
      setSearching(false);
      if (src) { setAddInput(""); setResults(null); addToken(sourceToken(src), "", playNow); sfx.confirm(); return; }
      setUnsupported(raw); sfx.deny(); return; // a link we can't control/sync
    }
    // plain text → search YouTube (Invidious network) and show pickable results
    setSearching(true); setResults(null);
    try { const r = await ytSearch(raw); setResults(r); } catch { setResults([]); } finally { setSearching(false); }
  };
  const pickResult = (v: YtVideo, playNow: boolean) => { addToken(sourceToken({ kind: "yt", ref: v.id }), v.title, playNow); if (!(playNow && driver())) sfx.tickH(); };
  const playNext = () => { const q = queue(); if (q.length && driver()) { handle?.send({ t: "queue-remove", index: 0 }); loadVideo(q[0].videoId, q[0].title); } };
  // Shared Browser: mint a Hyperbeam session server-side, broadcast its embed to
  // the room. Everyone loads the same real browser and co-controls it → any site,
  // in sync. Labs-gated + driver-only; the API key lives only in the Pages env.
  const startCobrowse = async () => {
    if (!driver() || cobrowseBusy()) return;
    setCobrowseBusy(true); sfx.confirm();
    try {
      const r = await fetch("/api/cobrowse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adblock: adblock(), region: region(), quality: quality(), closeOnEmpty: closeOnEmpty() }) });
      const j = await r.json() as { embedUrl?: string; error?: string };
      if (j.embedUrl) loadVideo(sourceToken({ kind: "cobrowse", ref: j.embedUrl }), "Shared browser");
      else { sysMsg(`Shared browser unavailable${j.error ? ` — ${j.error}` : ""}`); sfx.deny(); }
    } catch { sysMsg("Couldn't reach the shared-browser service."); sfx.deny(); }
    finally { setCobrowseBusy(false); }
  };

  const sendChat = () => { const t = chatInput().trim(); if (!t) return; handle?.send({ t: "chat", text: t }); setChatInput(""); };
  const react = (emoji: string) => { sfx.tickH(); handle?.send({ t: "react", emoji }); spawnFloater(emoji); };
  const spawnFloater = (emoji: string) => {
    const f = { id: floatSeq++, emoji, x: 6 + Math.random() * 78 };
    setFloaters((l) => [...l, f]);
    setTimeout(() => setFloaters((l) => l.filter((x) => x.id !== f.id)), 2600);
  };
  const toggleControl = () => { if (isHost()) { sfx.tickH(); handle?.send({ t: "allowControl", value: !allowControl() }); } };
  const syncNow = () => { sfx.confirm(); const s = roomState(); if (s) applyRemote(s); };
  const toggleFull = () => { sfx.tickH(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else videoBox?.requestFullscreen?.().catch(() => {}); };
  const cycleRegion = () => { sfx.tickH(); setRegion(region() === "NA" ? "EU" : region() === "EU" ? "AS" : "NA"); };
  const QUAL_NEXT = { smooth: "sharp", sharp: "saver", saver: "smooth" } as const;
  const QUAL_LABEL = { smooth: "Smooth", sharp: "Sharp HD", saver: "Data-saver" } as const;
  const cycleQuality = () => { sfx.tickH(); setQuality(QUAL_NEXT[quality()]); };
  const shareLink = () => `${location.origin}${location.pathname}?watch=${room()}`;
  const copyShare = async () => { try { await navigator.clipboard.writeText(shareLink()); sfx.confirm(); sysMsg("Invite link copied — send it to a friend."); } catch { sfx.deny(); } };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) { room() ? leave() : (sfx.back(), props.onClose()); } };
    addEventListener("keydown", onKey);
    onCleanup(() => removeEventListener("keydown", onKey));
    // deep link: ?watch=CODE → jump straight into that room
    const q = new URLSearchParams(location.search).get("watch");
    if (q && /^[A-Za-z0-9]{3,8}$/.test(q)) connect(q);
  });
  onCleanup(() => { handle?.close(); if (heartbeat) clearInterval(heartbeat); adapter?.destroy(); });

  const needTap = () => !!roomState()?.playing && !localPlaying() && hasVideo() && srcKind() !== "cobrowse";

  return (
    <div class="wp pad-focus-scope">
      <div class="wp-head">
        <div class="panel-tag">WATCH PARTY · SYNCED VIDEO</div>
        <div class="wp-head-right">
          <Show when={room()}>
            <span class="wp-status" classList={{ live: status() === "open" }}>{status() === "open" ? "● live" : "connecting…"}</span>
            <button class="ps-act" onClick={leave}><span class="btn-o" /> leave</button>
          </Show>
          <Show when={!room()}>
            <button class="ps-act" onClick={() => { sfx.back(); props.onClose(); }}><span class="btn-o" /> back</button>
          </Show>
        </div>
      </div>

      <Show when={!room()} fallback={
        <div class="wp-room">
          <div class="wp-stage">
            <div class="wp-video" ref={videoBox}>
              <div class="wp-player" ref={playerEl} />
              <Show when={!hasVideo()}>
                <div class="wp-empty">
                  <div class="wp-empty-big">🍿</div>
                  <p>Nothing playing yet.</p>
                  <Show when={driver()} fallback={<span class="wp-dim">Waiting for the host to start something…</span>}>
                    <span class="wp-dim">Paste a YouTube / Vimeo link or a direct video/stream URL (.mp4, .m3u8) — or search — then ▶ Play now.</span>
                  </Show>
                </div>
              </Show>
              <div class="wp-floaters"><For each={floaters()}>{(f) => <span class="wp-floater" style={{ left: `${f.x}%` }}>{f.emoji}</span>}</For></div>
              <Show when={needTap()}>
                <button class="wp-tap" onClick={syncNow}>▶ Tap to watch in sync</button>
              </Show>
            </div>

            <div class="wp-underbar">
              <div class="wp-reacts"><For each={REACTIONS}>{(e) => <button class="wp-react" onClick={() => react(e)}>{e}</button>}</For></div>
              <div class="wp-underbar-right">
                <Show when={srcKind() === "cobrowse"}><span class="wp-chip">🖥 shared browser · click &amp; type — paste any URL in its address bar<Show when={cobrowseUrl()}> · <a class="wp-linkbtn" href={cobrowseUrl()} target="_blank" rel="noopener noreferrer">won't load? open in a tab ↗</a></Show></span></Show>
                <Show when={srcKind() !== "cobrowse" && !driver()}><span class="wp-chip">🔒 host controls · <button class="wp-linkbtn" onClick={syncNow}>sync</button></span></Show>
                <Show when={srcKind() !== "cobrowse" && isHost()}>
                  <button class="wp-chip wp-toggle" classList={{ on: allowControl() }} onClick={toggleControl}>{allowControl() ? "✓ anyone can control" : "let anyone control"}</button>
                </Show>
                <Show when={driver() && labEnabled("cobrowse")}>
                  <button class="wp-chip" title="Cloud-browser region (auto-detected from your timezone). It's ONE server everyone shares — pick the one nearest most of the group. Tap to change." onClick={cycleRegion}>🌍 {region()} · auto</button>
                  <button class="wp-chip" title="Stream quality — Sharp is HD (~3× data); Smooth suits video; Data-saver for weak connections" onClick={cycleQuality}>✨ {QUAL_LABEL[quality()]}</button>
                  <button class="wp-chip" classList={{ on: adblock() }} title="Start the shared browser with uBlock Origin ad-blocker (set at launch)" onClick={() => { sfx.tickH(); setAdblock(!adblock()); }}>🛡 ad blocker {adblock() ? "on" : "off"}</button>
                  <button class="wp-chip" classList={{ on: closeOnEmpty() }} title="Close the shared browser automatically when everyone leaves (saves cost). Off = keep it alive ~30 min so you can rejoin." onClick={() => { sfx.tickH(); setCloseOnEmpty(!closeOnEmpty()); }}>🗑 close when empty {closeOnEmpty() ? "on" : "off"}</button>
                  <button class="wp-chip wp-chip-go" onClick={startCobrowse} disabled={cobrowseBusy()}>{cobrowseBusy() ? "opening…" : "🖥 shared browser"}</button>
                </Show>
                <Show when={driver() && srcKind() !== "cobrowse" && queue().length}><button class="wp-chip" onClick={playNext}>⏭ next ({queue().length})</button></Show>
                <Show when={hasVideo()}><button class="wp-chip" onClick={toggleFull}>⛶ full screen</button></Show>
              </div>
            </div>

            <div class="wp-add">
              <input class="wp-add-in" placeholder="YouTube · Vimeo · archive.org · .mp4 / .m3u8 link — or search YouTube…"
                value={addInput()} onInput={(e) => { setAddInput(e.currentTarget.value); setUnsupported(""); }}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") addOrPlay(driver()); }} />
              <Show when={driver()}><button class="wp-btn wp-btn-go" onClick={() => addOrPlay(true)}>▶ Play now</button></Show>
              <button class="wp-btn" onClick={() => addOrPlay(false)}>+ Queue</button>
            </div>
            <Show when={unsupported()}>
              <div class="wp-unsupported">
                <b>That's a web page, not a video we can sync.</b> A movie site plays inside its own player + scripts, blocks being embedded elsewhere, and gives us no way to read its play/pause — so we can't keep everyone aligned on it.
                <div class="wp-unsupported-fix">What works instead:
                  <ul>
                    <li><b>The direct video link</b> — a <code>.mp4</code> or <code>.m3u8</code> URL (the actual stream, not the page). On desktop: open the site, DevTools → Network → find the <code>.mp4</code>/<code>.m3u8</code> request → copy that URL here.</li>
                    <li><b>Old / rare films → Internet Archive.</b> Paste an <code>archive.org/details/…</code> link — it's a legal home for public-domain movies and plays here in sync. Also try the console's <b>Archive Cinema</b> app.</li>
                    <li><b>YouTube / Vimeo</b> links, of course.</li>
                  </ul>
                </div>
              </div>
            </Show>
            <Show when={searching() || results()}>
              <div class="wp-results">
                <Show when={!searching()} fallback={<span class="wp-dim">Searching…</span>}>
                  <For each={results()!.slice(0, 12)} fallback={<span class="wp-dim">Nothing found — paste a link instead.</span>}>{(v) => (
                    <button class="wp-result" onClick={() => pickResult(v, driver())} title={v.title}>
                      <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                      <span class="wp-result-title">{v.title}</span>
                    </button>
                  )}</For>
                </Show>
              </div>
            </Show>
          </div>

          <aside class="wp-side">
            <div class="wp-tabs">
              <button classList={{ on: tab() === "chat" }} onClick={() => setTab("chat")}>Chat</button>
              <button classList={{ on: tab() === "queue" }} onClick={() => setTab("queue")}>Queue{queue().length ? ` ${queue().length}` : ""}</button>
              <button classList={{ on: tab() === "people" }} onClick={() => setTab("people")}>People {members().length}</button>
            </div>

            <Show when={tab() === "chat"}>
              <div class="wp-chat" ref={chatScroll}>
                <For each={chat()} fallback={<div class="wp-dim wp-chat-empty">Say hi 👋 — reactions float over the video.</div>}>{(c) => (
                  <Show when={!c.sys} fallback={<div class="wp-sys">{c.text}</div>}>
                    <div class="wp-msg" classList={{ self: c.self }}><span class="wp-msg-av">{c.avatar}</span><span class="wp-msg-body"><b>{c.name}</b> {c.text}</span></div>
                  </Show>
                )}</For>
              </div>
              <div class="wp-chatbar">
                <input class="wp-chat-in" placeholder="Message…" value={chatInput()} maxLength={300}
                  onInput={(e) => setChatInput(e.currentTarget.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") sendChat(); }} />
                <button class="wp-btn" onClick={sendChat}>Send</button>
              </div>
            </Show>

            <Show when={tab() === "queue"}>
              <div class="wp-queue">
                <For each={queue()} fallback={<div class="wp-dim wp-chat-empty">Queue is empty. Add videos and they auto-play next.</div>}>{(item, i) => (
                  <div class="wp-qitem">
                    <img src={`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
                    <span class="wp-qtitle">{item.title || item.videoId}<span class="wp-dim"> · {item.by}</span></span>
                    <Show when={driver()}><button class="wp-qx" title="remove" onClick={() => handle?.send({ t: "queue-remove", index: i() })}>✕</button></Show>
                  </div>
                )}</For>
              </div>
            </Show>

            <Show when={tab() === "people"}>
              <div class="wp-people">
                <For each={members()}>{(mem) => (
                  <div class="wp-person"><span class="wp-msg-av">{mem.avatar || avatarFor(mem.name)}</span><span>{mem.name}{mem.id === selfId() ? " (you)" : ""}</span><Show when={mem.host}><span class="wp-hostbadge">HOST</span></Show></div>
                )}</For>
              </div>
            </Show>

            <div class="wp-invite">
              <div class="wp-code">Room <b>{room()}</b></div>
              <button class="wp-btn wp-btn-go" onClick={copyShare}>⧉ Copy invite link</button>
            </div>
          </aside>
        </div>
      }>
        {/* —— lobby —— */}
        <div class="wp-lobby">
          <div class="wp-lobby-hero">🍿🎬</div>
          <h2 class="wp-lobby-title">Watch together, wherever you are</h2>
          <p class="wp-lobby-sub">Start a room and share the code — everyone watches the same video in perfect sync (YouTube, Vimeo, or any direct video / live-stream link), with live chat, reactions and a shared queue. Host controls playback, or let everyone drive.</p>
          <div class="wp-lobby-actions">
            <button class="wp-big wp-big-go" onClick={host}>＋ Start a room</button>
            <div class="wp-or">or join</div>
            <div class="wp-joinrow">
              <input class="wp-code-in" placeholder="ROOM CODE" maxLength={8} value={codeInput()}
                onInput={(e) => setCodeInput(e.currentTarget.value.toUpperCase())}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") join(); }} />
              <button class="wp-big" onClick={join}>Join</button>
            </div>
          </div>
          <p class="wp-lobby-foot">Watching as <b>{me.avatar} {me.name}</b> · nothing is recorded — video streams straight from YouTube to each person.</p>
        </div>
      </Show>
    </div>
  );
}
