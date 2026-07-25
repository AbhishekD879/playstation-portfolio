import type { Plugin } from "vite";
import { WebSocketServer, type WebSocket } from "ws";

// Local multiplayer signaling — a tiny room + SDP/ICE relay for the PS2 WebRTC
// streaming feature. Runs INSIDE the Vite dev server (same origin, path "/mp"),
// so there's no second process and it works over LAN for a real 2nd device.
// Star topology: one host per room, N joiners; the server only forwards the
// WebRTC handshake between host and each joiner (no media touches it).
// Deploy note: for the internet this is replaced by a Cloudflare Durable Object
// speaking the same protocol — the client code doesn't change.

interface Room {
  host: WebSocket | null;
  joiners: Map<string, WebSocket>; // joinerId -> socket
  spectators: Map<string, WebSocket>; // watch-only; do NOT count against max
  max: number; // max joiners (2 players => 1)
  seq: number; // joiner id counter
  listing?: { title: string; kind: string; since: number; watchers: number };
}

// Dev mirror of the Cloudflare Directory DO — what's live on the console now.
const liveRooms = new Map<string, { code: string; title: string; kind: string; since: number; watchers: number; seats: number; max: number }>();
const recentRooms: { title: string; kind: string; at: number }[] = [];

const send = (ws: WebSocket | null | undefined, msg: unknown) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

/** Tell the host how many are watching, and keep the directory count honest. */
function announce(code: string, room: Room) {
  const n = room.spectators.size;
  send(room.host, { t: "watchers", n });
  const listed = liveRooms.get(code);
  if (listed) listed.watchers = n;
}

// —— watch party (dev mirror of the Cloudflare WatchRoom DO) ————————————————
// Broadcast hub: everyone in a room gets everyone else's playback/chat/queue
// messages, and late joiners get the cached state. Same protocol as the Worker
// so the client is identical bar the URL.
interface WatchMember { ws: WebSocket; name: string; avatar: string; joinedAt: number }
interface WatchRoomState {
  members: Map<string, WatchMember>;
  hostId: string | null;
  seq: number;
  state: { videoId: string; position: number; playing: boolean; ts: number };
  queue: { videoId: string; title: string; by: string }[];
  allowControl: boolean;
}

function wireWatch(rooms: Map<string, WatchRoomState>, roomCode: string, ws: WebSocket) {
  const room = rooms.get(roomCode) ?? { members: new Map(), hostId: null, seq: 0, state: { videoId: "", position: 0, playing: false, ts: 0 }, queue: [], allowControl: false };
  rooms.set(roomCode, room);
  let selfId = "";
  const roster = () => [...room.members.entries()].map(([id, m]) => ({ id, name: m.name, avatar: m.avatar, host: id === room.hostId }));
  const broadcast = (msg: unknown, exceptId?: string) => { for (const [id, m] of room.members) if (id !== exceptId) send(m.ws, msg); };

  ws.on("message", (buf) => {
    let m: any;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.t === "join") {
      selfId = `u${++room.seq}`;
      room.members.set(selfId, { ws, name: String(m.name || "Guest").slice(0, 24), avatar: String(m.avatar || "").slice(0, 8), joinedAt: Date.now() });
      if (!room.hostId) room.hostId = selfId;
      send(ws, { t: "welcome", id: selfId, hostId: room.hostId, state: room.state, queue: room.queue, allowControl: room.allowControl, members: roster() });
      broadcast({ t: "members", members: roster(), hostId: room.hostId }, selfId);
      return;
    }
    const me = room.members.get(selfId);
    if (!me) return;
    const isHost = selfId === room.hostId;
    const canDrive = isHost || room.allowControl;
    switch (m.t) {
      case "state":
        if (!canDrive) return;
        room.state = { videoId: String(m.videoId || ""), position: Number(m.position) || 0, playing: !!m.playing, ts: Date.now() };
        broadcast({ t: "state", ...room.state, by: selfId }, selfId);
        return;
      case "video":
        if (!canDrive) return;
        room.state = { videoId: String(m.videoId || ""), position: 0, playing: true, ts: Date.now() };
        broadcast({ t: "video", videoId: room.state.videoId, title: String(m.title || "").slice(0, 120), by: me.name });
        return;
      case "chat": broadcast({ t: "chat", from: selfId, name: me.name, avatar: me.avatar, text: String(m.text || "").slice(0, 300), ts: Date.now() }); return;
      case "react": broadcast({ t: "react", from: selfId, name: me.name, emoji: String(m.emoji || "").slice(0, 8) }); return;
      case "queue-add": if (room.queue.length < 200 && m.videoId) { room.queue.push({ videoId: String(m.videoId), title: String(m.title || "").slice(0, 120), by: me.name }); broadcast({ t: "queue", queue: room.queue }); } return;
      case "queue-remove": if (canDrive && Number.isInteger(m.index) && m.index >= 0 && m.index < room.queue.length) { room.queue.splice(m.index, 1); broadcast({ t: "queue", queue: room.queue }); } return;
      case "allowControl": if (isHost) { room.allowControl = !!m.value; broadcast({ t: "allowControl", value: room.allowControl }); } return;
    }
  });
  ws.on("close", () => {
    if (!room.members.has(selfId)) return;
    room.members.delete(selfId);
    if (selfId === room.hostId) {
      const next = [...room.members.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
      room.hostId = next ? next[0] : null;
    }
    if (room.members.size === 0) rooms.delete(roomCode);
    else broadcast({ t: "members", members: roster(), hostId: room.hostId });
  });
}

