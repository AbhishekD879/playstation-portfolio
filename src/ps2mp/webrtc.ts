// PS2 multiplayer transport — host-authoritative WebRTC streaming.
// The HOST runs the emulator, captures its canvas, and streams video to each
// joiner; joiners send controller input back over a data channel. The host
// injects that input as controller port 2/3/4 (see p2inject.ts). Signaling is
// the local Vite plugin at ws /mp (star topology: host <-> each joiner).
//
// Roles are fixed: the host is always the WebRTC offerer and media sender, the
// joiner always answers — so there's no glare/negotiation dance, just one
// offer/answer + ICE per joiner.

// In dev, signaling is the same-origin Vite plugin (ws /mp) and localhost/LAN
// peers connect on host candidates alone — no STUN/TURN needed. In production,
// signaling + TURN live in a standalone Worker (deps/mp-worker) reached over the
// internet, so we point at it and fetch real ICE servers (STUN + TURN) from it.
const MP_HOST = "abhishekstation-mp.abhishekdiwate879.workers.dev";
const isDev = import.meta.env.DEV;

const wsUrl = (room: string) => {
  const q = `?room=${encodeURIComponent(room)}`;
  return isDev
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/mp${q}`
    : `wss://${MP_HOST}/mp${q}`;
};

// Fetched per connection attempt — TURN creds expire (24h TTL), so a page-
// lifetime cache would hand stale creds to a long-lived tab. Dev: none
// (local candidates). Prod: ask the Worker (Cloudflare STUN + TURN).
export async function iceConfig(): Promise<RTCIceServer[]> {
  if (isDev) return [];
  try {
    const r = await fetch(`https://${MP_HOST}/turn`);
    if (r.ok) { const d = await r.json(); if (Array.isArray(d?.iceServers)) return d.iceServers as RTCIceServer[]; }
  } catch { /* fall through */ }
  return [{ urls: "stun:stun.cloudflare.com:3478" }];
}

import { GONE_ATTEMPTS, backoffMs, classify, retryLabel, shouldRetry, type Health } from "./reconnect";

export interface Signaling {
  send(msg: Record<string, unknown>): void;
  onMessage(cb: (m: any) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export function connectSignaling(room: string): Signaling {
  const ws = new WebSocket(wsUrl(room));
  const msgCbs: ((m: any) => void)[] = [];
  const openCbs: (() => void)[] = [];
  const closeCbs: (() => void)[] = [];
  // Keepalive: a tiny no-op the server ignores, so a quiet signaling socket
  // (idle once the datachannel is up) never gets idle-closed by the edge/proxy.
  // Without it the WS silently dies and reconnection/new joiners can't signal.
  const ka = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}'); }, 25000);
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m?.t === "pong") return; msgCbs.forEach((cb) => cb(m)); };
  ws.onopen = () => openCbs.forEach((cb) => cb());
  ws.onclose = () => { clearInterval(ka); closeCbs.forEach((cb) => cb()); };
  return {
    send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    onMessage: (cb) => msgCbs.push(cb),
    onOpen: (cb) => { if (ws.readyState === WebSocket.OPEN) cb(); else openCbs.push(cb); },
    onClose: (cb) => closeCbs.push(cb),
    close: () => { clearInterval(ka); ws.close(); },
  };
}

// —— one host<->joiner connection ————————————————————————————————————————
// Buffers ICE candidates that arrive before the remote description is set (a
// classic WebRTC race), and flushes them once it is.
export function makePeer(iceServers: RTCIceServer[], onIce: (c: RTCIceCandidate) => void) {
  const pc = new RTCPeerConnection({ iceServers });
  // DEV: a bounded ring of live connections, so getStats() is reachable from a
  // test without threading a handle out of every caller. Stripped from prod.
  if (import.meta.env?.DEV) {
    const pcs = ((globalThis as any).__pcs ??= []) as RTCPeerConnection[];
    pcs.push(pc);
    if (pcs.length > 8) pcs.shift();
  }
  const pending: RTCIceCandidateInit[] = [];
  let remoteSet = false;
  pc.onicecandidate = (e) => { if (e.candidate) onIce(e.candidate); };
  const addCandidate = async (c: RTCIceCandidateInit) => {
    if (!remoteSet) { pending.push(c); return; }
    try { await pc.addIceCandidate(c); } catch { /* ignore late/dupe */ }
  };
  const setRemote = async (desc: RTCSessionDescriptionInit) => {
    await pc.setRemoteDescription(desc);
    remoteSet = true;
    for (const c of pending.splice(0)) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
  };
  return { pc, addCandidate, setRemote };
}

