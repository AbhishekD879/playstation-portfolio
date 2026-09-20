// LZARI decompression, for MAX Drive (.max) PS2 save files.
//
// LZSS sliding-window matching with an adaptive arithmetic coder on top. It is
// the format Datel's MAX Drive wrote, and it is the single most common PS2 save
// format in circulation — on GameFAQs alone it is 16 of the 36 saves for one
// game — so an importer that skips it skips most of what people actually have.
//
// Ported from mymc+ (GPL-3.0), itself derived from Ross Ridge's mymc, which
// follows Haruhiko Okumura's original LZARI. Decoder only: nothing here needs
// to WRITE a .max, and the encoder is the larger and more delicate half.
//
// The constants are the format. Changing any of them produces a decoder that
// is silently incompatible rather than one that fails, so they are named and
// left alone.

const HIST_LEN = 4096;
const MIN_MATCH_LEN = 3;
const MAX_MATCH_LEN = 60;

const ARITH_BITS = 15;
const QUADRANT1 = 1 << ARITH_BITS;
const QUADRANT2 = QUADRANT1 * 2;
const QUADRANT3 = QUADRANT1 * 3;
const QUADRANT4 = QUADRANT1 * 4;
const MAX_CUM = QUADRANT1 - 1;
const MAX_CHAR = 256 + MAX_MATCH_LEN - MIN_MATCH_LEN + 1;

/** Upper bound on a decode, so a corrupt length field cannot ask for gigabytes.
 *  A PS2 memory card is 8MB; a single save cannot exceed it. */
export const MAX_DECODE_BYTES = 8 * 1024 * 1024;

/**
 * Right-bisect over a cumulative-frequency table, matching Python's
 * bisect_right(a, x, lo=1): the index of the first entry strictly greater
 * than x. The table is built in reverse so this can be a binary search.
 */
