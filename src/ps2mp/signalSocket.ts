// A signaling socket that reopens itself.
//
// Split out and pure — it takes an opener rather than making a WebSocket — for
// the same reason reconnect.ts is: you cannot test this by hand without pulling
// a network cable mid-match, so the wiring goes where it can be asserted.
//
// Why only the socket, and not the whole session: once a peer connection is up
// it is peer-to-peer, and the signaling socket is just the control channel that
// introduces people. A joiner can afford to tear its session down and rebuild
// (startJoinerResilient does exactly that) because it has one peer. A host
// cannot — rebuilding would drop every player in the room to fix a channel that
// only matters for admitting the next one. So the host keeps its peers and
// reopens the socket underneath them.
//
// Callers see one durable object: handlers registered once stay registered, and
// onOpen fires again on every successful reconnect. That re-firing is the whole
// mechanism — startHost re-sends its `host` announcement from onOpen, so the
// room re-appears in the listing without any reconnect-specific code.
//
// No sibling imports on purpose, the same way linkHealth.ts has none: that is
// what lets the test load this module in node. The backoff schedule lives in
// reconnect.ts and is handed in by the caller.

/** The part of WebSocket this needs — so a test can pass a fake.
 *
 *  The handler types are the DOM's, not a narrower shape of our own: a real
 *  WebSocket has to be assignable to this, and under strictFunctionTypes a
 *  handler declared to take less than MessageEvent is not. The test's fake is
 *  plain JavaScript and supplies whatever it likes. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
}

export interface Signaling {
  send(msg: Record<string, unknown>): void;
  onMessage(cb: (m: any) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export const OPEN = 1;   // WebSocket.OPEN, without needing the global here

export function reconnectingSocket(
  openSocket: () => SocketLike,
  opts: {
    /** The schedule from reconnect.ts. Required, not defaulted: a second copy
     *  of that formula here is a drift waiting to happen. */
    backoff: (attempt: number) => number;
    /** false keeps the old behaviour exactly: one socket, no retry. */
    reconnect?: boolean;
    keepaliveMs?: number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    setKeepalive?: typeof setInterval;
    clearKeepalive?: typeof clearInterval;
  },
): Signaling {
  const {
    backoff, reconnect = false, keepaliveMs = 25000,
    setTimer = setTimeout, clearTimer = clearTimeout,
    setKeepalive = setInterval, clearKeepalive = clearInterval,
  } = opts;

  const msgCbs: ((m: any) => void)[] = [];
  const openCbs: (() => void)[] = [];
  const closeCbs: (() => void)[] = [];

  let ws: SocketLike;
  let ka: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;

  const open = () => {
    ws = openSocket();
    // Keepalive: a tiny no-op the server ignores, so a quiet signaling socket
    // (idle once the datachannel is up) never gets idle-closed by the edge or a
    // proxy. Without it the socket dies silently and new joiners cannot signal.
    ka = setKeepalive(() => { if (ws.readyState === OPEN) ws.send('{"t":"ping"}'); }, keepaliveMs);
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m?.t === "pong") return;
      msgCbs.forEach((cb) => cb(m));
    };
    ws.onopen = () => { attempt = 0; openCbs.forEach((cb) => cb()); };
    ws.onclose = () => {
      clearKeepalive(ka);
      closeCbs.forEach((cb) => cb());
      // close() sets stopped, so a user who left is never dragged back —
      // the same rule reconnect.ts applies to sessions.
      if (!reconnect || stopped || retry) return;
      attempt++;
      retry = setTimer(() => { retry = undefined; if (!stopped) open(); }, backoff(attempt));
    };
  };
  open();

  return {
    send: (msg) => { if (ws.readyState === OPEN) ws.send(JSON.stringify(msg)); },
    onMessage: (cb) => msgCbs.push(cb),
    onOpen: (cb) => { if (ws.readyState === OPEN) cb(); else openCbs.push(cb); },
    onClose: (cb) => closeCbs.push(cb),
    close: () => {
      stopped = true;
      clearKeepalive(ka);
      clearTimer(retry);
      ws.close();
    },
  };
}