export interface HostHandle {
  joiners(): string[];
  /** how many people are watching without playing */
  watchers(): number;
  /** send on one joiner's channel; silently drops if it isn't open yet */
  send(joinerId: string, msg: unknown): void;
  /** send to every connected player */
  broadcast(msg: unknown): void;
  stop(): void;
}

export function startHost(opts: {
  room: string;
  max: number;
  stream?: MediaStream; // omit for data-only hosts (e.g. the phone controller)
  /** Present = advertise this room on Console TV. Absent = private, unlisted. */
  listing?: { title: string; kind: string };
  onJoinerInput: (joinerId: string, data: any) => void;
  onJoinerChange?: (ids: string[]) => void;
  /** that joiner's channel is open — safe to send them the roster */
  onJoinerReady?: (joinerId: string) => void;
  /** Per-joiner voice mix track, added to the FIRST offer alongside the video.
   *  Returning it up front is what avoids ever renegotiating: mute, join and
   *  leave become WebAudio edges instead of offer/answer round trips. */
  voiceTrackFor?: (joinerId: string) => MediaStreamTrack | null;
  /** that joiner's microphone arrived */
  onJoinerAudio?: (joinerId: string, stream: MediaStream) => void;
  /** joiner gone — drop them from the voice mix and the roster */
  onJoinerLeft?: (joinerId: string) => void;
  onWatcherChange?: (n: number) => void;
  onStatus?: (s: string) => void;
}): HostHandle {
  const sig = connectSignaling(opts.room);
  const peers = new Map<string, ReturnType<typeof makePeer>>();
  // The input channel is bidirectional and was previously write-only from the
  // joiner side. Keeping the host's end lets roster and chat ride the same
  // channel instead of opening a second one — no extra negotiation, and a
  // player who can send input can always be talked to.
  const channels = new Map<string, RTCDataChannel>();
  // Spectators live in the same peer map (they need the same offer/ICE dance)
  // but are tracked separately so they never look like players to the caller.
  const watching = new Set<string>();
  let watcherCount = 0;
  const notify = () => opts.onJoinerChange?.([...peers.keys()].filter((id) => !watching.has(id)));

  sig.onOpen(() => { sig.send({ t: "host", room: opts.room, max: opts.max, listing: opts.listing }); });
  sig.onClose(() => opts.onStatus?.("signaling closed"));

  sig.onMessage(async (m) => {
    if (m.t === "hosted") { opts.onStatus?.("waiting for players"); return; }
    if (m.t === "error") { opts.onStatus?.(`error: ${m.msg}`); return; }
    if (m.t === "watchers") { watcherCount = Number(m.n) || 0; opts.onWatcherChange?.(watcherCount); return; }

    if (m.t === "joiner") {
      const id = m.id as string;
      const isWatcher = !!m.watch;
      if (isWatcher) watching.add(id);
      const ice = await iceConfig();
      const peer = makePeer(ice, (c) => sig.send({ t: "signal", to: id, data: { candidate: c } }));
      peers.set(id, peer);
      notify();
      // host is the media sender + offerer (video only when a stream exists)
      if (opts.stream) for (const track of opts.stream.getTracks()) peer.pc.addTrack(track, opts.stream);
      // voice: this joiner's own mix (everyone but them), and their mic back
      if (!isWatcher) {
        const voice = opts.voiceTrackFor?.(id);
        if (voice) peer.pc.addTrack(voice, new MediaStream([voice]));
        peer.pc.ontrack = (e) => {
          // A joiner's mic arrives with NO msid: it is put on the transceiver the
          // offer created, not added with a stream of its own, so e.streams is
          // empty here. Wrapping the track ourselves is what makes the mic
          // audible at all — requiring a stream silently dropped every joiner.
          if (e.track.kind !== "audio") return;
          opts.onJoinerAudio?.(id, e.streams[0] ?? new MediaStream([e.track]));
        };
      }
      // A spectator gets NO input channel — the point of watching is that you
      // can't touch the game. Not creating it is the enforcement, not a UI rule.
      if (!isWatcher) {
        const dc = peer.pc.createDataChannel("input", { ordered: true });
        channels.set(id, dc);
        dc.onopen = () => opts.onJoinerReady?.(id);
        dc.onmessage = (e) => { try { opts.onJoinerInput(id, JSON.parse(e.data)); } catch { /* ignore */ } };
      }
      peer.pc.onconnectionstatechange = () => {
        opts.onStatus?.(`${isWatcher ? "watcher" : "player"} ${id}: ${peer.pc.connectionState}`);
        if (["failed", "closed", "disconnected"].includes(peer.pc.connectionState)) {
          peers.delete(id); watching.delete(id); channels.delete(id);
          opts.onJoinerLeft?.(id);
          notify();
        }
      };
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      sig.send({ t: "signal", to: id, data: { sdp: peer.pc.localDescription } });
      return;
    }

    if (m.t === "signal") {
      const peer = peers.get(m.from);
      if (!peer) return;
      if (m.data.sdp) await peer.setRemote(m.data.sdp);       // the answer
      else if (m.data.candidate) await peer.addCandidate(m.data.candidate);
      return;
    }

    if (m.t === "peer-left") {
      peers.get(m.id)?.pc.close(); peers.delete(m.id); watching.delete(m.id); channels.delete(m.id);
      opts.onJoinerLeft?.(m.id);
      notify();
    }
  });

  const sendTo = (id: string, msg: unknown) => {
    const dc = channels.get(id);
    if (dc && dc.readyState === "open") { try { dc.send(JSON.stringify(msg)); } catch { /* channel died mid-send */ } }
  };
  return {
    joiners: () => [...peers.keys()].filter((id) => !watching.has(id)),
    watchers: () => watcherCount,
    send: sendTo,
    broadcast: (msg) => { for (const id of channels.keys()) sendTo(id, msg); },
    stop: () => { for (const p of peers.values()) p.pc.close(); peers.clear(); watching.clear(); channels.clear(); sig.close(); },
  };
}

