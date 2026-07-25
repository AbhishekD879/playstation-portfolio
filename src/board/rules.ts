// Pure rules for the Board Games app. No UI, no network — just state + moves,
// so the same logic drives the on-screen board AND the host's authority check.
// Side 0 always moves first (= the room host); side 1 = the joiner.
export type Side = 0 | 1;
export type Cell = 0 | 1 | null;

// ————————————————————————————————————————————— Connect Four (7×6)
export const C4_COLS = 7, C4_ROWS = 6;
export interface C4 { k: "c4"; board: Cell[]; turn: Side; winner: Side | null; over: boolean; draw: boolean; last: number | null }
export const c4Init = (): C4 => ({ k: "c4", board: Array(C4_COLS * C4_ROWS).fill(null), turn: 0, winner: null, over: false, draw: false, last: null });

function line4(board: Cell[], r: number, c: number, cols: number, rows: number, side: Side, need: number): boolean {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1;
    for (const sg of [1, -1]) {
      let rr = r + dr * sg, cc = c + dc * sg;
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr * cols + cc] === side) { n++; rr += dr * sg; cc += dc * sg; }
    }
    if (n >= need) return true;
  }
  return false;
}

/** Drop a disc into `col`. Returns the next state, or null if illegal. */
export function c4Drop(s: C4, col: number, side: Side): C4 | null {
  if (s.over || s.turn !== side || col < 0 || col >= C4_COLS) return null;
  let row = -1;
  for (let r = C4_ROWS - 1; r >= 0; r--) if (s.board[r * C4_COLS + col] === null) { row = r; break; }
  if (row < 0) return null;
  const board = s.board.slice(); const idx = row * C4_COLS + col; board[idx] = side;
  const win = line4(board, row, col, C4_COLS, C4_ROWS, side, 4);
  const draw = !win && board.every((c) => c !== null);
  return { ...s, board, turn: (1 - side) as Side, winner: win ? side : null, over: win || draw, draw, last: idx };
}

// ————————————————————————————————————————————— Gomoku (15×15, five in a row)
export const GO_SIZE = 15;
export interface Gomoku { k: "gomoku"; board: Cell[]; turn: Side; winner: Side | null; over: boolean; draw: boolean; last: number | null }
export const goInit = (): Gomoku => ({ k: "gomoku", board: Array(GO_SIZE * GO_SIZE).fill(null), turn: 0, winner: null, over: false, draw: false, last: null });

export function goPlace(s: Gomoku, r: number, c: number, side: Side): Gomoku | null {
  if (s.over || s.turn !== side || r < 0 || r >= GO_SIZE || c < 0 || c >= GO_SIZE) return null;
  const idx = r * GO_SIZE + c;
  if (s.board[idx] !== null) return null;
  const board = s.board.slice(); board[idx] = side;
  const win = line4(board, r, c, GO_SIZE, GO_SIZE, side, 5);
  const draw = !win && board.every((x) => x !== null);
  return { ...s, board, turn: (1 - side) as Side, winner: win ? side : null, over: win || draw, draw, last: idx };
}

// ————————————————————————————————————————————— Reversi / Othello (8×8)
export interface Reversi { k: "reversi"; board: Cell[]; turn: Side; winner: Side | null; over: boolean; draw: boolean; last: number | null }
const RV_DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
export function rvInit(): Reversi {
  const board: Cell[] = Array(64).fill(null);
  board[3 * 8 + 3] = 1; board[3 * 8 + 4] = 0; board[4 * 8 + 3] = 0; board[4 * 8 + 4] = 1; // side 0 (dark) moves first
  return { k: "reversi", board, turn: 0, winner: null, over: false, draw: false, last: null };
}
function rvFlips(board: Cell[], r: number, c: number, side: Side): number[] {
  if (board[r * 8 + c] !== null) return [];
  const opp = (1 - side) as Side; const out: number[] = [];
  for (const [dr, dc] of RV_DIRS) {
    const line: number[] = []; let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === opp) { line.push(rr * 8 + cc); rr += dr; cc += dc; }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc] === side) out.push(...line);
  }
  return out;
}
export const rvLegal = (board: Cell[], side: Side): number[] => {
  const m: number[] = []; for (let i = 0; i < 64; i++) if (board[i] === null && rvFlips(board, (i / 8) | 0, i % 8, side).length) m.push(i); return m;
};
export const rvCount = (board: Cell[]) => { let b = 0, w = 0; for (const x of board) { if (x === 0) b++; else if (x === 1) w++; } return { b, w }; };
export function rvPlace(s: Reversi, r: number, c: number, side: Side): Reversi | null {
  if (s.over || s.turn !== side) return null;
  const flips = rvFlips(s.board, r, c, side);
  if (!flips.length) return null;
  const board = s.board.slice(); board[r * 8 + c] = side; for (const f of flips) board[f] = side;
  const end = (): Reversi => { const { b, w } = rvCount(board); return { ...s, board, turn: side, winner: b === w ? null : (b > w ? 0 : 1), over: true, draw: b === w, last: r * 8 + c }; };
  if (board.every((x) => x !== null)) return end();
  let next = (1 - side) as Side;
  if (!rvLegal(board, next).length) { if (rvLegal(board, side).length) next = side; else return end(); } // opponent passes, or nobody can move
  return { ...s, board, turn: next, winner: null, over: false, draw: false, last: r * 8 + c };
}

