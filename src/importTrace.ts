// Import tracing — what actually happened, from the dropped zip to the saved
// game record.
//
// Written because import failures were being diagnosed by guesswork: a game that
// imports and then reports the wrong engine looks identical, from the outside, to
// one whose conversion was skipped, refused, or never reached. The trace records
// each decision with the numbers behind it.
//
// Lines are flushed to localStorage as they are appended, not at the end. An
// out-of-memory import kills the tab outright — that is the case most worth
// having a log for, and an in-memory buffer would die with it. So the cost of a
// synchronous write per line is the entire point, and trace() is therefore called
// per PHASE, never per file.
const KEY = "asp.importtrace";
const MAX_LINES = 300;
const MAX_CHARS = 60_000;

let lines: string[] = [];
let t0 = 0;

function flush(): void {
  try {
    let text = lines.join("\n");
    while (text.length > MAX_CHARS && lines.length > 8) {
      lines.splice(1, Math.max(1, Math.floor(lines.length / 8)));   // keep the header
      text = lines.join("\n");
    }
    localStorage.setItem(KEY, text);
  } catch { /* private mode or full — the in-memory copy still serves the UI */ }
}

const ms = () => (t0 ? `+${String(Date.now() - t0).padStart(6, " ")}ms` : "       —");

/** Begin a trace, replacing any previous one. */
export function traceStart(label: string): void {
  t0 = Date.now();
  lines = ["=== IMPORT TRACE ===", label];
  flush();
}

/** Record one phase. `data` is rendered as key=value pairs, so numbers stay
 *  greppable rather than being buried in prose. */
export function trace(msg: string, data?: Record<string, unknown>): void {
  const bits = data
    ? " · " + Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")
    : "";
  lines.push(`${ms()} ${msg}${bits}`);
  if (lines.length > MAX_LINES) lines.splice(2, lines.length - MAX_LINES);
  flush();
}

/** Record a failure with its message, which is the line that usually matters. */
export function traceError(where: string, e: unknown): void {
  trace(`FAILED ${where}`, { error: e instanceof Error ? e.message : String(e) });
}

export function traceText(): string {
  if (lines.length) return lines.join("\n");
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function traceClear(): void {
  lines = [];
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