function bisectRight(a: Int32Array, x: number, lo: number): number {
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function decodeLzari(src: Uint8Array, outLength: number): Uint8Array {
  if (!Number.isInteger(outLength) || outLength < 0 || outLength > MAX_DECODE_BYTES) {
    throw new Error(`refusing to decompress ${outLength} bytes`);
  }

  // —— bit source ————————————————————————————————————————————————————————
  // The reference reads one bit at a time off the front and pads the tail with
  // zeroes; the coder always consumes a few bits past the real end.
  let bitPos = 0;
  const totalBits = src.length * 8;
  const nextBit = (): number => {
    if (bitPos >= totalBits) { bitPos++; return 0; }      // pad, as the reference does
    const b = (src[bitPos >>> 3] >>> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return b;
  };

  // —— adaptive model ————————————————————————————————————————————————————
  let high = QUADRANT4;
  let low = 0;
  let code = 0;
  // sym_cum is stored reversed so the search above can be a bisect
  const symCum = new Int32Array(MAX_CHAR + 1);
  for (let i = 0; i <= MAX_CHAR; i++) symCum[i] = i;
  const symbolToChar = new Int32Array(MAX_CHAR + 1);
  for (let i = 0; i <= MAX_CHAR; i++) symbolToChar[i] = i === 0 ? 0 : i - 1;
  const symFreq = new Int32Array(MAX_CHAR + 1);
  symFreq[0] = 0;
  for (let i = 1; i <= MAX_CHAR; i++) symFreq[i] = 1;

  const positionCum = new Int32Array(HIST_LEN + 1);
  {
    let a = 0;
    for (let i = HIST_LEN; i > 0; i--) {
      a = a + Math.floor(10000 / (200 + i));
      positionCum[i - 1] = a;
    }
  }

  /** The linear search the reference uses over position_cum (descending). */
  const searchPos = (table: Int32Array, x: number): number => {
    let c = 1;
    let s = table.length - 1;
    for (;;) {
      const a = Math.floor((s + c) / 2);
      if (table[a] <= x) s = a;
      else c = a + 1;
      if (c >= s) break;
    }
    return c;
  };

  const updateModel = (symbol: number): void => {
    if (symCum[MAX_CHAR] >= MAX_CUM) {
      let c = 0;
      for (let i = MAX_CHAR; i > 0; i--) {
        symCum[MAX_CHAR - i] = c;
        const a = (symFreq[i] + 1) >> 1;
        symFreq[i] = a;
        c += a;
      }
      symCum[MAX_CHAR] = c;
    }
    const freq = symFreq[symbol];
    let newSymbol = symbol;
    while (symFreq[newSymbol - 1] === freq) newSymbol--;
    if (newSymbol !== symbol) {
      const swapChar = symbolToChar[newSymbol];
      symbolToChar[newSymbol] = symbolToChar[symbol];
      symbolToChar[symbol] = swapChar;
    }
    symFreq[newSymbol] = freq + 1;
    for (let i = MAX_CHAR - newSymbol + 1; i <= MAX_CHAR; i++) symCum[i]++;
  };

  const decodeChar = (): number => {
    const range = high - low;
    const maxCumFreq = symCum[MAX_CHAR];
    const n = Math.floor(((code - low + 1) * maxCumFreq - 1) / range);
    const i = bisectRight(symCum, n, 1);
    high = low + Math.floor((symCum[i] * range) / maxCumFreq);
    low += Math.floor((symCum[i - 1] * range) / maxCumFreq);
    const symbol = MAX_CHAR + 1 - i;

    for (;;) {
      if (low < QUADRANT2) {
        if (low < QUADRANT1 || high > QUADRANT3) {
          if (high > QUADRANT2) break;
        } else {
          low -= QUADRANT1; code -= QUADRANT1; high -= QUADRANT1;
        }
      } else {
        low -= QUADRANT2; code -= QUADRANT2; high -= QUADRANT2;
      }
      low *= 2; high *= 2; code = code * 2 + nextBit();
    }
    const ret = symbolToChar[symbol];
    updateModel(symbol);
    return ret;
  };

  const decodePosition = (): number => {
    const range = high - low;
    const maxCum = positionCum[0];
    const pos = searchPos(positionCum, Math.floor(((code - low + 1) * maxCum - 1) / range)) - 1;
    high = low + Math.floor((positionCum[pos] * range) / maxCum);
    low += Math.floor((positionCum[pos + 1] * range) / maxCum);
    for (;;) {
      if (low < QUADRANT2) {
        if (low < QUADRANT1 || high > QUADRANT3) {
          if (high > QUADRANT2) return pos;
        } else {
          low -= QUADRANT1; code -= QUADRANT1; high -= QUADRANT1;
        }
      } else {
        low -= QUADRANT2; code -= QUADRANT2; high -= QUADRANT2;
      }
      low *= 2; high *= 2; code = code * 2 + nextBit();
    }
  };

  // —— decode ————————————————————————————————————————————————————————————
  const out = new Uint8Array(outLength);
  let outPos = 0;

  for (let i = 0; i < ARITH_BITS + 2; i++) code += code + nextBit();

  // The window starts filled with spaces, as the reference implementation does;
  // a match can legitimately reach back into it before anything was written.
  let histPos = HIST_LEN - MAX_MATCH_LEN;
  const history = new Uint8Array(HIST_LEN);
  history.fill(0x20, 0, histPos);

  while (outPos < outLength) {
    const ch = decodeChar();
    if (ch >= 0x100) {
      const pos = decodePosition();
      const length = ch - 0x100 + MIN_MATCH_LEN;
      const base = ((histPos - pos - 1) % HIST_LEN + HIST_LEN) % HIST_LEN;
      for (let off = 0; off < length && outPos < outLength; off++) {
        const a = history[(base + off) % HIST_LEN];
        out[outPos++] = a;
        history[histPos] = a;
        histPos = (histPos + 1) % HIST_LEN;
      }
    } else {
      out[outPos++] = ch;
      history[histPos] = ch;
      histPos = (histPos + 1) % HIST_LEN;
    }
  }
  return out;
}