// ————————————————————————————————————————————— Checkers (English draughts, 8×8)
export interface CkPiece { s: Side; k: boolean }
// `noProg` counts plies since the last capture or crowning. Without it two kings
// can shuffle forever (bot-vs-bot ran 900+ plies) — 50 gives the standard
// "no progress = draw" out.
export interface Checkers { k: "checkers"; board: (CkPiece | null)[]; turn: Side; winner: Side | null; over: boolean; draw: boolean; last: number[] | null; noProg: number }
export const CK_NO_PROGRESS_DRAW = 50;
const dark = (r: number, c: number) => (r + c) % 2 === 1;
const ckDirs = (p: CkPiece) => p.k ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : (p.s === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]);
export function ckInit(): Checkers {
  const board: (CkPiece | null)[] = Array(64).fill(null);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if (dark(r, c)) board[r * 8 + c] = { s: 1, k: false }; // top = side 1, moves down
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if (dark(r, c)) board[r * 8 + c] = { s: 0, k: false }; // bottom = side 0, moves up
  return { k: "checkers", board, turn: 0, winner: null, over: false, draw: false, last: null, noProg: 0 };
}
// all jump paths from a square (landing squares, not incl. start); mutates copies so multi-jumps are correct
function ckJumps(board: (CkPiece | null)[], from: number, p: CkPiece): number[][] {
  const r = (from / 8) | 0, c = from % 8; const out: number[][] = [];
  for (const [dr, dc] of ckDirs(p)) {
    const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
    if (lr < 0 || lr >= 8 || lc < 0 || lc >= 8 || !dark(lr, lc)) continue;
    const mid = board[mr * 8 + mc];
    if (!mid || mid.s === p.s) continue;
    if (board[lr * 8 + lc] !== null) continue;
    const nb = board.slice(); nb[from] = null; nb[mr * 8 + mc] = null;
    const crowned = !p.k && ((p.s === 0 && lr === 0) || (p.s === 1 && lr === 7));
    const np: CkPiece = { s: p.s, k: p.k || crowned }; nb[lr * 8 + lc] = np;
    if (crowned) { out.push([lr * 8 + lc]); continue; } // crowning ends the turn (English rule)
    const more = ckJumps(nb, lr * 8 + lc, np);
    if (more.length) for (const f of more) out.push([lr * 8 + lc, ...f]);
    else out.push([lr * 8 + lc]);
  }
  return out;
}
/** Every legal move for `side` as a path [from, ...steps]. Captures are mandatory. */
export function ckMoves(board: (CkPiece | null)[], side: Side): number[][] {
  const caps: number[][] = [], slides: number[][] = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i]; if (!p || p.s !== side) continue;
    for (const seq of ckJumps(board, i, p)) caps.push([i, ...seq]);
    if (caps.length) continue; // once a capture exists, slides are irrelevant (but still scan for more caps)
    const r = (i / 8) | 0, c = i % 8;
    for (const [dr, dc] of ckDirs(p)) { const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && dark(nr, nc) && board[nr * 8 + nc] === null) slides.push([i, nr * 8 + nc]); }
  }
  // recompute caps fully (the early-continue above may have skipped slide scan but we still need ALL caps)
  if (caps.length) { const all: number[][] = []; for (let i = 0; i < 64; i++) { const p = board[i]; if (!p || p.s !== side) continue; for (const seq of ckJumps(board, i, p)) all.push([i, ...seq]); } return all; }
  return slides;
}
export function ckApply(s: Checkers, path: number[], side: Side): Checkers | null {
  if (s.over || s.turn !== side || !path || path.length < 2) return null;
  const legal = ckMoves(s.board, side);
  if (!legal.some((m) => m.length === path.length && m.every((x, i) => x === path[i]))) return null;
  const board = s.board.slice();
  let cur = path[0]; const p0 = board[cur]; if (!p0) return null;
  let piece: CkPiece = { s: p0.s, k: p0.k }; board[cur] = null;
  let captured = false;
  for (let i = 1; i < path.length; i++) {
    const to = path[i], cr = (cur / 8) | 0, cc = cur % 8, tr = (to / 8) | 0, tc = to % 8;
    if (Math.abs(tr - cr) === 2) { board[((cr + tr) / 2) * 8 + ((cc + tc) / 2)] = null; captured = true; } // captured mid
    cur = to;
  }
  const fr = (cur / 8) | 0;
  let crowned = false;
  if (!piece.k && ((piece.s === 0 && fr === 0) || (piece.s === 1 && fr === 7))) { piece = { ...piece, k: true }; crowned = true; }
  board[cur] = piece;
  const next = (1 - side) as Side;
  const stuck = ckMoves(board, next).length === 0;
  const noProg = captured || crowned ? 0 : s.noProg + 1;
  const stale = !stuck && noProg >= CK_NO_PROGRESS_DRAW; // nobody making progress → draw
  return { ...s, board, turn: next, winner: stuck ? side : null, over: stuck || stale, draw: stale, last: path, noProg };
}

