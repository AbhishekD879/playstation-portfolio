// Chess vs Stockfish 18 (lite, single-threaded WASM — no special headers
// needed) — or vs another live visitor over serverless P2P (Trystero/Nostr).
// chess.js keeps the rules; the engine runs in a Worker speaking UCI.
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { Chess } from "chess.js";
import type { NavAction } from "../input";
import * as sfx from "../audio";
import Board3D from "./Board3D";
import { joinChess, type ChessLink } from "../p2p";

const LEVELS = [
  { name: "Rookie", depth: 2 },
  { name: "Club", depth: 6 },
  { name: "Master", depth: 12 },
];

export default function ChessApp(props: {
  onWin: () => void;
  onClose: () => void;
  bind: (nav: (a: NavAction) => void) => void;
}) {
  const game = new Chess();
  const [fen, setFen] = createSignal(game.fen());
  const [cursor, setCursor] = createSignal(52); // e2
  const [picked, setPicked] = createSignal<number | null>(null);
  const [thinking, setThinking] = createSignal(false);
  const [level, setLevel] = createSignal(1);
  const [msg, setMsg] = createSignal("You\u2019re white — click or drag a piece, dots show where it can go.");
  const [mode, setMode] = createSignal<"engine" | "wait" | "p2p">("engine");
  let engine: Worker | null = null;
  let link: ChessLink | null = null;
  let pairPoll: ReturnType<typeof setInterval> | null = null;
  const myColor = (): "w" | "b" => (mode() === "p2p" ? link?.color() ?? "w" : "w");

  function resetGame() {
    game.reset();
    setFen(game.fen());
    setPicked(null);
    setThinking(false);
  }

  function leaveP2p(reason: string) {
    if (pairPoll) { clearInterval(pairPoll); pairPoll = null; }
    link?.leave();
    link = null;
    setMode("engine");
    resetGame();
    setMsg(reason);
  }

  async function toggleP2p() {
    if (mode() !== "engine") { sfx.back(); leaveP2p("Back vs the machine — you're white."); return; }
    sfx.confirm();
    setMode("wait");
    setMsg("Looking for another visitor on the console… (they open Chess → vs visitor)");
    try {
      link = await joinChess();
      link.onMove((uci) => {
        try { game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as any) ?? "q" }); } catch { return; }
        setFen(game.fen());
        sfx.tickV();
        checkEnd();
      });
      link.onPeerLeave(() => leaveP2p("Your opponent left — back vs the machine."));
      pairPoll = setInterval(() => {
        if (!link) return;
        if (link.paired()) {
          clearInterval(pairPoll!); pairPoll = null;
          resetGame();
          setMode("p2p");
          setMsg(link.color() === "w"
            ? "Visitor connected — you're WHITE. Your move."
            : "Visitor connected — you're BLACK (the top pieces). They move first.");
          sfx.confirm();
        }
      }, 300);
    } catch {
      leaveP2p("P2P unavailable right now — the machine awaits.");
    }
  }
  onCleanup(() => { if (pairPoll) clearInterval(pairPoll); link?.leave(); });

  onMount(() => {
    engine = new Worker("/stockfish/stockfish-18-lite-single.js");
    engine.postMessage("uci");
    engine.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      if (line.startsWith("bestmove")) {
        const mv = line.split(" ")[1];
        if (mv && mv !== "(none)") {
          game.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] ?? "q" });
          setFen(game.fen());
          sfx.tickV();
        }
        setThinking(false);
        checkEnd();
      }
    };
    onCleanup(() => engine?.terminate());
  });

  const sq = (i: number) => "abcdefgh"[i % 8] + String(8 - Math.floor(i / 8));
  const idxOf = (square: string) => "abcdefgh".indexOf(square[0]) + (8 - +square[1]) * 8;
  // legal destinations for the picked piece — the "where can I go" dots
  const hints = () => {
    fen();
    const pk = picked();
    if (pk === null) return new Set<number>();
    return new Set(game.moves({ square: sq(pk) as any, verbose: true }).map((m: any) => idxOf(m.to)));
  };

  function checkEnd(): boolean {
    if (game.isCheckmate()) {
      const iWon = game.turn() !== myColor(); // the side to move is the one mated
      if (mode() === "p2p") {
        setMsg(iWon ? "CHECKMATE — you beat a real human!" : "Checkmate — the visitor got you.");
      } else {
        setMsg(iWon ? "CHECKMATE — you beat the machine." : "Checkmate — the machine prevails.");
        if (iWon) props.onWin();
      }
      return true;
    }
    if (game.isDraw()) { setMsg("Draw — an honorable exit."); return true; }
    if (game.isCheck()) setMsg("Check!");
    return false;
  }

  // is it this player's piece + this player's turn?
  const canAct = () => (mode() === "p2p" ? game.turn() === myColor() : !thinking());

  function tryMove(from: number, to: number) {
    let mv: any;
    try {
      mv = game.move({ from: sq(from), to: sq(to), promotion: "q" });
    } catch {
      sfx.deny();
      setPicked(null);
      return;
    }
    setFen(game.fen());
    setPicked(null);
    sfx.confirm();
    setMsg("");
    if (mode() === "p2p") {
      link?.sendMove(`${mv.from}${mv.to}${mv.promotion ?? ""}`);
      checkEnd();
      return;
    }
    if (checkEnd()) return;
    setThinking(true);
    engine?.postMessage(`position fen ${game.fen()}`);
    engine?.postMessage(`go depth ${LEVELS[level()].depth}`);
  }

  function confirm() {
    if (!canAct()) return;
    const c = cursor();
    if (picked() === null) {
      const p = game.get(sq(c) as any);
      if (p && p.color === myColor()) { setPicked(c); sfx.tickH(); setMsg(""); }
      else { sfx.deny(); setMsg(mode() === "p2p" && myColor() === "b" ? "Pick one of YOUR pieces (black, top)." : "Pick one of YOUR pieces (white, bottom)."); }
    } else if (picked() === c) {
      setPicked(null);
      sfx.back();
    } else {
      tryMove(picked()!, c);
    }
  }

  // mouse & touch: click-click AND drag both work
  let pickedOnDown = false;
  function squareDown(i: number) {
    if (!canAct()) return;
    setCursor(i);
    if (picked() === null) {
      const p = game.get(sq(i) as any);
      if (p && p.color === myColor()) { setPicked(i); pickedOnDown = true; sfx.tickH(); setMsg(""); }
      else { sfx.deny(); setMsg(mode() === "p2p" && myColor() === "b" ? "Pick one of YOUR pieces (black, top)." : "Pick one of YOUR pieces (white, bottom)."); }
    } else {
      pickedOnDown = false;
    }
  }
  function squareUp(i: number) {
    if (picked() === null) return;
    if (i === picked()) {
      if (!pickedOnDown) { setPicked(null); sfx.back(); }
    } else {
      tryMove(picked()!, i);
    }
  }

  props.bind((a) => {
    if (a === "left") { setCursor((cursor() + 63) % 64); sfx.tickV(); }
    if (a === "right") { setCursor((cursor() + 1) % 64); sfx.tickV(); }
    if (a === "up") { setCursor((cursor() + 56) % 64); sfx.tickV(); }
    if (a === "down") { setCursor((cursor() + 8) % 64); sfx.tickV(); }
    if (a === "confirm") confirm();
    if (a === "options") { setLevel((level() + 1) % LEVELS.length); sfx.tickH(); }
    if (a === "back") { sfx.back(); props.onClose(); }
  });

  return (
    <div class="chess">
      <div class="chess-head">
        <div class="panel-tag">{mode() === "p2p" ? "CHESS — LIVE VS A VISITOR · P2P" : "CHESS — STOCKFISH 18 · WASM, ON THIS DEVICE"}</div>
        <div class="chess-level" onClick={toggleP2p} title="Play another live visitor — serverless WebRTC">
          opponent: {mode() === "engine" ? "machine — tap for a visitor" : mode() === "wait" ? "searching…" : "◉ live visitor"}
        </div>
        <Show when={mode() === "engine"}>
          <div class="chess-level" onClick={() => setLevel((level() + 1) % LEVELS.length)}>
            engine: {LEVELS[level()].name} {thinking() ? "· thinking…" : ""}
          </div>
        </Show>
      </div>
      <Board3D
        board={(fen(), game.board()) as any}
        cursor={cursor()}
        picked={picked()}
        hints={hints()}
        onDown={squareDown}
        onUp={squareUp}
      />
      <div class="chess-msg">{msg()}</div>
      <div class="panel-hint guide-hint">
        arrows move · <span class="btn-x" /> pick / drop · O — engine level · <span class="btn-o" /> quit
      </div>
    </div>
  );
}
