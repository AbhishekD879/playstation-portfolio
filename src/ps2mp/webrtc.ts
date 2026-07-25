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
  onWatcherChange?: (n: number) => void;
  onStatus?: (s: string) => void;
}): HostHandle {
  const sig = connectSignaling(opts.room);
  const peers = new Map<string, ReturnType<typeof makePeer>>();
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
      // A spectator gets NO input channel — the point of watching is that you
      // can't touch the game. Not creating it is the enforcement, not a UI rule.
      if (!isWatcher) {
        const dc = peer.pc.createDataChannel("input", { ordered: true });
        dc.onmessage = (e) => { try { opts.onJoinerInput(id, JSON.parse(e.data)); } catch { /* ignore */ } };
      }
      peer.pc.onconnectionstatechange = () => {
        opts.onStatus?.(`${isWatcher ? "watcher" : "player"} ${id}: ${peer.pc.connectionState}`);
        if (["failed", "closed", "disconnected"].includes(peer.pc.connectionState)) {
          peers.delete(id); watching.delete(id); notify();
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

    if (m.t === "peer-left") { peers.get(m.id)?.pc.close(); peers.delete(m.id); watching.delete(m.id); notify(); }
  });

  return {
    joiners: () => [...peers.keys()].filter((id) => !watching.has(id)),
    watchers: () => watcherCount,
    stop: () => { for (const p of peers.values()) p.pc.close(); peers.clear(); watching.clear(); sig.close(); },
  };
}

export interface JoinerHandle {
  sendInput(data: Record<string, unknown>): void;
  stop(): void;
}

export function startJoiner(opts: {
  room: string;
  onStream: (stream: MediaStream) => void;
  onStatus?: (s: string) => void;
  /** watch-only: takes no player slot and gets no input channel */
  watch?: boolean;
}): JoinerHandle {
  const sig = connectSignaling(opts.room);
  let dc: RTCDataChannel | null = null;
  let peer: ReturnType<typeof makePeer> | null = null;
  const early: any[] = []; // signals that arrive before ICE config resolves

  const handle = async (m: any) => {
    if (m.t === "joined") { opts.onStatus?.("connecting"); return; }
    if (m.t === "error") { opts.onStatus?.(`error: ${m.msg}`); return; }
    if (m.t === "host-left") { opts.onStatus?.("host left"); return; }
    if (m.t !== "signal") return;
    if (!peer) { early.push(m); return; } // buffer until the peer exists
    if (m.data.sdp) { // the offer
      await peer.setRemote(m.data.sdp);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sig.send({ t: "signal", to: "host", data: { sdp: peer.pc.localDescription } });
    } else if (m.data.candidate) {
      await peer.addCandidate(m.data.candidate);
    }
  };

  iceConfig().then((ice) => {
    peer = makePeer(ice, (c) => sig.send({ t: "signal", to: "host", data: { candidate: c } }));
    peer.pc.ontrack = (e) => { if (e.streams[0]) opts.onStream(e.streams[0]); };
    peer.pc.ondatachannel = (e) => { dc = e.channel; };
    peer.pc.onconnectionstatechange = () => peer && opts.onStatus?.(peer.pc.connectionState);
    for (const m of early.splice(0)) handle(m); // drain buffered offers/candidates
  });

  sig.onOpen(() => sig.send({ t: "join", room: opts.room, as: opts.watch ? "watch" : undefined }));
  sig.onClose(() => opts.onStatus?.("signaling closed"));
  sig.onMessage(handle);

  return {
    sendInput: (data) => { if (dc && dc.readyState === "open") dc.send(JSON.stringify(data)); },
    stop: () => { peer?.pc.close(); sig.close(); },
  };
}

// —— Console TV directory ——————————————————————————————————————————————————
export interface LiveRoom { code: string; title: string; kind: string; since: number; watchers: number }
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
