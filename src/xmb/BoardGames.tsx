// Board Games — classic 2-player (and up to 4 for Ludo) board games played
// online over WebRTC. The room CREATOR is the host (seat 0) and authoritative:
// it validates every move and broadcasts the resulting state; joiners send move
// intents and render whatever state comes back. Reuses the party transport.
// Opponents join with a room code or a ?board=CODE share link.
import { For, Index, Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { renderSVG } from "uqr";
import { partyHost, partyJoin, newPartyCode, type PartyHostHandle, type PartyJoinHandle } from "../party/net";
import {
  GAMES, gameInit, type AnyState, type Side,
  C4_COLS, C4_ROWS, type C4,
  GO_SIZE, type Gomoku,
  rvLegal, rvCount, type Reversi,
  ckMoves, type Checkers,
  c4Drop, goPlace, rvPlace, ckApply,
  ludoRoll, ludoMove, ludoCell, type Ludo,
  LUDO_PATH, LUDO_HOME, LUDO_BASE, LUDO_COLORS, LUDO_COLORS_CB, LUDO_SAFE_IDX, LUDO_GOAL,
} from "../board/rules";
import { botAction } from "../board/bots";
import { setNavEnabled } from "../input";
import Ludo3D from "./Ludo3D";
import Grid3D from "./Grid3D";
import { Icon } from "./icons";
import * as sfx from "../audio";

const boardUrl = (code: string) => `${location.origin}/?board=${code}`;
const DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const range = (n: number) => Array.from({ length: n }, (_, i) => i); // distinct values → safe <For> keys
// 3D Ludo needs WebGL; fall back to the 2D SVG board where it's missing/blocked
const hasWebGL = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl") || c.getContext("experimental-webgl")); } catch { return false; } })();

/** host-authoritative move application (pure for all but Ludo's host-only roll). */
function applyAct(st: AnyState, a: any, seat: number): AnyState | null {
  switch (st.k) {
    case "c4": return c4Drop(st, a.col, seat as Side);
    case "gomoku": return goPlace(st, a.r, a.c, seat as Side);
    case "reversi": return rvPlace(st, a.r, a.c, seat as Side);
    case "checkers": return ckApply(st, a.path, seat as Side);
    case "ludo":
      if (a.kind === "roll") return ludoRoll(st, seat, 1 + Math.floor(Math.random() * 6));
      if (a.kind === "move") return ludoMove(st, seat, a.token);
      return null;
  }
}

export default function BoardGames(props: { onClose: () => void; onTrophy?: (id: string) => void }) {
  const [phase, setPhase] = createSignal<"lobby" | "wait" | "connecting" | "play">("lobby");
  const [role, setRole] = createSignal<"host" | "joiner" | null>(null);
  const [gameKey, setGameKey] = createSignal<AnyState["k"]>("c4");
  const [st, setSt] = createSignal<AnyState | null>(null);
  const [mySeat, setMySeat] = createSignal(0);
  const [names, setNames] = createSignal<string[]>(["You"]);
  const [code, setCode] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [joinCode, setJoinCode] = createSignal("");
  const [count, setCount] = createSignal(1); // connected players (reactive; idSeat is not)
  const [solo, setSolo] = createSignal(false); // playing the computer — no networking at all
  const [grid3d, setGrid3d] = createSignal(hasWebGL && localStorage.getItem("asp.board.2d") !== "1");
  const myName = "P" + (1 + Math.floor(Math.random() * 99));

  let hostH: PartyHostHandle | null = null;
  let joinH: PartyJoinHandle | null = null;
  const idSeat = new Map<string, number>();   // live peer id → seat (routes moves)
  const cidSeat = new Map<string, number>();  // stable player id → seat (survives a drop)
  let nextSeat = 1;
  // Our own stable id, so reconnecting reclaims our seat instead of taking a new
  // one. Kept in sessionStorage (per-tab) so even a full page REFRESH resumes the
  // game in progress, not just a transport blip.
  const myCid = (() => {
    const k = "asp.board.cid";
    let v = sessionStorage.getItem(k);
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(k, v); }
    return v;
  })();

  const meta = () => GAMES.find((g) => g.key === gameKey())!;
  const stopNet = () => { hostH?.stop(); joinH?.stop(); hostH = null; joinH = null; };

  onMount(() => {
    setNavEnabled(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") leave(); };
    addEventListener("keydown", esc);
    onCleanup(() => { removeEventListener("keydown", esc); setNavEnabled(true); stopNet(); });
    // ?board=CODE share link → jump straight to joining
    const q = new URLSearchParams(location.search).get("board");
    if (q && /^[A-Za-z0-9]{1,8}$/.test(q)) joinRoom(q.toUpperCase());
  });

  // —— HOST ——
  function createRoom(key: AnyState["k"]) {
    sfx.confirm?.();
    setGameKey(key); setRole("host"); setMySeat(0); setNames([myName]);
    const c = newPartyCode(); setCode(c);
    idSeat.clear(); nextSeat = 1; setCount(1);
    hostH = partyHost(c, {
      onStatus: (s) => setStatus(s),
      onJoin: () => {},
      onLeave: (id) => {
        const seat = idSeat.get(id);
        idSeat.delete(id); setCount(1 + idSeat.size);
        // their SEAT is kept (cidSeat) so an auto-reconnect resumes the game —
        // only the live-peer mapping goes away.
        if (seat != null) {
          if (phase() === "play") setStatus(`${names()[seat] || "A player"} dropped — waiting for them to reconnect…`);
          else setNames((n) => { const c = n.slice(); c[seat] = ""; return c; });
        }
      },
      onMessage: (id, m) => {
        if (m?.t === "hello") {
          const cid = String(m.cid || id);
          const known = cidSeat.get(cid);
          if (known != null) { // ——— reconnect: same player, new peer id
            idSeat.set(id, known); setCount(1 + idSeat.size);
            hostH?.send(id, { t: "welcome", seat: known });
            hostH?.broadcast({ t: "roster", names: names() });
            // hand them the live board so they resume mid-game instead of stalling
            if (phase() === "play" && st()) hostH?.send(id, { t: "start", gameKey: gameKey(), state: st(), names: names() });
            setStatus("");
            return;
          }
          if (idSeat.has(id)) return;
          if (phase() !== "wait" || nextSeat > meta().maxP - 1) { hostH?.send(id, { t: "full" }); return; }
          const seat = nextSeat++;
          idSeat.set(id, seat); cidSeat.set(cid, seat); setCount(1 + idSeat.size);
          setNames((n) => { const c = n.slice(); c[seat] = String(m.name || "Player").slice(0, 14); return c; });
          hostH?.send(id, { t: "welcome", seat });
          hostH?.broadcast({ t: "roster", names: names() });
          sfx.tickH?.();
        } else if (m?.t === "act") {
          const seat = idSeat.get(id); if (seat == null) return;
          const ns = applyAct(st()!, m.a, seat);
          if (ns) { setSt(ns); hostH?.broadcast({ t: "state", s: ns }); }
        }
      },
    }, GAMES.find((g) => g.key === key)!.maxP - 1);
    setPhase("wait");
  }
  const startGame = () => {
    const np = count();
    if (np < meta().minP) return;
    sfx.confirm?.();
    const s0 = gameInit(gameKey(), np);
    setSt(s0);
    hostH?.broadcast({ t: "start", gameKey: gameKey(), state: s0, names: names() });
    setPhase("play");
  };
  const rematch = () => {
    if (role() !== "host" || !st()) return;
    const np = st()!.k === "ludo" ? (st() as Ludo).np : 2;
    const s0 = gameInit(gameKey(), np);
    setSt(s0);
    hostH?.broadcast({ t: "start", gameKey: gameKey(), state: s0, names: names() });
  };

  // —— SOLO (vs the computer) ——
  // No room, no signaling: we're seat 0, the bot is seat 1. Moves still go
  // through the same applyAct validation, so the rules can't be bent.
  function startSolo(key: AnyState["k"]) {
    sfx.confirm?.();
    setGameKey(key); setRole("host"); setMySeat(0); setSolo(true);
    setNames(["You", "Computer"]);
    setSt(gameInit(key, 2));
    setPhase("play");
  }
  // Bot driver: whenever the state settles on the bot's turn, play its move.
  // Re-runs per state change, so Ludo's roll→move (and its extra turn on a 6)
  // fall out naturally without a step machine.
  createEffect(() => {
    const s = st();
    if (!solo() || !s || s.over || phase() !== "play" || s.turn === mySeat()) return;
    const t = setTimeout(() => {
      const cur = st();
      if (!cur || cur.over || cur.turn === mySeat()) return;
      const a = botAction(cur, cur.turn);
      if (!a) return;
      const ns = applyAct(cur, a, cur.turn);
      if (ns) { setSt(ns); sfx.tickH?.(); }
    }, s.k === "ludo" && s.die === null ? 700 : 520); // a beat, so it feels considered
    onCleanup(() => clearTimeout(t));
  });

  // —— JOINER ——
  function joinRoom(c: string) {
    setRole("joiner"); setCode(c); setPhase("connecting"); setStatus("connecting…");
    joinH = partyJoin(c, {
      // fires again after an auto-reconnect, so the hello (with our stable cid)
      // re-announces us and the host hands back our seat + the live board
      onOpen: () => { setStatus("connected — waiting for host"); joinH?.send({ t: "hello", name: myName, cid: myCid }); },
      onClose: () => { setStatus(phase() === "play" ? "Host left — game over." : "host disconnected"); },
      onStatus: (s) => setStatus(s),
      onMessage: (m) => {
        if (m?.t === "welcome") setMySeat(m.seat);
        else if (m?.t === "roster") setNames(m.names);
        else if (m?.t === "full") { setStatus("That room is full."); setPhase("lobby"); stopNet(); }
        else if (m?.t === "start") { setGameKey(m.gameKey); setNames(m.names); setSt(m.state); setPhase("play"); }
        else if (m?.t === "state") setSt(m.s);
      },
    }, { reconnect: true }); // a wifi blip / phone lock no longer kills the game
  }

  const doAct = (a: any) => {
    const s = st(); if (!s || s.over) return;
    if (role() === "host") { const ns = applyAct(s, a, mySeat()); if (ns) { setSt(ns); hostH?.broadcast({ t: "state", s: ns }); } }
    else joinH?.send({ t: "act", a });
    sfx.tickH?.();
  };

  const leave = () => { sfx.back?.(); stopNet(); props.onClose(); };
  const backToLobby = () => { stopNet(); idSeat.clear(); nextSeat = 1; setCount(1); setSt(null); setRole(null); setSolo(false); setPhase("lobby"); setStatus(""); };

  // trophies: fire once per finished game, only when WE won
  createEffect(() => {
    const s = st();
    if (!s || !s.over || s.winner !== mySeat()) return;
    props.onTrophy?.(solo() ? "strategist" : "boardgamer");
    if (s.k === "ludo") props.onTrophy?.("ludochamp");
  });

  const myTurn = () => { const s = st(); return !!s && !s.over && s.turn === mySeat(); };
  const turnLabel = () => {
    const s = st(); if (!s) return "";
    if (s.over) { if ((s as any).draw) return "Draw!"; const w = s.winner; return w === mySeat() ? "You win" : `${names()[w!] || "Opponent"} wins`; }
    return s.turn === mySeat() ? "Your turn" : `${names()[s.turn] || "Opponent"}'s turn`;
  };

  const players = () => count();

  return (
    // pad-focus-scope: L1/R1 walk DOM focus inside here, so a controller can
    // reach every button in the lobby, wait room and game
    <div class="bg-root pad-focus-scope">
      <div class="bg-head">
        <div class="panel-tag">BOARD GAMES</div>
        <Show when={phase() === "play" && st()}><div class="bg-turn" classList={{ mine: myTurn(), over: st()!.over }}>{turnLabel()}</div></Show>
        <button class="ps-act" onClick={leave}><span class="btn-o" /> close</button>
      </div>

      <Switch>
        {/* —— lobby —— */}
        <Match when={phase() === "lobby"}>
          <div class="bg-lobby">
            <div class="bg-lobby-head">
              <div class="panel-tag">CHOOSE A GAME</div>
              <p>Play the computer straight away, or open a room and send someone the code.</p>
            </div>
            {/* glyph tiles — the games get presence, but with the console's own
                treatment: no card chrome, the tint glow blooms behind the glyph
                on hover/focus. Actions stay as text, never pills. */}
            <div class="bg-tiles">
              <For each={GAMES}>{(g) => (
                <div class="bg-tile">
                  <span class="bg-tile-ic"><Icon name={g.icon} /></span>
                  <span class="bg-tile-name">{g.name}</span>
                  <span class="bg-tile-p">{g.minP === g.maxP ? `${g.minP} PLAYERS` : `${g.minP}–${g.maxP} PLAYERS`}</span>
                  <span class="bg-tile-sub">{g.blurb}</span>
                  <span class="bg-tile-acts">
                    <button class="ps-act" onClick={() => startSolo(g.key)}>Vs computer</button>
                    <button class="ps-act" onClick={() => createRoom(g.key)}>Invite</button>
                  </span>
                </div>
              )}</For>
            </div>
            <div class="bg-rows">
              <div class="bg-grow bg-grow-join">
                <span class="bg-grow-ic"><Icon name="gamepad" /></span>
                <span class="bg-grow-head">
                  <span class="bg-grow-name">Join a room</span>
                  <span class="bg-grow-sub">Enter the code your friend is showing</span>
                </span>
                <span class="bg-grow-acts">
                  <input class="bg-codein" placeholder="CODE" maxlength={8} value={joinCode()} autocomplete="off" autocapitalize="characters"
                    onInput={(e) => setJoinCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && joinCode()) joinRoom(joinCode()); }} />
                  <button class="ps-act" disabled={!joinCode()} onClick={() => joinRoom(joinCode())}>Join</button>
                </span>
              </div>
            </div>
            <div class="ps-legend">
              <span><span class="btn-x" /> select</span>
              <span><span class="btn-o" /> back</span>
            </div>
          </div>
        </Match>

        {/* —— host waiting room —— */}
        <Match when={phase() === "wait"}>
          <div class="bg-wait">
            <div class="bg-wait-info">
              <div class="bg-wait-game"><span class="bg-wait-ic"><Icon name={meta().icon} /></span>{meta().name}</div>
              <p>Share this code — or the link — with your {meta().maxP > 2 ? "friends" : "friend"}:</p>
              <div class="bg-bigcode">{code()}</div>
              <div class="bg-link">{boardUrl(code()).replace(/^https?:\/\//, "")}</div>
              <div class="bg-roster">
                <For each={range(meta().maxP)}>{(i) => (
                  <div class="bg-slot" classList={{ filled: !!names()[i] }} style={{ "--sc": meta().colors[i] ?? "#8aa" }}>
                    <i /> <span>{names()[i] || "waiting…"}{i === 0 ? " (you)" : ""}</span>
                  </div>
                )}</For>
              </div>
              <div class="bg-wait-actions ps-legend">
                <button class="ps-act" disabled={players() < meta().minP} onClick={startGame}>
                  <span class="btn-x" /> {players() < meta().minP ? `waiting for ${meta().minP - players()} more` : `start game (${players()})`}
                </button>
                <button class="ps-act" onClick={backToLobby}><span class="btn-o" /> cancel</button>
              </div>
              <p class="bg-status">{status()}</p>
            </div>
            <div class="bg-qr" innerHTML={renderSVG(boardUrl(code()))} />
          </div>
        </Match>

        {/* —— joiner connecting —— */}
        <Match when={phase() === "connecting"}>
          <div class="bg-connecting">
            <div class="bg-spinner" />
            <p>{status() || "connecting…"}</p>
            <button class="ps-act" onClick={backToLobby}><span class="btn-o" /> cancel</button>
          </div>
        </Match>

        {/* —— play —— */}
        <Match when={phase() === "play" && st()}>
          <div class="bg-play">
            <div class="bg-board-wrap">
              {/* the four grid games share one 3D scene on the same table; the 2D
                  renderers stay as the fallback and the toggle target */}
              <Show when={grid3d() && st()!.k !== "ludo"} fallback={
                <Switch>
                  <Match when={st()!.k === "c4"}><C4Board st={st() as C4} myTurn={myTurn()} colors={meta().colors} onAct={doAct} /></Match>
                  <Match when={st()!.k === "gomoku"}><GomokuBoard st={st() as Gomoku} myTurn={myTurn()} colors={meta().colors} onAct={doAct} /></Match>
                  <Match when={st()!.k === "reversi"}><ReversiBoard st={st() as Reversi} seat={mySeat()} myTurn={myTurn()} colors={meta().colors} names={names()} onAct={doAct} /></Match>
                  <Match when={st()!.k === "checkers"}><CheckersBoard st={st() as Checkers} seat={mySeat()} myTurn={myTurn()} colors={meta().colors} onAct={doAct} /></Match>
                  <Match when={st()!.k === "ludo"}><LudoBoard st={st() as Ludo} seat={mySeat()} myTurn={myTurn()} names={names()} onAct={doAct} /></Match>
                </Switch>
              }>
                <Grid3D st={st()!} seat={mySeat()} myTurn={myTurn()} colors={meta().colors} onAct={doAct} />
              </Show>
            </div>
            <Show when={hasWebGL && st()!.k !== "ludo"}>
              <div class="bg-ludo-ctrl">
                <button class="ps-act bg-ludo-dim" onClick={() => { const v = !grid3d(); setGrid3d(v); localStorage.setItem("asp.board.2d", v ? "0" : "1"); }}>{grid3d() ? "2D view" : "3D view"}</button>
              </div>
            </Show>
            <div class="bg-foot ps-legend">
              <Show when={st()!.over}>
                <Show when={role() === "host"} fallback={<span class="bg-status">waiting for the host to restart…</span>}>
                  <button class="ps-act" onClick={rematch}><span class="btn-t" /> play again</button>
                </Show>
              </Show>
              <button class="ps-act" onClick={backToLobby}><span class="btn-o" /> leave game</button>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

// ————————————————————————————————————————————— renderers
function C4Board(props: { st: C4; myTurn: boolean; colors: string[]; onAct: (a: any) => void }) {
  return (
    <div class="bg-c4" style={{ "--c0": props.colors[0], "--c1": props.colors[1] }}>
      <For each={range(C4_COLS)}>
        {(c) => (
          <button class="bg-c4-col" disabled={!props.myTurn || props.st.board[c] !== null} onClick={() => props.onAct({ col: c })}>
            <For each={range(C4_ROWS)}>
              {(r) => { const v = () => props.st.board[r * C4_COLS + c]; return <span class="bg-c4-slot"><Show when={v() !== null}><span class="bg-disc" classList={{ p0: v() === 0, p1: v() === 1, last: props.st.last === r * C4_COLS + c }} /></Show></span>; }}
            </For>
          </button>
        )}
      </For>
    </div>
  );
}

function GomokuBoard(props: { st: Gomoku; myTurn: boolean; colors: string[]; onAct: (a: any) => void }) {
  return (
    <div class="bg-grid bg-gomoku" style={{ "--c0": props.colors[0], "--c1": props.colors[1], "grid-template-columns": `repeat(${GO_SIZE},1fr)` }}>
      <For each={range(GO_SIZE * GO_SIZE)}>
        {(i) => { const v = () => props.st.board[i]; return (
          <button class="bg-cell" disabled={!props.myTurn || v() !== null} onClick={() => props.onAct({ r: (i / GO_SIZE) | 0, c: i % GO_SIZE })}>
            <Show when={v() !== null}><span class="bg-stone" classList={{ p0: v() === 0, p1: v() === 1, last: props.st.last === i }} /></Show>
          </button>
        ); }}
      </For>
    </div>
  );
}

function ReversiBoard(props: { st: Reversi; seat: number; myTurn: boolean; colors: string[]; names: string[]; onAct: (a: any) => void }) {
  const legal = createMemo(() => (props.myTurn ? new Set(rvLegal(props.st.board, props.seat as Side)) : new Set<number>()));
  const cnt = createMemo(() => rvCount(props.st.board));
  return (
    <div class="bg-reversi-wrap" style={{ "--c0": props.colors[0], "--c1": props.colors[1] }}>
      <div class="bg-rv-score"><span><i class="bg-disc p0" />{cnt().b}</span><span><i class="bg-disc p1" />{cnt().w}</span></div>
      <div class="bg-grid bg-reversi" style={{ "grid-template-columns": "repeat(8,1fr)" }}>
        <For each={range(64)}>
          {(i) => { const v = () => props.st.board[i]; return (
            <button class="bg-cell bg-rv-cell" classList={{ legal: legal().has(i) }} disabled={!legal().has(i)} onClick={() => props.onAct({ r: (i / 8) | 0, c: i % 8 })}>
              <Show when={v() !== null}><span class="bg-disc" classList={{ p0: v() === 0, p1: v() === 1, last: props.st.last === i }} /></Show>
            </button>
          ); }}
        </For>
      </div>
    </div>
  );
}

function CheckersBoard(props: { st: Checkers; seat: number; myTurn: boolean; colors: string[]; onAct: (a: any) => void }) {
  const [path, setPath] = createSignal<number[]>([]);
  const moves = createMemo(() => (props.myTurn ? ckMoves(props.st.board, props.seat as Side) : []));
  const sources = createMemo(() => new Set(moves().map((m) => m[0])));
  const nextSteps = createMemo(() => {
    const p = path(); const s = new Set<number>();
    if (p.length) for (const m of moves()) if (m.length > p.length && p.every((x, i) => x === m[i])) s.add(m[p.length]);
    return s;
  });
  const click = (i: number) => {
    if (!props.myTurn) return;
    if (!path().length) { if (sources().has(i)) setPath([i]); return; }
    if (nextSteps().has(i)) {
      const np = [...path(), i];
      const full = moves().some((m) => m.length === np.length && m.every((x, k) => x === np[k]));
      const more = moves().some((m) => m.length > np.length && np.every((x, k) => x === m[k]));
      if (full && !more) { props.onAct({ path: np }); setPath([]); } else setPath(np);
    } else setPath(sources().has(i) ? [i] : []);
  };
  return (
    <div class="bg-checkers" classList={{ "bg-flip": props.seat === 1 }} style={{ "--c0": props.colors[0], "--c1": props.colors[1] }}>
      <For each={range(64)}>
        {(i) => {
          const r = (i / 8) | 0, c = i % 8;
          const p = () => props.st.board[i];
          return (
            <div class="bg-ck-cell" classList={{ dark: (r + c) % 2 === 1, src: sources().has(i) && !path().length, step: nextSteps().has(i), inpath: path().includes(i) }} onClick={() => click(i)}>
              <Show when={p()}><span class="bg-piece" classList={{ p0: p()!.s === 0, p1: p()!.s === 1 }}>{p()!.k ? "♔" : ""}</span></Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function LudoBoard(props: { st: Ludo; seat: number; myTurn: boolean; names: string[]; onAct: (a: any) => void }) {
  const s = () => props.st;
  // colour-blind-safe palette, remembered across sessions (red/green is the
  // classic 2-player pair and the worst possible one for colour vision)
  const [cb, setCb] = createSignal(localStorage.getItem("asp.ludo.cb") === "1");
  const PAL = () => (cb() ? LUDO_COLORS_CB : LUDO_COLORS);
  const toggleCb = () => { const v = !cb(); setCb(v); localStorage.setItem("asp.ludo.cb", v ? "1" : "0"); };
  const canRoll = () => props.myTurn && s().die === null && !s().over;
  const canMove = () => props.myTurn && s().die !== null && !s().over;
  const [use3d, setUse3d] = createSignal(hasWebGL); // 3D by default where supported
  const legalTokens = () => (canMove() ? s().legal : []);
  // Ludo almost always leaves exactly one legal move — auto-play it so nobody has
  // to hunt for a tiny piece (the old fail on mobile). Only real choices ask.
  let autoFired = false;
  createEffect(() => {
    const l = legalTokens();
    if (props.myTurn && l.length === 1 && !s().over) {
      if (!autoFired) { autoFired = true; const only = l[0]; setTimeout(() => props.onAct({ kind: "move", token: only }), 850); }
    } else autoFired = false;
  });
  const moveLabel = (t: number) => {
    const rel = s().tokens[props.seat][t];
    if (rel === -1) return "Bring a piece out";
    if (rel + (s().die ?? 0) >= LUDO_GOAL) return "Send one home";
    return `Move a piece +${s().die}`;
  };
  return (
    <div class="bg-ludo">
      <Show when={use3d()} fallback={
      <svg viewBox="0 0 15 15" class="bg-ludo-svg" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width="6" height="6" fill={PAL()[0]} opacity="0.18" />
        <rect x="9" y="0" width="6" height="6" fill={PAL()[1]} opacity="0.18" />
        <rect x="9" y="9" width="6" height="6" fill={PAL()[2]} opacity="0.18" />
        <rect x="0" y="9" width="6" height="6" fill={PAL()[3]} opacity="0.18" />
        {/* main track */}
        <For each={LUDO_PATH}>
          {(rc, i) => {
            const safe = LUDO_SAFE_IDX.has(i());
            const owner = i() === 0 ? 0 : i() === 13 ? 1 : i() === 26 ? 2 : i() === 39 ? 3 : -1;
            return <rect x={rc[1]} y={rc[0]} width="1" height="1" fill={owner >= 0 ? PAL()[owner] : (safe ? "#c9d6ea" : "#f2f6fc")} opacity={owner >= 0 ? 0.85 : 1} stroke="#9fb0c8" stroke-width="0.03" />;
          }}
        </For>
        {/* home columns + center */}
        <For each={LUDO_HOME}>
          {(col, qi) => <For each={col}>{(rc, j) => <rect x={rc[1]} y={rc[0]} width="1" height="1" fill={PAL()[qi()]} opacity={j() === 5 ? 0.95 : 0.5} stroke="#9fb0c8" stroke-width="0.03" />}</For>}
        </For>
        <rect x="6" y="6" width="3" height="3" fill="#dbe4f2" stroke="#9fb0c8" stroke-width="0.03" />
        {/* tokens */}
        <For each={range(s().np)}>
          {(seat) => { const quad = s().quads[seat]; return (
            <Index each={s().tokens[seat]}>
              {(rel, ti) => {
                const pos = () => rel() === -1 ? LUDO_BASE[quad][ti] : (ludoCell(quad, rel()) as [number, number]);
                const legalNow = () => canMove() && seat === props.seat && s().legal.includes(ti);
                return (
                  <circle cx={pos()[1] + 0.5} cy={pos()[0] + 0.5} r="0.34" fill={PAL()[quad]} stroke={legalNow() ? "#fff" : "#0b1220"} stroke-width={legalNow() ? "0.11" : "0.05"}
                    class="bg-ludo-token" classList={{ legal: legalNow() }} onClick={() => legalNow() && props.onAct({ kind: "move", token: ti })} />
                );
              }}
            </Index>
          ); }}
        </For>
      </svg>
      }>
        {/* two instances so flipping the palette REMOUNTS the scene — Ludo3D
            bakes its materials at mount, and this keeps it simple */}
        <Show when={cb()} fallback={<Ludo3D st={props.st} seat={props.seat} myTurn={props.myTurn} onAct={props.onAct} colors={LUDO_COLORS} />}>
          <Ludo3D st={props.st} seat={props.seat} myTurn={props.myTurn} onAct={props.onAct} colors={LUDO_COLORS_CB} />
        </Show>
      </Show>
      <div class="bg-ludo-ctrl">
        <Show when={s().die !== null && !use3d()}><div class="bg-die" title={`rolled ${s().die}`}>{DICE[s().die! - 1]}</div></Show>
        <Show when={canRoll()}><button class="bg-roll" onClick={() => props.onAct({ kind: "roll" })}>Roll the dice</button></Show>
        <Show when={canMove() && legalTokens().length > 1}>
          <span class="bg-status">Rolled {s().die} — pick a move:</span>
          <For each={legalTokens()}>{(t) => <button class="bg-move" onClick={() => props.onAct({ kind: "move", token: t })}>{moveLabel(t)}</button>}</For>
        </Show>
        <Show when={canMove() && legalTokens().length === 1}><span class="bg-status">Rolled {s().die} — moving your only piece…</span></Show>
        <Show when={!props.myTurn && !s().over}><span class="bg-status">{props.names[s().turn] || "Opponent"}'s turn…{s().die ? ` (they rolled ${s().die})` : ""}</span></Show>
        <Show when={s().over}><span class="bg-status">{s().winner === props.seat ? "You win" : `${props.names[s().winner!] || "Player"} wins`}</span></Show>
        <Show when={hasWebGL}><button class="ps-act bg-ludo-dim" onClick={() => setUse3d((v) => !v)}>{use3d() ? "2D view" : "3D view"}</button></Show>
        <button class="ps-act bg-ludo-dim" title="Colour-blind-safe piece colours" onClick={toggleCb}>{cb() ? "Classic colours" : "Colour-safe"}</button>
      </div>
    </div>
  );
}