// ————————————————————————————————————————————— Ludo (2–4 players, dice)
// Classic 15×15 cross board. A token's `rel` position: -1 = in base, 0..50 =
// on the 52-cell shared loop (abs cell = (entry+rel)%52), 51..56 = private home
// column (56 = home/goal). Host rolls the die (only place randomness lives).
export const LUDO_PATH: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];
const LUDO_ENTRY = [0, 13, 26, 39];
export const LUDO_HOME: [number, number][][] = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];
export const LUDO_BASE: [number, number][][] = [
  [[1, 1], [1, 4], [4, 1], [4, 4]], [[1, 10], [1, 13], [4, 10], [4, 13]],
  [[10, 10], [10, 13], [13, 10], [13, 13]], [[10, 1], [10, 4], [13, 1], [13, 4]],
];
const LUDO_SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const LUDO_SAFE_IDX = LUDO_SAFE;
export const LUDO_QUADS: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export const LUDO_COLORS = ["#ff5c6c", "#4aa3ff", "#43d9a3", "#ffca3a"]; // per quadrant
// Colour-blind-safe alternative (Okabe–Ito). Ordered so the 2-PLAYER quadrants
// (0 and 2, the diagonal pair) land on blue vs orange — the one contrast that
// reads for every kind of colour vision, unlike the classic red/green.
export const LUDO_COLORS_CB = ["#0072b2", "#f0e442", "#e69f00", "#cc79a7"];
export const LUDO_GOAL = 56;

export interface Ludo {
  k: "ludo"; np: number; quads: number[]; // seat → quadrant
  tokens: number[][];                      // [np][4], each rel -1..56
  turn: number; die: number | null; legal: number[]; winner: number | null; over: boolean;
  last: { seat: number; token: number } | null;
}
export function ludoInit(np: number): Ludo {
  const quads = LUDO_QUADS[np] ?? [0, 1, 2, 3].slice(0, np);
  return { k: "ludo", np, quads, tokens: Array.from({ length: np }, () => [-1, -1, -1, -1]), turn: 0, die: null, legal: [], winner: null, over: false, last: null };
}
export const ludoAbs = (quad: number, rel: number) => (rel >= 0 && rel <= 50 ? (LUDO_ENTRY[quad] + rel) % 52 : -1);
export const ludoCell = (quad: number, rel: number): [number, number] | null =>
  rel === -1 ? null : rel <= 50 ? LUDO_PATH[(LUDO_ENTRY[quad] + rel) % 52] : LUDO_HOME[quad][rel - 51];