export interface JoinerHandle {
  sendInput(data: Record<string, unknown>): void;
  /** same channel as input, for roster/chat traffic */
  send(msg: unknown): void;
  /** Put a live mic on the slot reserved at connect time. Safe to call any
   *  time, including before the connection is up; null stops sending. */
  setMic(track: MediaStreamTrack | null): void;
  stop(): void;
}

export function startJoiner(opts: {
  room: string;
  onStream: (stream: MediaStream) => void;
  onStatus?: (s: string) => void;
  /** host -> joiner traffic on the input channel (roster, chat) */
  onMessage?: (data: any) => void;
  /** fires once the channel is open, so the joiner can announce itself */
  onReady?: () => void;
  /** the host's voice mix for us — play it, don't graph it */
  onAudio?: (stream: MediaStream) => void;
  /** watch-only: takes no player slot and gets no input channel */
  watch?: boolean;
}): JoinerHandle {
  const sig = connectSignaling(opts.room);
  let dc: RTCDataChannel | null = null;
  let peer: ReturnType<typeof makePeer> | null = null;
  let micSender: RTCRtpSender | null = null;
  const early: any[] = []; // signals that arrive before ICE config resolves

  const handle = async (m: any) => {
    if (m.t === "joined") { opts.onStatus?.("connecting"); return; }
    if (m.t === "error") { opts.onStatus?.(`error: ${m.msg}`); return; }
    if (m.t === "host-left") { opts.onStatus?.("host left"); return; }
    if (m.t !== "signal") return;
    if (!peer) { early.push(m); return; } // buffer until the peer exists
    if (m.data.sdp) { // the offer
      await peer.setRemote(m.data.sdp);
      // ★ Claim the mic slot from the OFFER, never before it.
      //
      // Adding our own audio transceiver ahead of setRemoteDescription would
      // put an m-line in the answer that the offer never had — illegal, and it
      // breaks every host that offers no audio at all (the phone controller and
      // retro netplay both do exactly that). Adopting the transceiver the offer
      // created costs no renegotiation and leaves voice-less hosts negotiating
      // byte-for-byte as they did before.
      if (!opts.watch) {
        const t = peer.pc.getTransceivers().find((x) => x.receiver.track?.kind === "audio");
        if (t) { try { t.direction = "sendrecv"; micSender = t.sender; } catch { /* older engine */ } }
      }
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sig.send({ t: "signal", to: "host", data: { sdp: peer.pc.localDescription } });
    } else if (m.data.candidate) {
      await peer.addCandidate(m.data.candidate);
    }
  };

  iceConfig().then((ice) => {
    peer = makePeer(ice, (c) => sig.send({ t: "signal", to: "host", data: { candidate: c } }));
    peer.pc.ontrack = (e) => {
      // the game canvas and the voice mix arrive as separate streams
      if (e.track.kind === "audio") { opts.onAudio?.(e.streams[0] ?? new MediaStream([e.track])); return; }
      if (e.streams[0]) opts.onStream(e.streams[0]);
    };
    peer.pc.ondatachannel = (e) => {
      dc = e.channel;
      dc.onmessage = (ev) => { try { opts.onMessage?.(JSON.parse(ev.data)); } catch { /* ignore */ } };
      if (dc.readyState === "open") opts.onReady?.();
      else dc.onopen = () => opts.onReady?.();
    };
    peer.pc.onconnectionstatechange = () => peer && opts.onStatus?.(peer.pc.connectionState);
    for (const m of early.splice(0)) handle(m); // drain buffered offers/candidates
  });

  sig.onOpen(() => sig.send({ t: "join", room: opts.room, as: opts.watch ? "watch" : undefined }));
  sig.onClose(() => opts.onStatus?.("signaling closed"));
  sig.onMessage(handle);

  const send = (data: unknown) => {
    if (dc && dc.readyState === "open") { try { dc.send(JSON.stringify(data)); } catch { /* ignore */ } }
  };
  return {
    sendInput: send,
    send,
    setMic: (track) => { micSender?.replaceTrack(track).catch(() => {}); },
    stop: () => { peer?.pc.close(); sig.close(); },
  };
}

