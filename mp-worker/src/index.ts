// PS2 multiplayer backend (Cloudflare Worker).
//  • /mp?room=CODE  — WebSocket signaling. Each room is one Durable Object
//    instance (idFromName(code)); the DO relays the WebRTC handshake between the
//    host and its joiners. Same message protocol as the local Vite dev plugin,
//    so the client is identical bar the URL.
//  • /turn          — returns ICE servers: Cloudflare's free STUN always, plus
//    short-lived TURN credentials when a TURN key is configured (secrets
//    TURN_KEY_ID + TURN_API_TOKEN). TURN relays the ~10-20% of connections that
//    STUN can't punch through (symmetric NAT).

interface Env {
  SIGNAL_ROOM: any; // DurableObjectNamespace
  LOG_STORE: any;   // DurableObjectNamespace (shared debug-log store)
  WATCH_ROOM: any;  // DurableObjectNamespace (synced watch-party rooms)
  DIRECTORY: any;   // DurableObjectNamespace (singleton: what's live right now)
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  ALLOWED_ORIGINS?: string; // comma-separated override; defaults below
}

// short share code for uploaded debug logs (base36, 6 chars)
function shortCode(): string {
  const a = new Uint8Array(6); crypto.getRandomValues(a);
  return Array.from(a, (b) => "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]).join("");
}

const DEFAULT_ORIGINS = [
  "https://abhishekstation.pages.dev",
  "http://localhost:5300",
  "http://127.0.0.1:5300",
];

// exact allowlist match, plus this project's Pages preview deploys
// (<hash>.abhishekstation.pages.dev) — NOT all of *.pages.dev
const originAllowed = (origin: string | null, allowed: string[]) =>
  !!origin && (allowed.includes(origin) || origin.endsWith(".abhishekstation.pages.dev"));

const cors = (origin: string | null, allowed: string[]) => ({
  "Access-Control-Allow-Origin": originAllowed(origin, allowed) ? (origin as string) : allowed[0],
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Vary": "Origin",
});

async function turnIceServers(env: Env): Promise<any[]> {
  const servers: any[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const r = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );
      if (r.ok) {
        const data: any = await r.json();
        const ice = data?.iceServers;
        if (Array.isArray(ice)) return ice;
        if (ice) return [ice];
      }
    } catch { /* fall back to STUN-only */ }
  }
  return servers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? DEFAULT_ORIGINS;

    if (url.pathname === "/mp") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (origin && !originAllowed(origin, allowed)) return new Response("forbidden origin", { status: 403 });
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(room)) return new Response("bad room code", { status: 400 });
      const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(room));
      return stub.fetch(request);
    }

    // —— Watch Party ————————————————————————————————————————————————————————
    // A room where everyone watches the SAME YouTube video in sync. Unlike /mp
    // (WebRTC media relay), no video flows through here — each viewer loads the
    // video from YouTube directly and this DO just broadcasts playback state
    // (play/pause/seek), chat, emoji reactions, a shared queue and presence.
    if (url.pathname === "/watch") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (origin && !originAllowed(origin, allowed)) return new Response("forbidden origin", { status: 403 });
      const room = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(room)) return new Response("bad room code", { status: 400 });
      const stub = env.WATCH_ROOM.get(env.WATCH_ROOM.idFromName(room));
      return stub.fetch(request);
    }

    // —— Console TV directory ——————————————————————————————————————————————
    // What's being played on the console right now, and what was on last. Only
    // rooms whose host explicitly opted into broadcasting appear here — hosting
    // a private 2-player game never lists you.
    if (url.pathname === "/live") {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin, allowed) });
      const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName("live"));
      const r = await stub.fetch("https://do/list");
      return new Response(await r.text(), {
        headers: { ...cors(origin, allowed), "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    if (url.pathname === "/turn") {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin, allowed) });
      // TURN creds cost real money per relayed GB — don't mint them for curl
      // or foreign origins. (Origin is spoofable outside browsers; this stops
      // drive-by abuse. Real fix if ever needed: issue creds over signaling.)
      if (!originAllowed(origin, allowed)) return new Response("forbidden origin", { status: 403 });
      const iceServers = await turnIceServers(env);
      return new Response(JSON.stringify({ iceServers }), {
        headers: { ...cors(origin, allowed), "content-type": "application/json" },
      });
    }

    // —— debug-log sharing ————————————————————————————————————————————————
    // The RPG Maker player uploads its verbose trace here and shows the user a
    // short code; the maintainer fetches GET /log/<code> to read it — no
    // copy-paste. Temporary (pruned after 24h), non-sensitive debug text only.
    if (url.pathname === "/log") {
      if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin, allowed) });
      if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors(origin, allowed) });
      if (!originAllowed(origin, allowed)) return new Response("forbidden origin", { status: 403, headers: cors(origin, allowed) });
      const text = (await request.text()).slice(0, 1024 * 1024); // 1MB cap
      const code = shortCode();
      const stub = env.LOG_STORE.get(env.LOG_STORE.idFromName("logs"));
      await stub.fetch(`https://do/put?code=${code}`, { method: "PUT", body: text });
      return new Response(JSON.stringify({ code }), { headers: { ...cors(origin, allowed), "content-type": "application/json" } });
    }
    const logGet = url.pathname.match(/^\/log\/([a-z0-9]{1,16})$/);
    if (logGet) { // OPEN GET (no origin check) so the maintainer can curl it
      const stub = env.LOG_STORE.get(env.LOG_STORE.idFromName("logs"));
      const r = await stub.fetch(`https://do/get?code=${logGet[1]}`);
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
    }

    if (url.pathname === "/") return new Response("abhishekstation-mp: ok", { status: 200 });
    return new Response("not found", { status: 404 });
  },
};