export function ludoLegal(s: Ludo, seat: number, die: number): number[] {
  const out: number[] = [];
  s.tokens[seat].forEach((rel, t) => {
    if (rel === LUDO_GOAL) return;
    if (rel === -1) { if (die === 6) out.push(t); return; }
    if (rel + die <= LUDO_GOAL) out.push(t);
  });
  return out;
}
const ludoNextTurn = (np: number, from: number, tokens: number[][]) => {
  let n = from;
  for (let i = 0; i < np; i++) { n = (n + 1) % np; if (tokens[n].some((r) => r !== LUDO_GOAL)) return n; }
  return from;
};
/** Host-only: apply a die roll (die supplied by the host RNG). Auto-passes with no move. */
export function ludoRoll(s: Ludo, seat: number, die: number): Ludo | null {
  if (s.over || s.turn !== seat || s.die !== null) return null;
  const legal = ludoLegal(s, seat, die);
  if (!legal.length) return { ...s, die: null, legal: [], turn: ludoNextTurn(s.np, seat, s.tokens) };
  return { ...s, die, legal };
}
export function ludoMove(s: Ludo, seat: number, token: number): Ludo | null {
  const d = s.die;
  if (s.over || s.turn !== seat || d === null || !s.legal.includes(token)) return null;
  const quad = s.quads[seat];
  const tokens = s.tokens.map((row) => row.slice());
  let rel = tokens[seat][token];
  rel = rel === -1 ? 0 : rel + d;
  tokens[seat][token] = rel;
  const abs = ludoAbs(quad, rel);
  if (abs >= 0 && !LUDO_SAFE.has(abs)) // capture any opponent token sharing this cell
    for (let p = 0; p < s.np; p++) { if (p === seat) continue; const q = s.quads[p]; tokens[p].forEach((r, ti) => { if (r >= 0 && r <= 50 && ludoAbs(q, r) === abs) tokens[p][ti] = -1; }); }
  const won = tokens[seat].every((r) => r === LUDO_GOAL);
  const extra = d === 6 && !won;
  const turn = extra ? seat : ludoNextTurn(s.np, seat, tokens);
  return { ...s, tokens, die: null, legal: [], winner: won ? seat : null, over: won, last: { seat, token }, turn };
}

// ————————————————————————————————————————————— registry
export type AnyState = C4 | Gomoku | Reversi | Checkers | Ludo;
export interface GameMeta { key: AnyState["k"]; name: string; blurb: string; icon: string; minP: number; maxP: number; colors: string[]; seatNames: string[] }
export const GAMES: GameMeta[] = [
  { key: "c4", name: "Connect Four", blurb: "Drop discs — first to line up four wins.", icon: "disc", minP: 2, maxP: 2, colors: ["#ff5c6c", "#ffca3a"], seatNames: ["Red", "Yellow"] },
  { key: "gomoku", name: "Gomoku", blurb: "Place stones — five in a row on a 15×15 board.", icon: "grid", minP: 2, maxP: 2, colors: ["#1b2431", "#eef3fb"], seatNames: ["Black", "White"] },
  { key: "reversi", name: "Reversi", blurb: "Flank to flip. Own the most discs at the end.", icon: "circle", minP: 2, maxP: 2, colors: ["#1b2431", "#eef3fb"], seatNames: ["Black", "White"] },
  { key: "checkers", name: "Checkers", blurb: "Diagonal moves, forced jumps, crown your kings.", icon: "crown", minP: 2, maxP: 2, colors: ["#ff5c6c", "#eef3fb"], seatNames: ["Red", "White"] },
  { key: "ludo", name: "Ludo", blurb: "Race all four tokens home. 2–4 players, roll to move.", icon: "dice", minP: 2, maxP: 4, colors: LUDO_COLORS, seatNames: ["Red", "Blue", "Green", "Yellow"] },
];
export const gameInit = (k: AnyState["k"], np = 2): AnyState => k === "c4" ? c4Init() : k === "gomoku" ? goInit() : k === "reversi" ? rvInit() : k === "checkers" ? ckInit() : ludoInit(np);

