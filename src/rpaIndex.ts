// Ren'Py archive (.rpa) index reader.
//
// An .rpa is not a wall, it is a container whose index I simply wasn't reading:
// a header line, a zlib-deflated pickled dict at an offset, and file data in
// between. Read the index and every asset inside becomes individually
// addressable, which is the difference between holding 823MB in memory and
// fetching one image at a time.
//
// Layout, from renpy/loader.py:
//   RPA-3.0 <16 hex offset> <8 hex key>\n   index entries XORed with the key
//   RPA-2.0 <16 hex offset>\n               no key
// Each index value is a list of segments, either (offset, dlen) or
// (offset, dlen, prefix) where prefix is leading bytes stored inline.
//
// No imports on purpose — unit-tested directly by node.

export interface RpaSegment { offset: number; length: number; prefix?: Uint8Array }
export interface RpaEntry { segments: RpaSegment[]; size: number }
export interface RpaHeader { version: 2 | 3; indexOffset: number; key: number }

/** Parse the first line. Returns null when this isn't an .rpa we understand,
 *  which is a refusal, not a guess — a wrong offset would read garbage. */
export function parseRpaHeader(head: Uint8Array): RpaHeader | null {
  const text = String.fromCharCode(...head.subarray(0, Math.min(head.length, 40)));
  if (text.startsWith("RPA-3.0 ")) {
    const offset = parseInt(text.slice(8, 24), 16);
    const key = parseInt(text.slice(25, 33), 16);
    if (!Number.isFinite(offset) || !Number.isFinite(key)) return null;
    return { version: 3, indexOffset: offset, key };
  }
  if (text.startsWith("RPA-2.0 ")) {
    const offset = parseInt(text.slice(8, 24), 16);
    if (!Number.isFinite(offset)) return null;
    return { version: 2, indexOffset: offset, key: 0 };
  }
  return null;
}

// —— pickle ————————————————————————————————————————————————————————————————
// The index is pickle.dumps of dict[str, list[tuple]]. Only the opcodes that
// shape actually needs are implemented; anything else throws rather than
// silently producing a plausible-but-wrong index.
// A plain object, not a const enum: enums are not erasable syntax, so node
// cannot strip-type this file for its unit test.
const Op = {
  MARK: 0x28, STOP: 0x2e, NONE: 0x4e, BININT: 0x4a, BININT1: 0x4b, BININT2: 0x4d,
  BINSTRING: 0x54, SHORT_BINSTRING: 0x55, BINUNICODE: 0x58, EMPTY_DICT: 0x7d,
  EMPTY_LIST: 0x5d, EMPTY_TUPLE: 0x29, TUPLE: 0x74, DICT: 0x64, LIST: 0x6c,
  APPEND: 0x61, APPENDS: 0x65, SETITEM: 0x73, SETITEMS: 0x75,
  BINPUT: 0x71, LONG_BINPUT: 0x72, BINGET: 0x68, LONG_BINGET: 0x6a,
  PROTO: 0x80, TUPLE1: 0x85, TUPLE2: 0x86, TUPLE3: 0x87, NEWTRUE: 0x88,
  NEWFALSE: 0x89, LONG1: 0x8a, LONG4: 0x8b, SHORT_BINUNICODE: 0x8c,
  BINBYTES: 0x42, SHORT_BINBYTES: 0x43, BINBYTES8: 0x8e, MEMOIZE: 0x94, FRAME: 0x95,
  BINFLOAT: 0x47, INT: 0x49, LONG: 0x4c, STRING: 0x53, UNICODE: 0x56,
  PUT: 0x70, GET: 0x67,
} as const;

type PickleValue = unknown;

