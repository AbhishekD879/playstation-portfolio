// Serverless P2P (Trystero over Nostr relays) — no matchmaking server, no
// Cloudflare changes, data end-to-end between browsers. Two uses:
//  · presence — a lobby room counts who else is on the console right now
//  · chess    — two visitors pair up and play; moves ride a data channel
// Everything is lazy (trystero loads on first use) and best-effort: if the
// relays are unreachable you're simply alone, never broken.
import { createSignal } from "solid-js";

const CONFIG = { appId: "abhishekstation-v1" };

// —— presence ————————————————————————————————————————————————————————————
const [visitors, setVisitors] = createSignal(0); // OTHER consoles right now
export const visitorCount = visitors;
let lobby: any = null;

export async function startPresence() {
  if (lobby) return;
  try {
    const { joinRoom } = await import("trystero");
    lobby = joinRoom(CONFIG, "console-lobby");
    const recount = () => setVisitors(Object.keys(lobby.getPeers()).length);
    lobby.onPeerJoin = recount;
    lobby.onPeerLeave = recount;
  } catch { /* relays unreachable — solo console */ }
}

// —— chess pairing ———————————————————————————————————————————————————————
export interface ChessLink {
  /** "w" | "b" once paired */
  color: () => "w" | "b" | null;
  paired: () => boolean;
  sendMove: (uci: string) => void;
  onMove: (cb: (uci: string) => void) => void;
  onPeerLeave: (cb: () => void) => void;
  leave: () => void;
}

export async function joinChess(): Promise<ChessLink> {
  const { joinRoom, selfId } = await import("trystero");
  const room = joinRoom(CONFIG, "chess-hall");
  const [color, setColor] = createSignal<"w" | "b" | null>(null);
  const [paired, setPaired] = createSignal(false);
  let opponent: string | null = null;
  let moveCb: (uci: string) => void = () => {};
  let leaveCb: () => void = () => {};

  const move = room.makeAction("move");
  move.onMessage = (data: any, ctx: { peerId: string }) => {
    if (ctx.peerId === opponent) moveCb(String(data));
  };

  // deterministic pairing: first peer we see becomes the opponent;
  // the lexicographically smaller peer id plays white
  const pair = (peerId: string) => {
    if (opponent) return;
    opponent = peerId;
    setColor(selfId < peerId ? "w" : "b");
    setPaired(true);
  };
  room.onPeerJoin = pair;
  for (const id of Object.keys(room.getPeers())) pair(id); // someone already waiting
  room.onPeerLeave = (id: string) => {
    if (id === opponent) { opponent = null; setPaired(false); setColor(null); leaveCb(); }
  };

  return {
    color, paired,
    sendMove: (uci) => { if (opponent) void move.send(uci, { target: opponent }); },
    onMove: (cb) => { moveCb = cb; },
    onPeerLeave: (cb) => { leaveCb = cb; },
    leave: () => { try { void room.leave(); } catch { /* already gone */ } },
  };
}
