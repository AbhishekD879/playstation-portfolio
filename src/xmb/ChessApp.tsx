// Chess vs Stockfish 18 (lite, single-threaded WASM — no special headers needed).
// chess.js keeps the rules; the engine runs in a Worker speaking UCI.
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Chess } from "chess.js";
import type { NavAction } from "../input";
import * as sfx from "../audio";

const GLYPH: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
};
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
  let engine: Worker | null = null;

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
  const pieceAt = (i: number) => {
    const p = game.get(sq(i) as any);
    return p ? GLYPH[p.color === "w" ? p.type.toUpperCase() : p.type] : "";
  };
  // legal destinations for the picked piece — the "where can I go" dots
  const hints = () => {
    fen();
    const pk = picked();
    if (pk === null) return new Set<number>();
    return new Set(game.moves({ square: sq(pk) as any, verbose: true }).map((m: any) => idxOf(m.to)));
  };

  function checkEnd(): boolean {
    if (game.isCheckmate()) {
      const humanWon = game.turn() === "b";
      setMsg(humanWon ? "CHECKMATE — you beat the machine." : "Checkmate — the machine prevails.");
      if (humanWon) props.onWin();
      return true;
    }
    if (game.isDraw()) { setMsg("Draw — an honorable exit."); return true; }
    if (game.isCheck()) setMsg("Check!");
    return false;
  }

  function tryMove(from: number, to: number) {
    try {
      game.move({ from: sq(from), to: sq(to), promotion: "q" });
    } catch {
      sfx.deny();
      setPicked(null);
      return;
    }
    setFen(game.fen());
    setPicked(null);
    sfx.confirm();
    setMsg("");
    if (checkEnd()) return;
    setThinking(true);
    engine?.postMessage(`position fen ${game.fen()}`);
    engine?.postMessage(`go depth ${LEVELS[level()].depth}`);
  }

  function confirm() {
    if (thinking()) return;
    const c = cursor();
    if (picked() === null) {
      const p = game.get(sq(c) as any);
      if (p && p.color === "w") { setPicked(c); sfx.tickH(); setMsg(""); }
      else { sfx.deny(); setMsg("Pick one of YOUR pieces (white, bottom)."); }
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
    if (thinking()) return;
    setCursor(i);
    if (picked() === null) {
      const p = game.get(sq(i) as any);
      if (p && p.color === "w") { setPicked(i); pickedOnDown = true; sfx.tickH(); setMsg(""); }
      else { sfx.deny(); setMsg("Pick one of YOUR pieces (white, bottom)."); }
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
        <div class="panel-tag">CHESS — STOCKFISH 18 · WASM, ON THIS DEVICE</div>
        <div class="chess-level" onClick={() => setLevel((level() + 1) % LEVELS.length)}>
          engine: {LEVELS[level()].name} {thinking() ? "· thinking…" : ""}
        </div>
      </div>
      <div class="chess-board" data-fen={fen()}>
        <For each={Array.from({ length: 64 }, (_, i) => i)}>
          {(i) => (
            <div
              class="chess-sq"
              classList={{
                dark: (Math.floor(i / 8) + i) % 2 === 1,
                cursor: i === cursor(),
                picked: i === picked(),
                hint: hints().has(i),
              }}
              onPointerDown={() => squareDown(i)}
              onPointerUp={() => squareUp(i)}
              onPointerEnter={(e) => { if (e.buttons) setCursor(i); }}
            >
              {pieceAt(i)}
            </div>
          )}
        </For>
      </div>
      <div class="chess-msg">{msg()}</div>
      <div class="panel-hint guide-hint">
        arrows move · <span class="btn-x" /> pick / drop · O — engine level · <span class="btn-o" /> quit
      </div>
    </div>
  );
}
