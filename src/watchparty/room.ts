// Watch Party transport — a thin WebSocket client to the room hub.
// Dev: the same-origin Vite plugin (ws /watch). Prod: the standalone Cloudflare
// Worker's WatchRoom Durable Object (wss). Same message protocol either way.
// Auto-reconnects with backoff and re-sends the join so a dropped network (or a
// phone waking from sleep) rejoins the room transparently.

const MP_HOST = "abhishekstation-mp.abhishekdiwate879.workers.dev";
const isDev = import.meta.env.DEV;
const wsUrl = (room: string) =>
  isDev
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/watch?room=${encodeURIComponent(room)}`
    : `wss://${MP_HOST}/watch?room=${encodeURIComponent(room)}`;

export type WPMsg = Record<string, any>;

export interface RoomHandle {
  send: (msg: WPMsg) => void;
  close: () => void;
  connected: () => boolean;
}

/** Join `room` as `name`/`avatar`. `onMsg` gets every server message; `onStatus`
 *  fires "open"/"closed" as the socket comes and goes. Reconnects on its own. */
export function joinRoom(
  room: string,
  identity: { name: string; avatar: string },
  onMsg: (m: WPMsg) => void,
  onStatus?: (s: "open" | "closed") => void,
): RoomHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let open = false;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl(room));
    ws.onopen = () => {
      open = true; retry = 0;
      onStatus?.("open");
      ws!.send(JSON.stringify({ t: "join", name: identity.name, avatar: identity.avatar }));
    };
    ws.onmessage = (e) => { let m: WPMsg; try { m = JSON.parse(e.data as string); } catch { return; } onMsg(m); };
    ws.onclose = () => {
      open = false;
      onStatus?.("closed");
      if (closed) return;
      const delay = Math.min(8000, 400 * 2 ** retry++); // 0.4s → 8s cap
      setTimeout(connect, delay);
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  };
  connect();

  return {
    send: (msg) => { if (open && ws) { try { ws.send(JSON.stringify(msg)); } catch { /* dropped */ } } },
    close: () => { closed = true; try { ws?.close(); } catch { /* noop */ } },
    connected: () => open,
  };
}

/** A short, unambiguous room code (no easily-confused chars). */
export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1/L
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => alphabet[b % alphabet.length]).join("");
}