// —— Console TV directory ——————————————————————————————————————————————————
/** A room code: four characters from an alphabet with no ambiguous 0/O or 1/I,
 *  because the first thing anyone does with one is read it out loud. */
export function makeRoomCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = new Uint32Array(4);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => A[n % A.length]).join("");
}

export interface LiveRoom { code: string; title: string; kind: string; since: number; watchers: number; seats: number; max: number }
export interface Marquee { live: LiveRoom[]; recent: { title: string; kind: string; at: number }[] }

/** What's playing on the console right now. Best-effort: an unreachable
 *  directory means an empty channel, never a broken one. */
export async function fetchLive(): Promise<Marquee> {
  try {
    const r = await fetch(isDev ? "/live" : `https://${MP_HOST}/live`, { cache: "no-store" });
    if (!r.ok) return { live: [], recent: [] };
    const d = await r.json();
    return { live: Array.isArray(d?.live) ? d.live : [], recent: Array.isArray(d?.recent) ? d.recent : [] };
  } catch {
    return { live: [], recent: [] };
  }
}


// ── auto-reconnect ─────────────────────────────────────────────────────────
// A dropped session is REBUILT rather than repaired: ICE state after a network
// change is not worth salvaging, and a fresh join re-runs the seat allocation
// so a returning player lands back in a real slot. The handle stays valid
// across reconnects, so callers never hold a dead reference.

export interface ResilientJoiner extends JoinerHandle {
  /** attempts since the last good connection; 0 while healthy */
  attempt(): number;
}

export function startJoinerResilient(opts: {
  room: string;
  onStream: (stream: MediaStream) => void;
  onStatus?: (s: string) => void;
  /** fires whenever the link drops or comes back, for the reconnect banner */
  onHealth?: (h: Health, attempt: number, label: string) => void;
  onMessage?: (data: any) => void;
  /** fires on every (re)connect, so the joiner re-announces itself and the
   *  host can rebuild a roster entry it dropped during the outage */
  onReady?: () => void;
  onAudio?: (stream: MediaStream) => void;
  watch?: boolean;
}): ResilientJoiner {
  let inner: JoinerHandle | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    inner = startJoiner({
      room: opts.room,
      watch: opts.watch,
      onStream: opts.onStream,
      onMessage: opts.onMessage,
      onReady: opts.onReady,
      onAudio: opts.onAudio,
      onStatus: (raw) => {
        opts.onStatus?.(raw);
        if (stopped) return;
        const h = classify(raw);
        if (h === "connected") {
          if (attempt > 0) opts.onHealth?.("connected", 0, "Back in the game");
          attempt = 0;
          return;
        }
        if (!shouldRetry(h, attempt)) {
          // out of patience on a host that is not coming back: report it once
          // as terminal and stop, rather than leaving a dead session on screen
          if (h === "gone") {
            stopped = true;
            try { inner?.stop(); } catch { /* already gone */ }
            inner = null;
            opts.onHealth?.("gone", attempt, retryLabel("gone", GONE_ATTEMPTS));
          }
          return;
        }
        // one retry in flight at a time — several status events can report the
        // same drop, and each must not start its own timer
        if (timer) return;
        attempt++;
        opts.onHealth?.(h, attempt, retryLabel(h, attempt));
        const wait = backoffMs(attempt);
        timer = setTimeout(() => {
          timer = undefined;
          try { inner?.stop(); } catch { /* already gone */ }
          inner = null;
          connect();
        }, wait);
      },
    });
  };
  connect();

  return {
    sendInput: (data) => inner?.sendInput(data),
    send: (msg) => inner?.send(msg),
    // a rebuilt session has a brand-new sender, so the mic is re-applied by the
    // caller on every onReady rather than remembered here
    setMic: (track) => inner?.setMic(track),
    attempt: () => attempt,
    stop: () => {
      stopped = true;                       // classify() treats this as final
      if (timer) clearTimeout(timer);
      timer = undefined;
      inner?.stop();
      inner = null;
    },
  };
}
