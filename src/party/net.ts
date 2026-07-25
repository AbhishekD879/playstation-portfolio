// Party-games transport — bidirectional JSON over WebRTC DataChannels, host ↔
// each phone. Reuses the console's existing signaling worker + TURN + peer
// helpers (same rig as PS2 multiplayer / CS), so no new infra. Unlike the PS2
// path (host streams video, joiner sends input), party games are data-only and
// two-way: the host sends each phone a "screen" to render and receives its
// inputs. Star topology: host is authoritative, phones are dumb terminals.
//
// Resilience: both ends heartbeat the datachannel so a quiet connection (a
// player reading a question, a phone between rounds) can't be idle-timed-out by
// a NAT; and the joiner AUTO-RECONNECTS after a drop (phone screen-lock, wifi
// blip) instead of kicking the player. Re-identifying the same player across a
// reconnect is the app's job (it re-sends its join, carrying a stable id).
import { connectSignaling, iceConfig, makePeer } from "../ps2mp/webrtc";

const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
export const newPartyCode = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
export const partyUrl = (code: string) => `${location.origin}/?party=${code}`;

const PING = 4000; // datachannel heartbeat — keeps NAT bindings warm
const isPing = (d: any) => d && d.__k === 1;

export interface PartyHostHandle {
  broadcast(msg: unknown): void;
  send(id: string, msg: unknown): void;
  players(): string[];
  stop(): void;
}

/** Host a party room. cb.onMessage(id, msg) fires for every peer message.
 * `max` caps how many peers may join (party = 7; board games = 1). */
export function partyHost(room: string, cb: {
  onJoin: (id: string) => void;
  onLeave: (id: string) => void;
  onMessage: (id: string, msg: any) => void;
  onStatus?: (s: string) => void;
}, max = 7): PartyHostHandle {
  const sig = connectSignaling(room);
  const peers = new Map<string, { peer: ReturnType<typeof makePeer>; dc?: RTCDataChannel }>();

  sig.onOpen(() => sig.send({ t: "host", room, max }));
  sig.onClose(() => cb.onStatus?.("signaling closed"));
  sig.onMessage(async (m: any) => {
    if (m.t === "hosted") { cb.onStatus?.("room open"); return; }
    if (m.t === "error") { cb.onStatus?.(`error: ${m.msg}`); return; }
    if (m.t === "joiner") {
      const id = m.id as string;
      const ice = await iceConfig();
      const peer = makePeer(ice, (c) => sig.send({ t: "signal", to: id, data: { candidate: c } }));
      const entry: { peer: typeof peer; dc?: RTCDataChannel } = { peer };
      peers.set(id, entry);
      const dc = peer.pc.createDataChannel("party", { ordered: true });
      entry.dc = dc;
      dc.onopen = () => cb.onJoin(id);
      dc.onclose = () => { if (peers.delete(id)) cb.onLeave(id); };
      dc.onmessage = (e) => { try { const d = JSON.parse(e.data); if (isPing(d)) return; cb.onMessage(id, d); } catch { /* junk */ } };
      peer.pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.pc.connectionState)) { if (peers.delete(id)) cb.onLeave(id); }
      };
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      sig.send({ t: "signal", to: id, data: { sdp: peer.pc.localDescription } });
      return;
    }
    if (m.t === "signal") {
      const e = peers.get(m.from);
      if (!e) return;
      if (m.data.sdp) await e.peer.setRemote(m.data.sdp);
      else if (m.data.candidate) await e.peer.addCandidate(m.data.candidate);
      return;
    }
    if (m.t === "peer-left") { peers.get(m.id)?.peer.pc.close(); if (peers.delete(m.id)) cb.onLeave(m.id); }
  });

  const openDcs = () => [...peers.entries()].filter(([, e]) => e.dc?.readyState === "open");
  const ka = setInterval(() => { for (const [, e] of openDcs()) { try { e.dc!.send('{"__k":1}'); } catch { /* closing */ } } }, PING);
  return {
    broadcast: (msg) => { const s = JSON.stringify(msg); for (const [, e] of openDcs()) e.dc!.send(s); },
    send: (id, msg) => { const e = peers.get(id); if (e?.dc?.readyState === "open") e.dc.send(JSON.stringify(msg)); },
    players: () => openDcs().map(([id]) => id),
    stop: () => { clearInterval(ka); for (const e of peers.values()) e.peer.pc.close(); peers.clear(); sig.close(); },
  };
}

