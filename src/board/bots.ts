// Computer opponents for the Board Games app. Pure functions over rules.ts —
// a bot only ever returns the SAME action object a human click produces, so it
// flows through the identical `applyAct` validation path (no special casing, and
// an illegal bot move is impossible by construction).
//
// Strengths are tuned to "fun to play against", not "unbeatable": Connect Four
// and Checkers search, Gomoku and Reversi use strong heuristics, Ludo follows
// priority rules. All are fast enough to run synchronously on the main thread.
import {
  type AnyState, type Side, type Cell, type CkPiece,
  C4_COLS, C4_ROWS, c4Drop, type C4,
  GO_SIZE, goPlace, type Gomoku,
  rvLegal, rvPlace, type Reversi,
  ckMoves, ckApply, type Checkers,
  ludoLegal, ludoMove, ludoAbs, LUDO_GOAL, LUDO_SAFE_IDX, type Ludo,
} from "./rules";

const other = (s: Side): Side => (1 - s) as Side;
const WIN = 1e6;

// ————————————————————————————————————————————— Connect Four (negamax + α/β)
const C4_ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre-first helps α/β prune hard
function c4Eval(board: Cell[], me: Side): number {
  const at = (r: number, c: number) => board[r * C4_COLS + c];
  let sc = 0;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
      const er = r + 3 * dr, ec = c + 3 * dc;
      if (er < 0 || er >= C4_ROWS || ec < 0 || ec >= C4_COLS) continue;
      let mine = 0, theirs = 0;
      for (let k = 0; k < 4; k++) { const v = at(r + k * dr, c + k * dc); if (v === me) mine++; else if (v !== null) theirs++; }
      if (mine && theirs) continue;                       // blocked window, worthless
      if (mine) sc += mine === 3 ? 60 : mine === 2 ? 8 : 1;
      else if (theirs) sc -= theirs === 3 ? 70 : theirs === 2 ? 9 : 1; // block slightly > build
    }
  }
  for (let r = 0; r < C4_ROWS; r++) if (at(r, 3) === me) sc += 4; // centre control
  return sc;
}
function c4Search(s: C4, me: Side, depth: number, alpha: number, beta: number): number {
  if (s.over) return s.draw || s.winner === null ? 0 : (s.winner === me ? WIN + depth : -(WIN + depth));
  if (depth === 0) return c4Eval(s.board, me);
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  let any = false;
  for (const col of C4_ORDER) {
    const ns = c4Drop(s, col, s.turn);
    if (!ns) continue;
    any = true;
    const v = c4Search(ns, me, depth - 1, alpha, beta);
    if (maxing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return any ? best : c4Eval(s.board, me);
}
function c4Bot(s: C4, me: Side): { col: number } | null {
  let bestCol = -1, bestV = -Infinity;
  for (const col of C4_ORDER) {
    const ns = c4Drop(s, col, me);
    if (!ns) continue;
    const v = c4Search(ns, me, 5, -Infinity, Infinity);
    if (v > bestV) { bestV = v; bestCol = col; }
  }
  return bestCol < 0 ? null : { col: bestCol };
}

// ————————————————————————————————————————————— Gomoku (threat heuristic)
// 15×15 is far too wide to search, so score candidate cells by the shapes they
// make (and the shapes they deny) — open threes/fours dominate, as in real play.
function goShape(board: Cell[], r: number, c: number, side: Side): number {
  let total = 0;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let run = 1, open = 0;
    for (const sg of [1, -1]) {
      let rr = r + dr * sg, cc = c + dc * sg;
      while (rr >= 0 && rr < GO_SIZE && cc >= 0 && cc < GO_SIZE && board[rr * GO_SIZE + cc] === side) { run++; rr += dr * sg; cc += dc * sg; }
      if (rr >= 0 && rr < GO_SIZE && cc >= 0 && cc < GO_SIZE && board[rr * GO_SIZE + cc] === null) open++;
    }
    total += run >= 5 ? 1e7
      : run === 4 ? (open >= 1 ? 1e5 : 600)
      : run === 3 ? (open >= 2 ? 6e3 : 350)
      : run === 2 ? (open >= 2 ? 220 : 45)
      : 12;
  }
  return total;
}
function goBot(s: Gomoku, me: Side): { r: number; c: number } | null {
  const opp = other(me);
  const cand: number[] = [];
  const seen = new Set<number>();
  let stones = 0;
  for (let i = 0; i < s.board.length; i++) {
    if (s.board[i] === null) continue;
    stones++;
    const r0 = (i / GO_SIZE) | 0, c0 = i % GO_SIZE;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || r >= GO_SIZE || c < 0 || c >= GO_SIZE) continue;
      const j = r * GO_SIZE + c;
      if (s.board[j] !== null || seen.has(j)) continue;
      seen.add(j); cand.push(j);
    }
  }
  if (!stones) { const mid = ((GO_SIZE / 2) | 0); return { r: mid, c: mid }; }
  let best = cand[0], bestV = -Infinity;
  for (const j of cand) {
    const r = (j / GO_SIZE) | 0, c = j % GO_SIZE;
    // build + deny, with a nudge toward the centre to keep play cohesive
    const v = goShape(s.board, r, c, me) + goShape(s.board, r, c, opp) * 0.95
      - (Math.abs(r - 7) + Math.abs(c - 7)) * 2;
    if (v > bestV) { bestV = v; best = j; }
  }
  return best === undefined ? null : { r: (best / GO_SIZE) | 0, c: best % GO_SIZE };
}