export function multiplayerSignaling(): Plugin {
  const rooms = new Map<string, Room>();
  const watchRooms = new Map<string, WatchRoomState>();

  return {
    name: "ps2-multiplayer-signaling",
    apply: "serve",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      const watchWss = new WebSocketServer({ noServer: true });

      // dev mirror of the Worker's /live — Console TV reads the same shape
      server.middlewares.use("/live", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ live: [...liveRooms.values()].sort((a, b) => b.since - a.since), recent: recentRooms }));
      });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        // only claim our paths — leave Vite's HMR upgrades alone
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/watch") {
          const room = (url.searchParams.get("room") || "").toUpperCase();
          watchWss.handleUpgrade(req, socket, head, (ws) => wireWatch(watchRooms, room, ws as unknown as WebSocket));
          return;
        }
        if (url.pathname !== "/mp") return;
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
      });

      wss.on("connection", (ws: WebSocket) => {
        // remember what this socket is, so cleanup on close is O(1)
        let role: "host" | "joiner" | null = null;
        let roomCode = "";
        let selfId = "";

        ws.on("message", (buf) => {
          let m: any;
          try { m = JSON.parse(buf.toString()); } catch { return; }

          if (m.t === "host") {
            roomCode = String(m.room || "").toUpperCase();
            if (!roomCode) return send(ws, { t: "error", msg: "no room code" });
            const existing = rooms.get(roomCode);
            if (existing && existing.host && existing.host.readyState === existing.host.OPEN) {
              return send(ws, { t: "error", msg: "room already hosted" });
            }
            const room: Room = existing ?? { host: null, joiners: new Map(), spectators: new Map(), max: 1, seq: 0 };
            room.host = ws;
            room.max = Math.max(1, Math.min(7, Number(m.max) || 1)); // six players => five joiners
            // opt-in only: no `listing`, no entry on Console TV
            if (m.listing && typeof m.listing.title === "string") {
              room.listing = { title: String(m.listing.title).slice(0, 60), kind: String(m.listing.kind || "").slice(0, 24), since: Date.now(), watchers: 0 };
              liveRooms.set(roomCode, { code: roomCode, ...room.listing, since: Date.now(), watchers: 0, seats: room.joiners.size, max: room.max });
            }
            rooms.set(roomCode, room);
            role = "host";
            send(ws, { t: "hosted", room: roomCode, max: room.max });
            return;
          }

          if (m.t === "join") {
            roomCode = String(m.room || "").toUpperCase();
            const room = rooms.get(roomCode);
            if (!room || !room.host) return send(ws, { t: "error", msg: "no such room" });
            const watching = m.as === "watch";
            const pool = watching ? room.spectators : room.joiners;
            if (pool.size >= (watching ? 24 : room.max)) return send(ws, { t: "error", msg: watching ? "too many watchers" : "room full" });
            selfId = `${watching ? "w" : "j"}${++room.seq}`;
            pool.set(selfId, ws);
            const syncSeats = () => { const L = liveRooms.get(roomCode); if (L) L.seats = room.joiners.size; };
            syncSeats();
            role = watching ? "spectator" : "joiner";
            send(ws, { t: "joined", room: roomCode, id: selfId });
            send(room.host, { t: "joiner", id: selfId, watch: watching }); // host kicks off the offer
            if (watching) announce(roomCode, room);
            return;
          }

          // relay handshake. "to" is a peerId (host->peer) or "host" (peer->host)
          if (m.t === "signal") {
            const room = rooms.get(roomCode);
            if (!room) return;
            if (role === "host") {
              send(room.joiners.get(m.to) ?? room.spectators.get(m.to), { t: "signal", from: "host", data: m.data });
            } else {
              send(room.host, { t: "signal", from: selfId, data: m.data });
            }
            return;
          }
        });

        ws.on("close", () => {
          const room = rooms.get(roomCode);
          if (!room) return;
          if (role === "host") {
            for (const j of [...room.joiners.values(), ...room.spectators.values()]) send(j, { t: "host-left" });
            const gone = liveRooms.get(roomCode);
            if (gone) {
              liveRooms.delete(roomCode);
              recentRooms.unshift({ title: gone.title, kind: gone.kind, at: Date.now() });
              recentRooms.splice(8);
            }
            rooms.delete(roomCode);
          } else if (role === "joiner") {
            room.joiners.delete(selfId);
            { const L = liveRooms.get(roomCode); if (L) L.seats = room.joiners.size; } // keep the dev lobby honest
            send(room.host, { t: "peer-left", id: selfId });
          } else if (role === "spectator") {
            room.spectators.delete(selfId);
            send(room.host, { t: "peer-left", id: selfId });
            announce(roomCode, room);
          }
        });
      });

      server.config.logger.info("  ➜  PS2 multiplayer signaling: ws /mp · watch party: ws /watch");
    },
  };
}