// —— one room ————————————————————————————————————————————————————————————
// Star topology: one host, up to `max` joiners. State lives in memory for the
// life of the room's open sockets (no persistence needed — a dropped room just
// re-forms when the host clicks host again).
//
// ★ Spectators are a SECOND population, deliberately not joiners. A watcher
// receives the host's video and sends nothing back, so they must not consume a
// player slot — otherwise one popular stream would lock every controller out of
// the game. They get a much larger cap and are announced to the host with
// watch:true so it knows to skip the input data channel entirely.
const MAX_SPECTATORS = 24;

export class SignalRoom {
  host: WebSocket | null = null;
  joiners = new Map<string, WebSocket>();
  spectators = new Map<string, WebSocket>();
  max = 1;
  seq = 0;
  env: Env;
  listing: { title: string; kind: string } | null = null;
  code = "";

  constructor(_state: any, env: Env) { this.env = env; }

  /** Tell the host (and the directory) how many people are watching. */
  private announce() {
    const n = this.spectators.size;
    try { this.host?.send(JSON.stringify({ t: "watchers", n })); } catch { /* closed */ }
    if (this.code) void this.dir("/watchers", { code: this.code, n });
  }

  private dir(path: string, body?: unknown) {
    try {
      const stub = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("live"));
      return stub.fetch(`https://do${path}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
    } catch { /* directory is best-effort; a room still works unlisted */ }
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = (pair as any)[0] as WebSocket;
    const server = (pair as any)[1] as WebSocket;
    (server as any).accept();
    this.wire(server);
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  wire(ws: WebSocket) {
    let role: "host" | "joiner" | null = null;
    let selfId = "";
    const send = (sock: WebSocket | null | undefined, msg: unknown) => { try { sock?.send(JSON.stringify(msg)); } catch { /* closed */ } };

    ws.addEventListener("message", (evt: MessageEvent) => {
      let m: any;
      try { m = JSON.parse(evt.data as string); } catch { return; }

      if (m.t === "ping") { send(ws, { t: "pong" }); return; } // keepalive — keeps an idle signaling socket from being closed

      if (m.t === "host") {
        if (this.host && this.host !== ws) return send(ws, { t: "error", msg: "room already hosted" });
        this.host = ws; role = "host";
        // cap 7 joiners (8 players): fine for data-only games like CS 1.6; the
        // heavier PS2 video host requests its own smaller max, unaffected.
        this.max = Math.max(1, Math.min(7, Number(m.max) || 1));
        // Opt-in only: a host that doesn't send `listing` is never advertised.
        if (m.listing && typeof m.listing.title === "string") {
          this.code = String(m.room || "").toUpperCase().slice(0, 8);
          this.listing = { title: String(m.listing.title).slice(0, 60), kind: String(m.listing.kind || "").slice(0, 24) };
          if (this.code) void this.dir("/reg", { code: this.code, ...this.listing });
        }
        return send(ws, { t: "hosted", max: this.max });
      }

      if (m.t === "join") {
        if (!this.host) return send(ws, { t: "error", msg: "no such room" });
        const watching = m.as === "watch";
        const pool = watching ? this.spectators : this.joiners;
        const cap = watching ? MAX_SPECTATORS : this.max;
        if (pool.size >= cap) return send(ws, { t: "error", msg: watching ? "too many watchers" : "room full" });
        selfId = `${watching ? "w" : "j"}${++this.seq}`;
        pool.set(selfId, ws);
        role = watching ? "spectator" : "joiner";
        send(ws, { t: "joined", id: selfId });
        send(this.host, { t: "joiner", id: selfId, watch: watching });
        if (watching) this.announce();
        return;
      }

      if (m.t === "signal") {
        if (role === "host") send(this.joiners.get(m.to) ?? this.spectators.get(m.to), { t: "signal", from: "host", data: m.data });
        else send(this.host, { t: "signal", from: selfId, data: m.data });
        return;
      }
    });

    const cleanup = () => {
      if (role === "host") {
        for (const j of [...this.joiners.values(), ...this.spectators.values()]) send(j, { t: "host-left" });
        this.host = null; this.joiners.clear(); this.spectators.clear();
        if (this.code) void this.dir("/unreg", { code: this.code });
        this.listing = null; this.code = "";
      } else if (role === "joiner") {
        this.joiners.delete(selfId); send(this.host, { t: "peer-left", id: selfId });
      } else if (role === "spectator") {
        this.spectators.delete(selfId); send(this.host, { t: "peer-left", id: selfId });
        this.announce();
      }
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }
}

// —— Console TV directory ————————————————————————————————————————————————
// One singleton DO listing rooms that opted into being watched, plus a short
// tail of what was on recently so the channel is never empty. In memory only:
// a live room is by definition a thing with open sockets, so there is nothing
// worth surviving an eviction — and a stale "live" entry is worse than none.
interface LiveRoom { code: string; title: string; kind: string; since: number; watchers: number }
const RECENT_KEEP = 8;
const STALE_MS = 6 * 3600 * 1000; // a room open >6h is almost certainly a leak

export class Directory {
  live = new Map<string, LiveRoom>();
  recent: { title: string; kind: string; at: number }[] = [];

  constructor(_state: any, _env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body: any = path === "/list" ? {} : await request.json().catch(() => ({}));
    const code = String(body.code || "");

    if (path === "/reg" && code) {
      this.live.set(code, {
        code,
        title: String(body.title || "Something").slice(0, 60),
        kind: String(body.kind || "").slice(0, 24),
        since: Date.now(),
        watchers: 0,
      });
    } else if (path === "/unreg" && code) {
      const gone = this.live.get(code);
      if (gone) {
        this.live.delete(code);
        // the channel remembers what was on, so it's never a dead screen
        this.recent.unshift({ title: gone.title, kind: gone.kind, at: Date.now() });
        this.recent = this.recent.slice(0, RECENT_KEEP);
      }
    } else if (path === "/watchers" && code) {
      const r = this.live.get(code);
      if (r) r.watchers = Math.max(0, Number(body.n) || 0);
    }

    // sweep on every touch — cheap, and keeps a crashed host from haunting the list
    const cutoff = Date.now() - STALE_MS;
    for (const [k, v] of this.live) if (v.since < cutoff) this.live.delete(k);

    return new Response(
      JSON.stringify({ live: [...this.live.values()].sort((a, b) => b.since - a.since), recent: this.recent }),
      { headers: { "content-type": "application/json" } },
    );
  }
}

// —— shared debug-log store ————————————————————————————————————————————————
// One singleton DO (idFromName("logs")) keyed by short code. SQLite-backed
// storage, pruned to the last 24h on each write so it stays tiny + temporary.
export class LogStore {
  storage: any;
  constructor(state: any) { this.storage = state.storage; }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") || "";
    if (url.pathname === "/put") {
      const text = await request.text();
      await this.storage.put("log:" + code, { text, ts: Date.now() });
      try {
        const all: Map<string, any> = await this.storage.list({ prefix: "log:" });
        const cutoff = Date.now() - 24 * 3600 * 1000;
        for (const [k, v] of all) if (!v || (v.ts || 0) < cutoff) await this.storage.delete(k);
      } catch { /* prune best-effort */ }
      return new Response("ok");
    }
    const rec: any = await this.storage.get("log:" + code);
    if (!rec) return new Response("log not found — it expired (24h) or the code is wrong", { status: 404 });
    return new Response(rec.text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

// —— one watch-party room ————————————————————————————————————————————————————
// Broadcast hub, host-authoritative. Members connect over WebSocket; the host
// (first to join, re-elected if they leave) drives playback and everyone syncs.
// The last playback state + queue are cached in memory so LATE joiners catch up
// instantly. No persistence — an empty room just evaporates.
interface Member { ws: WebSocket; name: string; avatar: string; joinedAt: number }
export class WatchRoom {
  members = new Map<string, Member>();
  hostId: string | null = null;
  seq = 0;
  state: { videoId: string; position: number; playing: boolean; ts: number } = { videoId: "", position: 0, playing: false, ts: 0 };
  queue: { videoId: string; title: string; by: string }[] = [];
  allowControl = false;

  constructor(_state: any, _env: Env) {}

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = (pair as any)[0] as WebSocket;
    const server = (pair as any)[1] as WebSocket;
    (server as any).accept();
    this.wire(server);
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  private roster() {
    return [...this.members.entries()].map(([id, m]) => ({ id, name: m.name, avatar: m.avatar, host: id === this.hostId }));
  }
  private broadcast(msg: unknown, exceptId?: string) {
    const s = JSON.stringify(msg);
    for (const [id, m] of this.members) if (id !== exceptId) { try { m.ws.send(s); } catch { /* closed */ } }
  }

  wire(ws: WebSocket) {
    let selfId = "";
    const send = (msg: unknown) => { try { ws.send(JSON.stringify(msg)); } catch { /* closed */ } };

    ws.addEventListener("message", (evt: MessageEvent) => {
      let m: any;
      try { m = JSON.parse(evt.data as string); } catch { return; }

      if (m.t === "join") {
        selfId = `u${++this.seq}`;
        this.members.set(selfId, { ws, name: String(m.name || "Guest").slice(0, 24), avatar: String(m.avatar || "").slice(0, 8), joinedAt: Date.now() });
        if (!this.hostId) this.hostId = selfId;
        send({ t: "welcome", id: selfId, hostId: this.hostId, state: this.state, queue: this.queue, allowControl: this.allowControl, members: this.roster() });
        this.broadcast({ t: "members", members: this.roster(), hostId: this.hostId }, selfId);
        return;
      }

      const me = this.members.get(selfId);
      if (!me) return;
      const isHost = selfId === this.hostId;
      const canDrive = isHost || this.allowControl;

      switch (m.t) {
        case "state": // playback tick from the driver (play/pause/seek/heartbeat)
          if (!canDrive) return;
          this.state = { videoId: String(m.videoId || ""), position: Number(m.position) || 0, playing: !!m.playing, ts: Date.now() };
          this.broadcast({ t: "state", ...this.state, by: selfId }, selfId);
          return;
        case "video": // driver loads a new video → reset to the top, playing
          if (!canDrive) return;
          this.state = { videoId: String(m.videoId || ""), position: 0, playing: true, ts: Date.now() };
          this.broadcast({ t: "video", videoId: this.state.videoId, title: String(m.title || "").slice(0, 120), by: me.name });
          return;
        case "chat":
          this.broadcast({ t: "chat", from: selfId, name: me.name, avatar: me.avatar, text: String(m.text || "").slice(0, 300), ts: Date.now() });
          return;
        case "react":
          this.broadcast({ t: "react", from: selfId, name: me.name, emoji: String(m.emoji || "").slice(0, 8) });
          return;
        case "queue-add":
          if (this.queue.length < 200 && m.videoId) { this.queue.push({ videoId: String(m.videoId), title: String(m.title || "").slice(0, 120), by: me.name }); this.broadcast({ t: "queue", queue: this.queue }); }
          return;
        case "queue-remove":
          if (canDrive && Number.isInteger(m.index) && m.index >= 0 && m.index < this.queue.length) { this.queue.splice(m.index, 1); this.broadcast({ t: "queue", queue: this.queue }); }
          return;
        case "allowControl":
          if (isHost) { this.allowControl = !!m.value; this.broadcast({ t: "allowControl", value: this.allowControl }); }
          return;
      }
    });

    const cleanup = () => {
      if (!this.members.has(selfId)) return;
      this.members.delete(selfId);
      if (selfId === this.hostId) {
        // promote the earliest-joined survivor so control is never orphaned
        const next = [...this.members.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt)[0];
        this.hostId = next ? next[0] : null;
      }
      this.broadcast({ t: "members", members: this.roster(), hostId: this.hostId });
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
  }
}