/** Assert-based self-check for the rules. Run with tsx/node. */
export function demo() {
  const ok = (c: boolean, m: string) => { if (!c) throw new Error("FAIL: " + m); };
  // Connect Four vertical win for side 0
  let c: C4 | null = c4Init();
  for (let i = 0; i < 3; i++) { c = c4Drop(c!, 0, 0); c = c4Drop(c!, 1, 1); }
  c = c4Drop(c!, 0, 0); // 4th in column 0 for side 0
  ok(c!.over && c!.winner === 0, "c4 vertical win");
  ok(c4Drop(c4Init(), 0, 1) === null, "c4 wrong-turn rejected");

  // Gomoku horizontal win
  let g: Gomoku | null = goInit();
  for (let i = 0; i < 4; i++) { g = goPlace(g!, 0, i, 0); g = goPlace(g!, 1, i, 1); }
  g = goPlace(g!, 0, 4, 0);
  ok(g!.over && g!.winner === 0, "gomoku 5-in-row");

  // Reversi: opening has 4 legal moves; a legal move flips exactly one
  const rv = rvInit();
  ok(rvLegal(rv.board, 0).length === 4, "reversi 4 opening moves");
  const rv2 = rvPlace(rv, 2, 3, 0); // legal for black
  ok(rv2 !== null && rvCount(rv2!.board).b === 4, "reversi flip count");
  ok(rvPlace(rv, 0, 0, 0) === null, "reversi illegal move rejected");

  // Checkers: opening has 7 slide moves per side, no captures
  const ck = ckInit();
  const mv = ckMoves(ck.board, 0);
  ok(mv.length === 7 && mv.every((m) => m.length === 2), "checkers 7 opening slides");
  // set up a forced single capture
  const b2: (CkPiece | null)[] = Array(64).fill(null);
  b2[5 * 8 + 2] = { s: 0, k: false }; b2[4 * 8 + 3] = { s: 1, k: false }; // 0 can jump to (3,4)
  const caps = ckMoves(b2, 0);
  ok(caps.length === 1 && caps[0][0] === 5 * 8 + 2 && caps[0][1] === 3 * 8 + 4, "checkers forced capture path");
  // a capture resets the no-progress counter; a plain slide advances it
  const slid = ckApply(ckInit(), mv[0], 0);
  ok(slid!.noProg === 1, "checkers slide bumps noProg");
  const capState: Checkers = { ...ckInit(), board: b2, noProg: 9 };
  const took = ckApply(capState, caps[0], 0);
  ok(took!.noProg === 0, "checkers capture resets noProg");
  // 50 quiet plies = draw, so two kings can't shuffle forever
  const quiet: Checkers = { ...ckInit(), noProg: CK_NO_PROGRESS_DRAW - 1 };
  const drawn = ckApply(quiet, ckMoves(quiet.board, 0)[0], 0);
  ok(drawn!.over && drawn!.draw, "checkers no-progress draw");

  // Ludo: need a 6 to leave base; a 6 grants an extra turn; capture sends home
  let L: Ludo | null = ludoInit(2);
  ok(ludoLegal(L, 0, 3).length === 0, "ludo can't move on non-6 from base");
  ok(ludoLegal(L, 0, 6).length === 4, "ludo all four leave on a 6");
  L = ludoRoll(L, 0, 6); ok(L !== null && L!.die === 6, "ludo roll 6 keeps turn to move");
  L = ludoMove(L!, 0, 0); ok(L!.tokens[0][0] === 0 && L!.turn === 0, "ludo 6 → token out + extra turn (same player)");
  L = ludoRoll(L!, 0, 4); ok(L!.die === 4 && L!.turn === 0 && L!.legal.length === 1, "ludo rolled, one legal move, awaiting choice");
  L = ludoMove(L!, 0, 0); ok(L!.tokens[0][0] === 4 && L!.turn === 1, "ludo non-6 move passes the turn");
  // capture: seat0 (quad0) lands on abs 6 where seat1 (quad2, rel 32 → abs 6) sits
  const cap = ludoInit(2); cap.turn = 0; cap.die = 3; cap.legal = [0]; cap.tokens[0][0] = 3; cap.tokens[1][0] = 32;
  const moved = ludoMove(cap, 0, 0);
  ok(moved!.tokens[0][0] === 6 && moved!.tokens[1][0] === -1, "ludo capture sends opponent home");
  return "all board-rules checks passed";
}