/** Minimal Python unpickler for the .rpa index shape. */
export function unpickle(buf: Uint8Array): PickleValue {
  const stack: PickleValue[] = [];
  const marks: number[] = [];
  const memo = new Map<number, PickleValue>();
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const latin1 = (a: number, b: number) => {
    let s = "";
    for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]);
    return s;
  };
  const utf8 = new TextDecoder("utf-8");
  let i = 0;

  const line = (): string => {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) throw new Error("pickle: unterminated line");
    const s = latin1(i, nl);
    i = nl + 1;
    return s;
  };
  const popMark = (): PickleValue[] => {
    const m = marks.pop();
    if (m === undefined) throw new Error("pickle: no MARK");
    return stack.splice(m);
  };

  while (i < buf.length) {
    const op = buf[i++];
    switch (op) {
      case Op.PROTO: case Op.FRAME: i += op === Op.PROTO ? 1 : 8; break;
      case Op.MARK: marks.push(stack.length); break;
      case Op.STOP: return stack.pop();
      case Op.NONE: stack.push(null); break;
      case Op.NEWTRUE: stack.push(true); break;
      case Op.NEWFALSE: stack.push(false); break;

      case Op.BININT: stack.push(dv.getInt32(i, true)); i += 4; break;
      case Op.BININT1: stack.push(buf[i]); i += 1; break;
      case Op.BININT2: stack.push(dv.getUint16(i, true)); i += 2; break;
      case Op.INT: { const s = line(); stack.push(s === "01" ? true : s === "00" ? false : parseInt(s, 10)); break; }
      case Op.LONG: { const s = line(); stack.push(Number(BigInt(s.replace(/L$/, "")))); break; }
      case Op.BINFLOAT: stack.push(dv.getFloat64(i, false)); i += 8; break;
      case Op.LONG1: case Op.LONG4: {
        const n = op === Op.LONG1 ? buf[i++] : (dv.getUint32(i, true), i += 4, dv.getUint32(i - 4, true));
        // little-endian, two's complement
        let v = 0n;
        for (let k = n - 1; k >= 0; k--) v = (v << 8n) | BigInt(buf[i + k]);
        if (n > 0 && (buf[i + n - 1] & 0x80)) v -= 1n << BigInt(8 * n);
        i += n;
        stack.push(Number(v));
        break;
      }

      case Op.SHORT_BINSTRING: case Op.SHORT_BINBYTES: {
        const n = buf[i++]; stack.push(op === Op.SHORT_BINBYTES ? buf.slice(i, i + n) : latin1(i, i + n)); i += n; break;
      }
      case Op.BINSTRING: case Op.BINBYTES: {
        const n = dv.getUint32(i, true); i += 4;
        stack.push(op === Op.BINBYTES ? buf.slice(i, i + n) : latin1(i, i + n)); i += n; break;
      }
      case Op.BINBYTES8: { const n = Number(dv.getBigUint64(i, true)); i += 8; stack.push(buf.slice(i, i + n)); i += n; break; }
      case Op.BINUNICODE: { const n = dv.getUint32(i, true); i += 4; stack.push(utf8.decode(buf.subarray(i, i + n))); i += n; break; }
      case Op.SHORT_BINUNICODE: { const n = buf[i++]; stack.push(utf8.decode(buf.subarray(i, i + n))); i += n; break; }
      case Op.STRING: case Op.UNICODE: { const s = line(); stack.push(s.replace(/^['"]|['"]$/g, "")); break; }

      case Op.EMPTY_DICT: stack.push(new Map<PickleValue, PickleValue>()); break;
      case Op.EMPTY_LIST: stack.push([]); break;
      case Op.EMPTY_TUPLE: stack.push([]); break;
      case Op.DICT: { const items = popMark(); const m = new Map<PickleValue, PickleValue>();
        for (let k = 0; k < items.length; k += 2) m.set(items[k], items[k + 1]); stack.push(m); break; }
      case Op.LIST: stack.push(popMark()); break;
      case Op.TUPLE: stack.push(popMark()); break;
      case Op.TUPLE1: stack.push([stack.pop()]); break;
      case Op.TUPLE2: { const b = stack.pop(); const a = stack.pop(); stack.push([a, b]); break; }
      case Op.TUPLE3: { const c = stack.pop(); const b = stack.pop(); const a = stack.pop(); stack.push([a, b, c]); break; }

      case Op.APPEND: { const v = stack.pop(); (stack[stack.length - 1] as PickleValue[]).push(v); break; }
      case Op.APPENDS: { const items = popMark(); (stack[stack.length - 1] as PickleValue[]).push(...items); break; }
      case Op.SETITEM: { const v = stack.pop(); const k = stack.pop();
        (stack[stack.length - 1] as Map<PickleValue, PickleValue>).set(k, v); break; }
      case Op.SETITEMS: { const items = popMark(); const m = stack[stack.length - 1] as Map<PickleValue, PickleValue>;
        for (let k = 0; k < items.length; k += 2) m.set(items[k], items[k + 1]); break; }

      case Op.BINPUT: memo.set(buf[i++], stack[stack.length - 1]); break;
      case Op.LONG_BINPUT: memo.set(dv.getUint32(i, true), stack[stack.length - 1]); i += 4; break;
      case Op.MEMOIZE: memo.set(memo.size, stack[stack.length - 1]); break;
      case Op.PUT: memo.set(parseInt(line(), 10), stack[stack.length - 1]); break;
      case Op.BINGET: stack.push(memo.get(buf[i++])); break;
      case Op.LONG_BINGET: stack.push(memo.get(dv.getUint32(i, true))); i += 4; break;
      case Op.GET: stack.push(memo.get(parseInt(line(), 10))); break;

      default:
        throw new Error(`pickle: unsupported opcode 0x${op.toString(16)} at ${i - 1}`);
    }
  }
  throw new Error("pickle: no STOP");
}

/** Decode an inflated index into path → segments, undoing the XOR. */
export function decodeRpaIndex(inflated: Uint8Array, key: number): Map<string, RpaEntry> {
  const raw = unpickle(inflated);
  if (!(raw instanceof Map)) throw new Error("rpa: index is not a dict");
  const out = new Map<string, RpaEntry>();

  for (const [k, v] of raw) {
    const path = typeof k === "string" ? k : String(k);
    if (!Array.isArray(v)) continue;
    const segments: RpaSegment[] = [];
    let size = 0;

    for (const seg of v as PickleValue[]) {
      if (!Array.isArray(seg) || seg.length < 2) continue;
      const offset = Number(seg[0]) ^ key;
      const length = Number(seg[1]) ^ key;
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length < 0) continue;
      let prefix: Uint8Array | undefined;
      if (seg.length >= 3 && seg[2]) {
        const p = seg[2];
        prefix = p instanceof Uint8Array
          ? p
          : Uint8Array.from(String(p), (c) => c.charCodeAt(0) & 0xff);  // latin-1, per loader.py
      }
      segments.push({ offset, length, prefix });
      size += length + (prefix?.length ?? 0);
    }
    if (segments.length) out.set(path.replace(/\\/g, "/"), { segments, size });
  }
  return out;
}
