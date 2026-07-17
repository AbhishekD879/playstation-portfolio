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
  max: number; // max joiners (2 players => 1)
  seq: number; // joiner id counter
}

const send = (ws: WebSocket | null | undefined, msg: unknown) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

export function multiplayerSignaling(): Plugin {
  const rooms = new Map<string, Room>();

  return {
    name: "ps2-multiplayer-signaling",
    apply: "serve",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        // only claim our path — leave Vite's HMR upgrades alone
        const url = new URL(req.url ?? "/", "http://localhost");
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
            const room: Room = existing ?? { host: null, joiners: new Map(), max: 1, seq: 0 };
            room.host = ws;
            room.max = Math.max(1, Math.min(3, Number(m.max) || 1));
            rooms.set(roomCode, room);
            role = "host";
            send(ws, { t: "hosted", room: roomCode, max: room.max });
            return;
          }

          if (m.t === "join") {
            roomCode = String(m.room || "").toUpperCase();
            const room = rooms.get(roomCode);
            if (!room || !room.host) return send(ws, { t: "error", msg: "no such room" });
            if (room.joiners.size >= room.max) return send(ws, { t: "error", msg: "room full" });
            selfId = `j${++room.seq}`;
            room.joiners.set(selfId, ws);
            role = "joiner";
            send(ws, { t: "joined", room: roomCode, id: selfId });
            send(room.host, { t: "joiner", id: selfId }); // host kicks off the offer
            return;
          }

          // relay handshake. "to" is a joinerId (host->joiner) or "host" (joiner->host)
          if (m.t === "signal") {
            const room = rooms.get(roomCode);
            if (!room) return;
            if (role === "host") {
              send(room.joiners.get(m.to), { t: "signal", from: "host", data: m.data });
            } else if (role === "joiner") {
              send(room.host, { t: "signal", from: selfId, data: m.data });
            }
            return;
          }
        });

        ws.on("close", () => {
          const room = rooms.get(roomCode);
          if (!room) return;
          if (role === "host") {
            for (const j of room.joiners.values()) send(j, { t: "host-left" });
            rooms.delete(roomCode);
          } else if (role === "joiner") {
            room.joiners.delete(selfId);
            send(room.host, { t: "peer-left", id: selfId });
          }
        });
      });

      server.config.logger.info("  ➜  PS2 multiplayer signaling: ws /mp");
    },
  };
}
