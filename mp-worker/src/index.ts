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
export class SignalRoom {
  host: WebSocket | null = null;
  joiners = new Map<string, WebSocket>();
  max = 1;
  seq = 0;

  constructor(_state: any, _env: Env) {}

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

      if (m.t === "host") {
        if (this.host && this.host !== ws) return send(ws, { t: "error", msg: "room already hosted" });
        this.host = ws; role = "host";
        this.max = Math.max(1, Math.min(3, Number(m.max) || 1));
        return send(ws, { t: "hosted", max: this.max });
      }

      if (m.t === "join") {
        if (!this.host) return send(ws, { t: "error", msg: "no such room" });
        if (this.joiners.size >= this.max) return send(ws, { t: "error", msg: "room full" });
        selfId = `j${++this.seq}`; this.joiners.set(selfId, ws); role = "joiner";
        send(ws, { t: "joined", id: selfId });
        send(this.host, { t: "joiner", id: selfId });
        return;
      }

      if (m.t === "signal") {
        if (role === "host") send(this.joiners.get(m.to), { t: "signal", from: "host", data: m.data });
        else if (role === "joiner") send(this.host, { t: "signal", from: selfId, data: m.data });
        return;
      }
    });

    const cleanup = () => {
      if (role === "host") { for (const j of this.joiners.values()) send(j, { t: "host-left" }); this.host = null; this.joiners.clear(); }
      else if (role === "joiner") { this.joiners.delete(selfId); send(this.host, { t: "peer-left", id: selfId }); }
    };
    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);
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