// ————————————————————————————————————————————— Reversi (positional, 3-ply)
// Corners are permanent, the squares beside them hand corners away — classic
// Othello weights beat naive "flip the most discs" by a mile.
const RV_W = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];
function rvEval(board: Cell[], me: Side): number {
  let sc = 0;
  for (let i = 0; i < 64; i++) { const v = board[i]; if (v === me) sc += RV_W[i]; else if (v !== null) sc -= RV_W[i]; }
  return sc + (rvLegal(board, me).length - rvLegal(board, other(me)).length) * 3; // mobility
}
function rvSearch(s: Reversi, me: Side, depth: number): number {
  if (s.over) { const { b, w } = { b: s.board.filter((x) => x === 0).length, w: s.board.filter((x) => x === 1).length };
    const mine = me === 0 ? b : w, theirs = me === 0 ? w : b;
    return mine === theirs ? 0 : (mine > theirs ? WIN : -WIN); }
  if (depth === 0) return rvEval(s.board, me);
  const moves = rvLegal(s.board, s.turn);
  if (!moves.length) return rvEval(s.board, me);
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  for (const i of moves) {
    const ns = rvPlace(s, (i / 8) | 0, i % 8, s.turn);
    if (!ns) continue;
    const v = rvSearch(ns, me, depth - 1);
    best = maxing ? Math.max(best, v) : Math.min(best, v);
  }
  return Number.isFinite(best) ? best : rvEval(s.board, me);
}
function rvBot(s: Reversi, me: Side): { r: number; c: number } | null {
  const moves = rvLegal(s.board, me);
  if (!moves.length) return null;
  let best = moves[0], bestV = -Infinity;
  for (const i of moves) {
    const ns = rvPlace(s, (i / 8) | 0, i % 8, me);
    if (!ns) continue;
    const v = rvSearch(ns, me, 2);
    if (v > bestV) { bestV = v; best = i; }
  }
  return { r: (best / 8) | 0, c: best % 8 };
}

// ————————————————————————————————————————————— Checkers (negamax)
function ckEval(board: (CkPiece | null)[], me: Side): number {
  let sc = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i]; if (!p) continue;
    const row = (i / 8) | 0, col = i % 8;
    const adv = p.s === 0 ? 7 - row : row;                  // progress to promotion
    const v = (p.k ? 20 : 11) + adv * 0.45 + (col === 0 || col === 7 ? 0.7 : 0);
    sc += p.s === me ? v : -v;
  }
  return sc;
}
function ckSearch(s: Checkers, me: Side, depth: number, alpha: number, beta: number): number {
  if (s.over) return s.winner === me ? WIN + depth : -(WIN + depth);
  if (depth === 0) return ckEval(s.board, me);
  const moves = ckMoves(s.board, s.turn);
  if (!moves.length) return s.turn === me ? -(WIN + depth) : WIN + depth;
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  for (const path of moves) {
    const ns = ckApply(s, path, s.turn);
    if (!ns) continue;
    const v = ckSearch(ns, me, depth - 1, alpha, beta);
    if (maxing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return Number.isFinite(best) ? best : ckEval(s.board, me);
}
function ckBot(s: Checkers, me: Side): { path: number[] } | null {
  const moves = ckMoves(s.board, me);
  if (!moves.length) return null;
  let best = moves[0], bestV = -Infinity;
  for (const path of moves) {
    const ns = ckApply(s, path, me);
    if (!ns) continue;
    const v = ckSearch(ns, me, 3, -Infinity, Infinity);
    if (v > bestV) { bestV = v; best = path; }
  }
  return { path: best };
}

// ————————————————————————————————————————————— Ludo (priority rules)
function ludoBot(s: Ludo, seat: number): { kind: "move"; token: number } | null {
  const die = s.die;
  if (die === null) return null;
  const legal = s.legal.length ? s.legal : ludoLegal(s, seat, die);
  if (!legal.length) return null;
  let best = legal[0], bestV = -Infinity;
  for (const t of legal) {
    const ns = ludoMove(s, seat, t);
    if (!ns) continue;
    const from = s.tokens[seat][t], to = ns.tokens[seat][t];
    let v = to * 3;                                        // general progress
    if (to === LUDO_GOAL) v += 1000;                       // a token home is huge
    if (from === -1) v += 400;                             // getting out matters early
    let caps = 0;                                          // sending someone home
    for (let p = 0; p < s.np; p++) {
      if (p === seat) continue;
      for (let i = 0; i < 4; i++) if (s.tokens[p][i] >= 0 && ns.tokens[p][i] === -1) caps++;
    }
    v += caps * 800;
    if (to > 50) v += 200;                                 // safe inside the home column
    else if (LUDO_SAFE_IDX.has(ludoAbs(s.quads[seat], to))) v += 120; // safe square
    if (v > bestV) { bestV = v; best = t; }
  }
  return { kind: "move", token: best };
}

/** The bot's action for whoever's turn it is — feed straight into applyAct.
 *  null = nothing legal (the rules layer will pass the turn). */
export function botAction(st: AnyState, seat: number): any | null {
  switch (st.k) {
    case "c4": return c4Bot(st, seat as Side);
    case "gomoku": return goBot(st, seat as Side);
    case "reversi": return rvBot(st, seat as Side);
    case "checkers": return ckBot(st, seat as Side);
    case "ludo": return st.die === null ? { kind: "roll" } : ludoBot(st, seat);
  }
}
