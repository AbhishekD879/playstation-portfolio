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
async function iceConfig(): Promise<RTCIceServer[]> {
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
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } msgCbs.forEach((cb) => cb(m)); };
  ws.onopen = () => openCbs.forEach((cb) => cb());
  ws.onclose = () => closeCbs.forEach((cb) => cb());
  return {
    send: (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
    onMessage: (cb) => msgCbs.push(cb),
    onOpen: (cb) => { if (ws.readyState === WebSocket.OPEN) cb(); else openCbs.push(cb); },
    onClose: (cb) => closeCbs.push(cb),
    close: () => ws.close(),
  };
}

// —— one host<->joiner connection ————————————————————————————————————————
// Buffers ICE candidates that arrive before the remote description is set (a
// classic WebRTC race), and flushes them once it is.
function makePeer(iceServers: RTCIceServer[], onIce: (c: RTCIceCandidate) => void) {
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
  stop(): void;
}

export function startHost(opts: {
  room: string;
  max: number;
  stream: MediaStream;
  onJoinerInput: (joinerId: string, data: any) => void;
  onJoinerChange?: (ids: string[]) => void;
  onStatus?: (s: string) => void;
}): HostHandle {
  const sig = connectSignaling(opts.room);
  const peers = new Map<string, ReturnType<typeof makePeer>>();
  const notify = () => opts.onJoinerChange?.([...peers.keys()]);

  sig.onOpen(() => { sig.send({ t: "host", room: opts.room, max: opts.max }); });
  sig.onClose(() => opts.onStatus?.("signaling closed"));

  sig.onMessage(async (m) => {
    if (m.t === "hosted") { opts.onStatus?.("waiting for players"); return; }
    if (m.t === "error") { opts.onStatus?.(`error: ${m.msg}`); return; }

    if (m.t === "joiner") {
      const id = m.id as string;
      const ice = await iceConfig();
      const peer = makePeer(ice, (c) => sig.send({ t: "signal", to: id, data: { candidate: c } }));
      peers.set(id, peer);
      notify();
      // host is the media sender + offerer
      for (const track of opts.stream.getTracks()) peer.pc.addTrack(track, opts.stream);
      const dc = peer.pc.createDataChannel("input", { ordered: true });
      dc.onmessage = (e) => { try { opts.onJoinerInput(id, JSON.parse(e.data)); } catch { /* ignore */ } };
      peer.pc.onconnectionstatechange = () => {
        opts.onStatus?.(`player ${id}: ${peer.pc.connectionState}`);
        if (["failed", "closed", "disconnected"].includes(peer.pc.connectionState)) {
          peers.delete(id); notify();
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

    if (m.t === "peer-left") { peers.get(m.id)?.pc.close(); peers.delete(m.id); notify(); }
  });

  return {
    joiners: () => [...peers.keys()],
    stop: () => { for (const p of peers.values()) p.pc.close(); peers.clear(); sig.close(); },
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

  sig.onOpen(() => sig.send({ t: "join", room: opts.room }));
  sig.onClose(() => opts.onStatus?.("signaling closed"));
  sig.onMessage(handle);

  return {
    sendInput: (data) => { if (dc && dc.readyState === "open") dc.send(JSON.stringify(data)); },
    stop: () => { peer?.pc.close(); sig.close(); },
  };
}