export interface PartyJoinHandle { send(msg: unknown): void; stop(): void }

/** Join a party room from a phone. With `reconnect`, a dropped connection is
 *  re-established automatically (backoff, capped) and cb.onOpen fires again so
 *  the app can re-announce itself; cb.onClose only fires on a permanent give-up
 *  or an explicit stop(). Without it, a drop calls cb.onClose once (old behaviour). */
export function partyJoin(room: string, cb: {
  onOpen: () => void;
  onMessage: (msg: any) => void;
  onClose: () => void;
  onStatus?: (s: string) => void;
}, opts?: { reconnect?: boolean }): PartyJoinHandle {
  let sig: ReturnType<typeof connectSignaling> | null = null;
  let peer: ReturnType<typeof makePeer> | null = null;
  let dc: RTCDataChannel | null = null;
  let ka: ReturnType<typeof setInterval> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let dropping = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 8;

  const clearTimers = () => { if (ka) { clearInterval(ka); ka = null; } if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
  const teardown = () => { clearTimers(); try { peer?.pc.close(); } catch { /* */ } peer = null; dc = null; try { sig?.close(); } catch { /* */ } sig = null; };

  const onDrop = () => {
    if (stopped || dropping) return;
    dropping = true;
    teardown();
    if (!opts?.reconnect || attempts >= MAX_ATTEMPTS) { cb.onClose(); return; }
    attempts++;
    cb.onStatus?.(`reconnecting… (${attempts})`);
    const delay = Math.min(400 * attempts, 3000);
    setTimeout(() => { if (stopped) return; dropping = false; connect(); }, delay);
  };

  const connect = () => {
    const s = connectSignaling(room);
    sig = s;
    const early: any[] = [];
    const handle = async (m: any) => {
      if (m.t === "joined") { cb.onStatus?.("connecting…"); return; }
      if (m.t === "error") { cb.onStatus?.(`error: ${m.msg}`); onDrop(); return; } // e.g. host not up yet → retry
      if (m.t === "host-left") { onDrop(); return; }
      if (m.t !== "signal") return;
      if (!peer) { early.push(m); return; }
      if (m.data.sdp) {
        await peer.setRemote(m.data.sdp);
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        s.send({ t: "signal", to: "host", data: { sdp: peer.pc.localDescription } });
      } else if (m.data.candidate) await peer.addCandidate(m.data.candidate);
    };

    // if the datachannel isn't open within a few seconds, the handshake stalled
    // (host busy/away, dropped offer) — tear down and retry.
    watchdog = setTimeout(() => { if (dc?.readyState !== "open") onDrop(); }, 7000);

    iceConfig().then((ice) => {
      if (stopped || sig !== s) return; // a newer attempt superseded this one
      const p = makePeer(ice, (c) => s.send({ t: "signal", to: "host", data: { candidate: c } }));
      peer = p;
      p.pc.ondatachannel = (e) => {
        if (e.channel.label !== "party") return;
        dc = e.channel;
        dc.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (isPing(d)) return; cb.onMessage(d); } catch { /* junk */ } };
        dc.onopen = () => {
          if (watchdog) { clearTimeout(watchdog); watchdog = null; }
          attempts = 0;
          ka = setInterval(() => { if (dc?.readyState === "open") { try { dc.send('{"__k":1}'); } catch { /* */ } } }, PING);
          cb.onOpen();
        };
        dc.onclose = () => onDrop();
      };
      p.pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(p.pc.connectionState)) onDrop(); };
      for (const m of early.splice(0)) void handle(m);
    });
    s.onOpen(() => s.send({ t: "join", room }));
    s.onMessage(handle);
  };

  connect();
  return {
    send: (msg) => { if (dc?.readyState === "open") dc.send(JSON.stringify(msg)); },
    stop: () => { stopped = true; teardown(); },
  };
}
